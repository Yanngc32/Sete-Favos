"""Registro dos aparelhos: estado ao vivo, online/offline e envio de comandos."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from casa.adapters.base import Adapter, AdapterError, Candidate, Driver, device_secret_key
from casa.adapters.phone import VENDOR as PHONE_VENDOR
from casa.adapters.phone import PhoneAdapter, phone_state
from casa.events import EventBus
from casa.groups import (
    GROUP_VENDOR,
    MAX_MEMBERS,
    MIN_MEMBERS,
    GroupAdapter,
    Member,
    common_capabilities,
    group_kind,
    group_online,
    group_state,
)
from casa.home import Home
from casa.model import Capability, CardPrefs, DeviceRecord, DeviceView, Kind, card_show_keys
from casa.store import Store
from casa.vault import Vault

log = logging.getLogger(__name__)

COMMAND_TIMEOUT = 5.0
REFRESH_TIMEOUT = 15.0
# Falhas seguidas até o aparelho aparecer como offline.
OFFLINE_AFTER = 2


class CommandError(Exception):
    """Falha de comando com mensagem pronta para o usuário."""


class NotFound(Exception):
    pass


@dataclass
class _Entry:
    record: DeviceRecord
    adapter: Adapter
    driver: Driver
    state: dict[str, Any] = field(default_factory=dict)
    online: bool | None = None  # None = ainda não respondeu desde que o backend subiu
    last_seen: float | None = None
    failures: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    timer: asyncio.Task | None = None  # "desligar em..." (record.config["off_at"])


class Hub:
    def __init__(self, store: Store, vault: Vault, bus: EventBus, adapters: dict[str, Adapter]) -> None:
        self.store = store
        self.vault = vault
        self.bus = bus
        # Grupos e celular são da própria central (não vêm de fabricante nem do assistente).
        self.adapters = {**adapters, GROUP_VENDOR: GroupAdapter(vault, self), PHONE_VENDOR: PhoneAdapter(vault)}
        self._entries: dict[str, _Entry] = {}

    # Ciclo de vida ------------------------------------------------------------

    async def start(self) -> None:
        records = [DeviceRecord.model_validate(raw) for raw in self.store.all("devices")]
        # Grupos por último: o estado deles sai dos membros, que precisam já existir.
        for record in sorted(records, key=lambda r: r.vendor == GROUP_VENDOR):
            adapter = self.adapters.get(record.vendor)
            if adapter is None:
                log.warning("aparelho %s usa fabricante desativado: %s", record.id, record.vendor)
                continue
            self._spawn(record, adapter)

    async def stop(self) -> None:
        entries = list(self._entries.values())
        for e in entries:
            if e.task:
                e.task.cancel()
            if e.timer:
                e.timer.cancel()
        for e in entries:
            if e.task:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await e.task
            with contextlib.suppress(Exception):
                await e.driver.close()

    def _spawn(self, record: DeviceRecord, adapter: Adapter) -> _Entry:
        driver = adapter.driver(record)
        entry = _Entry(record=record, adapter=adapter, driver=driver)
        driver.on_push(lambda changes, e=entry: self._on_push(e, changes))
        self._entries[record.id] = entry
        if record.vendor == GROUP_VENDOR:
            self._sync_group(entry, publish=False)  # sem laço próprio: segue os membros
        else:
            entry.task = asyncio.create_task(self._run(entry), name=f"device:{record.id}")
        self._arm_timer(entry)
        return entry

    # Leitura ------------------------------------------------------------------

    def ids(self) -> list[str]:
        return list(self._entries)

    def has(self, device_id: str) -> bool:
        return device_id in self._entries

    def record(self, device_id: str) -> DeviceRecord:
        return self._entry(device_id).record

    def view(self, device_id: str) -> DeviceView:
        return self._view(self._entry(device_id))

    def views(self) -> list[DeviceView]:
        return [self._view(e) for e in self._entries.values()]

    def state(self, device_id: str, capability: str) -> Any:
        e = self._entries.get(device_id)
        return e.state.get(capability) if e else None

    def capabilities(self, device_id: str) -> list[Capability]:
        return self._entry(device_id).driver.capabilities()

    def is_added(self, vendor: str, key: str) -> bool:
        return any(e.record.vendor == vendor and e.record.config.get("key") == key for e in self._entries.values())

    def rooms(self) -> list[str]:
        names = {r["name"] for r in self.store.all("rooms")}
        names |= {e.record.room for e in self._entries.values() if e.record.room}
        return sorted(names, key=str.casefold)

    def add_room(self, name: str) -> list[str]:
        name = name.strip()
        if not name:
            raise ValueError("Dê um nome ao cômodo.")
        self.store.put("rooms", name.casefold(), {"name": name})
        return self.rooms()

    def _entry(self, device_id: str) -> _Entry:
        try:
            return self._entries[device_id]
        except KeyError:
            raise NotFound(device_id) from None

    def _view(self, e: _Entry) -> DeviceView:
        r = e.record
        return DeviceView(
            id=r.id, vendor=r.vendor, vendor_label=e.adapter.label, kind=r.kind, name=r.name,
            room=r.room, pinned=r.pinned, online=e.online, last_seen=e.last_seen,
            state=dict(e.state), capabilities=e.driver.capabilities(), notes=e.driver.notes(),
            ip=r.config.get("ip"), model=r.config.get("model"),
            members=list(r.config.get("members", [])) if r.vendor == GROUP_VENDOR else None,
            off_at=r.config.get("off_at"),
            remote=list(e.driver.remote_keys()) or None,
            card=r.card,
        )

    # Cadastro -----------------------------------------------------------------

    async def add_device(self, candidate: Candidate, *, name: str, room: str | None, kind: Kind) -> DeviceView:
        adapter = self.adapters[candidate.vendor]
        if self.is_added(candidate.vendor, candidate.key):
            raise AdapterError("ja_adicionado", f"{name} já está cadastrado.")
        record = DeviceRecord(
            vendor=candidate.vendor, kind=kind, name=name.strip() or candidate.name,
            room=(room or "").strip() or None,
            config={**candidate.config, "key": candidate.key, "ip": candidate.ip, "model": candidate.model},
        )
        for secret_name, value in candidate.secrets.items():
            self.vault.set(device_secret_key(record.id, secret_name), value)
        self.store.put("devices", record.id, record.model_dump())
        entry = self._spawn(record, adapter)
        view = self._view(entry)
        self.bus.publish({"t": "device", "device": view.model_dump()})
        return view

    def update_device(
        self, device_id: str, *, name: str | None = None, room: str | None = None, pinned: bool | None = None,
        clear_room: bool = False, kind: Kind | None = None, labels: dict[str, str] | None = None,
        card: CardPrefs | None = None, clear_card: bool = False,
    ) -> DeviceView:
        e = self._entry(device_id)
        group = e.record.vendor == GROUP_VENDOR
        if card is not None and not clear_card:
            card.check_kind(kind or e.record.kind, group)
        if kind is not None and kind != e.record.kind:
            e.record.kind = kind
            # Mudou o tipo: some o que o card novo não tem (ex.: "mudo" de uma TV que virou tomada).
            if e.record.card:
                keep = card_show_keys(kind, group)
                e.record.card = e.record.card.model_copy(
                    update={"show": {k: v for k, v in e.record.card.show.items() if k in keep}}
                ).normalized()
        if clear_card:
            e.record.card = None
        elif card is not None:
            e.record.card = card.normalized()
        if labels is not None:
            ids = {c.id for c in e.driver.capabilities() if c.type == "bool" and c.id != "power"}
            if not set(labels) <= ids:
                raise ValueError("Tecla desconhecida.")
            if any(len(v.strip()) > 40 for v in labels.values()):
                raise ValueError("Nome da tecla muito longo (máx. 40).")
            merged = {**(e.record.config.get("labels") or {}), **{k: v.strip() for k, v in labels.items()}}
            e.record.config["labels"] = {k: v for k, v in merged.items() if v}
        if name is not None:
            if not name.strip():
                raise ValueError("O nome não pode ficar vazio.")
            if e.record.vendor == GROUP_VENDOR and any(
                g is not e and g.record.name.casefold() == name.strip().casefold() for g in self._groups()
            ):
                raise ValueError("Já existe um grupo com este nome.")
            e.record.name = name.strip()
        if clear_room:
            e.record.room = None
        elif room is not None:
            e.record.room = room.strip() or None
        if pinned is not None:
            e.record.pinned = pinned
        self.store.put("devices", e.record.id, e.record.model_dump())
        return self._publish(e)

    async def remove_device(self, device_id: str) -> DeviceRecord:
        e = self._entries.pop(device_id, None)
        if e is None:
            raise NotFound(device_id)
        if e.task:
            e.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await e.task
        if e.timer:
            e.timer.cancel()
        with contextlib.suppress(Exception):
            await e.driver.close()
        for secret_name in e.adapter.device_secrets:
            self.vault.delete(device_secret_key(device_id, secret_name))
        self.store.delete("devices", device_id)
        self.bus.publish({"t": "device_removed", "id": device_id, "name": e.record.name})
        if e.record.vendor != GROUP_VENDOR:
            await self._prune_groups(device_id)
        return e.record

    # Comandos -----------------------------------------------------------------

    async def command(self, device_id: str, capability: str, value: Any = None) -> DeviceView:
        e = self._entry(device_id)
        if e.record.vendor == GROUP_VENDOR:
            return await self._group_command(e, capability, value)
        cap = next((c for c in e.driver.capabilities() if c.id == capability), None)
        if cap is None:
            raise CommandError(f"{e.record.name} não tem {capability}.")
        try:
            value = cap.validate_value(value)
        except ValueError as exc:
            raise CommandError(str(exc)) from None

        async def run() -> dict[str, Any]:
            async with e.lock:
                return await e.driver.command(capability, value)

        try:
            changes = await asyncio.wait_for(run(), COMMAND_TIMEOUT)
        except AdapterError as exc:
            raise CommandError(exc.message) from None
        except Exception as exc:
            log.warning("comando %s=%r em %s falhou: %r", capability, value, e.record.name, exc)
            raise CommandError(f"Não consegui {_verb(cap, value)} {e.record.name}.") from None
        self._mark_ok(e)
        if not changes and cap.type != "action":
            changes = {capability: value}
        self._apply(e, changes or {})
        e.wake.set()  # relê logo para confirmar o estado real
        return self._view(e)

    async def remote(self, device_id: str, key: str) -> None:
        e = self._entry(device_id)
        if key not in e.driver.remote_keys():
            raise CommandError(f"{e.record.name} não tem a tecla {key}.")

        async def run() -> None:
            async with e.lock:
                await e.driver.remote(key)

        try:
            await asyncio.wait_for(run(), COMMAND_TIMEOUT)
        except AdapterError as exc:
            raise CommandError(exc.message) from None
        except Exception as exc:
            log.warning("tecla %s em %s falhou: %r", key, e.record.name, exc)
            raise CommandError(f"{e.record.name} não respondeu (está ligada?).") from None
        self._mark_ok(e)

    async def test(self, device_id: str) -> None:
        e = self._entry(device_id)
        if e.record.vendor == GROUP_VENDOR:
            raise CommandError("O teste vale para um aparelho por vez. Abra o aparelho do grupo.")
        try:
            async with asyncio.timeout(15):
                async with e.lock:
                    await e.driver.test()
        except AdapterError as exc:
            raise CommandError(exc.message) from None
        except Exception:
            raise CommandError(f"{e.record.name} não respondeu ao teste.") from None

    # Laço por aparelho --------------------------------------------------------

    async def _run(self, e: _Entry) -> None:
        while True:
            try:
                async with asyncio.timeout(REFRESH_TIMEOUT):
                    async with e.lock:
                        state = await e.driver.refresh()
                self._mark_ok(e)
                self._apply(e, state)
                delay = e.driver.poll_interval
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                e.failures += 1
                log.debug("leitura de %s falhou (%d): %r", e.record.name, e.failures, exc)
                if e.failures >= OFFLINE_AFTER and e.online is not False:
                    e.online = False
                    self._publish(e)
                delay = min(60.0, e.driver.poll_interval * 2 ** min(e.failures, 3))
            e.wake.clear()
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(delay):
                    await e.wake.wait()

    def _on_push(self, e: _Entry, changes: dict[str, Any]) -> None:
        if self._entries.get(e.record.id) is not e:
            return
        was_online = e.online
        self._mark_ok(e, publish=False)
        self._apply(e, changes, force_publish=was_online is not True)

    def _mark_ok(self, e: _Entry, *, publish: bool = True) -> None:
        e.failures = 0
        e.last_seen = time.time()
        if e.online is not True:
            e.online = True
            if publish:
                self._publish(e)

    def _apply(self, e: _Entry, new_state: dict[str, Any], *, force_publish: bool = False) -> None:
        changes: dict[str, tuple[Any, Any]] = {}
        for key, value in new_state.items():
            old = e.state.get(key)
            if old != value:
                changes[key] = (old, value)
                e.state[key] = value
        if "power" in changes:
            if changes["power"][1] is True:
                e.state["on_since"] = time.time()
            else:
                e.state.pop("on_since", None)
        if changes or force_publish:
            self._publish(e)
        if changes:
            self.bus.publish(
                {"t": "state", "device_id": e.record.id, "changes": changes}, internal=True
            )

    def _publish(self, e: _Entry) -> DeviceView:
        # Desligou antes da hora (na mão, por rotina...): o timer não tem mais o que fazer.
        if e.state.get("power") is False and "off_at" in e.record.config:
            self._clear_timer(e)
        view = self._view(e)
        self.bus.publish({"t": "device", "device": view.model_dump()})
        if e.record.vendor != GROUP_VENDOR:
            self._sync_groups_of(e.record.id)
        return view

    # Celular (app Android) ----------------------------------------------------------

    async def phone_report(self, access_id: str, name: str, report: dict[str, Any], home: Home | None) -> DeviceView:
        """Recebe o que o app mandou; cria o aparelho "Celular" deste acesso na primeira vez."""
        e = next((x for x in self._entries.values()
                  if x.record.vendor == PHONE_VENDOR and x.record.config.get("access_id") == access_id), None)
        if e is None:
            await self.add_device(
                Candidate(key=access_id, vendor=PHONE_VENDOR, name=name, kind="phone",
                          config={"access_id": access_id}),
                name=name, room=None, kind="phone",
            )
            e = next(x for x in self._entries.values() if x.record.config.get("access_id") == access_id)
        state = phone_state(report, home, e.record.config.get("last_report") or {})
        e.record.config["last_report"] = state
        self.store.put("devices", e.record.id, e.record.model_dump())
        e.driver.push(state)
        return self._view(e)

    # Timer "desligar em..." ------------------------------------------------------

    def set_timer(self, device_id: str, minutes: int | None) -> DeviceView:
        e = self._entry(device_id)
        if minutes is None:
            self._clear_timer(e)
            return self._publish(e)
        if not any(c.id == "power" and not c.readonly for c in e.driver.capabilities()):
            raise ValueError(f"{e.record.name} não tem liga/desliga.")
        if e.state.get("power") is not True:
            raise ValueError(f"{e.record.name} já está desligado.")
        e.record.config["off_at"] = time.time() + minutes * 60
        self.store.put("devices", e.record.id, e.record.model_dump())
        self._arm_timer(e)
        return self._publish(e)

    def _clear_timer(self, e: _Entry) -> None:
        if e.timer and e.timer is not asyncio.current_task():
            e.timer.cancel()
        e.timer = None
        if e.record.config.pop("off_at", None) is not None:
            self.store.put("devices", e.record.id, e.record.model_dump())

    def _arm_timer(self, e: _Entry) -> None:
        if e.timer:
            e.timer.cancel()
            e.timer = None
        at = e.record.config.get("off_at")
        if at is None:
            return
        if at <= time.time():  # passou da hora com a central fora: não desliga atrasado
            self._clear_timer(e)
            return
        e.timer = asyncio.create_task(self._timer_fire(e, at - time.time()), name=f"timer:{e.record.id}")

    async def _timer_fire(self, e: _Entry, delay: float) -> None:
        await asyncio.sleep(delay)
        self._clear_timer(e)
        try:
            await self.command(e.record.id, "power", False)
        except Exception as exc:
            log.warning("timer de %s não conseguiu desligar: %r", e.record.name, exc)
            self._publish(e)

    # Grupos -------------------------------------------------------------------

    def _groups(self) -> list[_Entry]:
        return [e for e in self._entries.values() if e.record.vendor == GROUP_VENDOR]

    def _members(self, record: DeviceRecord) -> list[_Entry]:
        return [self._entries[m] for m in record.config.get("members", []) if m in self._entries]

    def _snapshot(self, entries: list[_Entry]) -> list[Member]:
        return [
            Member(
                id=m.record.id, name=m.record.name, kind=m.record.kind, online=m.online, state=dict(m.state),
                caps=m.driver.capabilities(), last_seen=m.last_seen,
            )
            for m in entries
        ]

    def group_capabilities(self, record: DeviceRecord) -> list[Capability]:
        return common_capabilities(self._snapshot(self._members(record)))

    def _sync_groups_of(self, member_id: str) -> None:
        for g in self._groups():
            if member_id in g.record.config.get("members", []):
                self._sync_group(g)

    def _sync_group(self, g: _Entry, *, publish: bool = True) -> None:
        members = self._snapshot(self._members(g.record))
        caps = common_capabilities(members)
        state = group_state(caps, members)
        online = group_online(members)
        seen = [m.last_seen for m in members if m.last_seen]
        g.last_seen = max(seen) if seen else None
        stale = [k for k in g.state if k not in state and k != "on_since"]
        for k in stale:
            del g.state[k]
        changed_online = g.online != online
        g.online = online
        self._apply(g, state, force_publish=publish and (changed_online or bool(stale)))

    async def _group_command(self, g: _Entry, capability: str, value: Any) -> DeviceView:
        cap = next((c for c in g.driver.capabilities() if c.id == capability), None)
        if cap is None:
            raise CommandError(f"{g.record.name} não tem {capability}.")
        try:
            value = cap.validate_value(value)
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        members = self._members(g.record)
        targets = [m for m in members if m.online is not False]
        skipped = [m for m in members if m.online is False]
        results = await asyncio.gather(
            *(self.command(m.record.id, capability, value) for m in targets), return_exceptions=True
        )
        ok = [m for m, r in zip(targets, results, strict=True) if not isinstance(r, BaseException)]
        failed = [m.record.name for m, r in zip(targets, results, strict=True) if isinstance(r, BaseException)]
        failed += [m.record.name for m in skipped]
        if not ok:
            raise CommandError(f"Não consegui {_verb(cap, value)} {g.record.name}: nenhum aparelho respondeu.")
        self._sync_group(g)
        view = self._view(g)
        if failed:
            view.partial = {"ok": len(ok), "total": len(members), "failed": failed}
        return view

    def _check_members(self, ids: list[str]) -> list[_Entry]:
        if len(set(ids)) != len(ids):
            raise ValueError("Cada aparelho entra uma vez só no grupo.")
        if len(ids) < MIN_MEMBERS:
            raise ValueError(f"Escolha pelo menos {MIN_MEMBERS} aparelhos.")
        if len(ids) > MAX_MEMBERS:
            raise ValueError(f"Um grupo tem no máximo {MAX_MEMBERS} aparelhos.")
        entries = [self._entry(i) for i in ids]
        if any(m.record.vendor == GROUP_VENDOR for m in entries):
            raise ValueError("Um grupo não pode ter outro grupo dentro.")
        return entries

    def preview_group(self, member_ids: list[str]) -> dict[str, Any]:
        entries = [self._entries[i] for i in member_ids if i in self._entries]
        entries = [m for m in entries if m.record.vendor != GROUP_VENDOR]
        return {
            "capabilities": [c.model_dump() for c in common_capabilities(self._snapshot(entries))],
            "kind": group_kind([m.record.kind for m in entries]),
        }

    def create_group(self, *, name: str, room: str | None, members: list[str]) -> DeviceView:
        name = name.strip()
        if not name:
            raise ValueError("Dê um nome ao grupo.")
        if any(g.record.name.casefold() == name.casefold() for g in self._groups()):
            raise ValueError("Já existe um grupo com este nome.")
        entries = self._check_members(members)
        record = DeviceRecord(
            vendor=GROUP_VENDOR, kind=group_kind([m.record.kind for m in entries]), name=name,
            room=(room or "").strip() or None, config={"members": list(members)},
        )
        self.store.put("devices", record.id, record.model_dump())
        entry = self._spawn(record, self.adapters[GROUP_VENDOR])
        return self._publish(entry)

    def set_group_members(self, group_id: str, members: list[str]) -> DeviceView:
        g = self._entry(group_id)
        if g.record.vendor != GROUP_VENDOR:
            raise ValueError("Este aparelho não é um grupo.")
        entries = self._check_members(members)
        g.record.config["members"] = list(members)
        g.record.kind = group_kind([m.record.kind for m in entries])
        self.store.put("devices", g.record.id, g.record.model_dump())
        self._sync_group(g, publish=False)
        return self._publish(g)

    async def _prune_groups(self, removed_id: str) -> None:
        for g in self._groups():
            members = g.record.config.get("members", [])
            if removed_id not in members:
                continue
            left = [m for m in members if m != removed_id]
            if len(left) < MIN_MEMBERS:
                await self.remove_device(g.record.id)
                continue
            g.record.config["members"] = left
            self.store.put("devices", g.record.id, g.record.model_dump())
            self._sync_group(g, publish=False)
            self._publish(g)


def _verb(cap: Capability, value: Any) -> str:
    if cap.id == "power":
        return "ligar" if value else "desligar"
    if cap.type == "action":
        return f'executar "{cap.label}" em'
    return f"ajustar {cap.label.lower()} de"
