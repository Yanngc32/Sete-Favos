"""Motor de rotinas, automações e objetos virtuais (modelo mínimo, ver automation.py)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import defaultdict, deque
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from pydantic import TypeAdapter

from casa.automation import (
    REMOTE_KEY,
    Action,
    Automation,
    Condition,
    DelayAction,
    DeviceAction,
    DeviceIs,
    DeviceTrigger,
    Routine,
    RoutineAction,
    RunResult,
    StepResult,
    SunTrigger,
    TimeBetween,
    TimeTrigger,
    Trigger,
    VirtualAction,
    VirtualIs,
    VirtualObject,
    VirtualTrigger,
    WeekdayIs,
)
from casa.events import Event, EventBus
from casa.home import load_home
from casa.hub import CommandError, Hub
from casa.store import Store
from casa.sun import sun_times

log = logging.getLogger(__name__)

MAX_DEPTH = 4
# Proteção contra laço (automação que dispara a si mesma).
STORM_LIMIT = 10
STORM_WINDOW = 60.0
UNDO_WINDOW = 15.0

_ACTIONS = TypeAdapter(list[Action])


class EngineError(Exception):
    """Erro com mensagem pronta para o usuário."""


class NotFound(Exception):
    pass


class _Run:
    def __init__(self) -> None:
        self.result = RunResult(at=time.time())
        # (tipo, id, capacidade, valor anterior) para desfazer.
        self.undo: list[tuple[str, str, str, Any]] = []
        self.paused = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.started = time.monotonic()


class Engine:
    def __init__(
        self, store: Store, hub: Hub, bus: EventBus, now: Callable[[], datetime] = datetime.now
    ) -> None:
        self.store = store
        self.hub = hub
        self.bus = bus
        self._now = now
        self._sun_cache: tuple[Any, Any] = (None, None)
        self.routines = {r["id"]: Routine.model_validate(r) for r in store.all("routines")}
        self.automations = {a["id"]: Automation.model_validate(a) for a in store.all("automations")}
        self.virtuals = {v["id"]: VirtualObject.model_validate(v) for v in store.all("virtuals")}
        self._tasks: set[asyncio.Task] = set()
        self._runs: dict[str, _Run] = {}
        self._fired: dict[str, deque[float]] = defaultdict(deque)
        self._last_minute: str | None = None
        self._clock: asyncio.Task | None = None

    async def start(self) -> None:
        self.bus.listen(self._on_event)
        self._clock = asyncio.create_task(self._clock_loop(), name="engine-clock")

    async def stop(self) -> None:
        tasks = [t for t in [self._clock, *self._tasks] if t]
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t

    # Objetos virtuais -------------------------------------------------------

    def virtual_view(self, v: VirtualObject) -> dict[str, Any]:
        return {**v.model_dump(mode="json"), "used_by": self._virtual_uses(v.id)}

    def virtual(self, virtual_id: str) -> VirtualObject:
        return _get(self.virtuals, virtual_id)

    def save_virtual(self, data: dict[str, Any], virtual_id: str | None = None) -> VirtualObject:
        if virtual_id:
            current = _get(self.virtuals, virtual_id)
            v = VirtualObject.model_validate({**current.model_dump(), **data, "id": virtual_id, "value": current.value})
        else:
            v = VirtualObject.model_validate({k: x for k, x in data.items() if k != "id"})
        self.virtuals[v.id] = v
        self._persist_virtual(v)
        return v

    def delete_virtual(self, virtual_id: str) -> None:
        _get(self.virtuals, virtual_id)
        uses = self._virtual_uses(virtual_id)
        if uses:
            raise EngineError(f"Usado em {_count(uses, 'automação', 'automações')}. Remova antes.")
        del self.virtuals[virtual_id]
        self.store.delete("virtuals", virtual_id)
        self.bus.publish({"t": "virtual_removed", "id": virtual_id})

    def set_virtual(self, virtual_id: str, value: bool) -> VirtualObject:
        v = _get(self.virtuals, virtual_id)
        old = v.value
        if old != value:
            v.value = value
            self._persist_virtual(v)
            self.bus.publish({"t": "virtual_state", "id": v.id, "old": old, "new": value}, internal=True)
        return v

    def _persist_virtual(self, v: VirtualObject) -> None:
        self.store.put("virtuals", v.id, v.model_dump(mode="json"))
        self.bus.publish({"t": "virtual", "virtual": self.virtual_view(v)})

    def _virtual_uses(self, virtual_id: str) -> int:
        count = 0
        for item in [*self.automations.values(), *self.routines.values()]:
            if virtual_id in _virtual_refs(item):
                count += 1
        return count

    # Rotinas ----------------------------------------------------------------

    def save_routine(self, data: dict[str, Any], routine_id: str | None = None) -> Routine:
        current = _get(self.routines, routine_id) if routine_id else None
        payload = {k: x for k, x in data.items() if k not in ("id", "last_run", "incomplete")}
        r = Routine.model_validate({**payload, **({"id": routine_id} if routine_id else {})})
        r.actions = self._check_actions(r.actions, routine_id=r.id)
        r.last_run = current.last_run if current else None
        self.routines[r.id] = r
        self._persist_routine(r)
        return r

    def delete_routine(self, routine_id: str) -> None:
        _get(self.routines, routine_id)
        users = [i for i in [*self.automations.values(), *self.routines.values()]
                 if any(isinstance(a, RoutineAction) and a.routine_id == routine_id for a in i.actions)]
        if users:
            raise EngineError(f"Usada em {_count(len(users), 'automação', 'automações')}. Remova antes.")
        del self.routines[routine_id]
        self.store.delete("routines", routine_id)
        self.bus.publish({"t": "routine_removed", "id": routine_id})

    def set_routine_pinned(self, routine_id: str, pinned: bool) -> Routine:
        r = _get(self.routines, routine_id)
        r.pinned = pinned
        self._persist_routine(r)
        return r

    async def run_routine(self, routine_id: str) -> RunResult:
        r = _get(self.routines, routine_id)

        def done(result: RunResult) -> None:
            if r.id in self.routines:
                r.last_run = result
                self._persist_routine(r)

        return await self._start(r.actions, done)

    def _persist_routine(self, r: Routine) -> None:
        self.store.put("routines", r.id, r.model_dump(mode="json"))
        self.bus.publish({"t": "routine", "routine": r.model_dump(mode="json")})

    # Automações -------------------------------------------------------------

    def save_automation(self, data: dict[str, Any], automation_id: str | None = None) -> Automation:
        current = _get(self.automations, automation_id) if automation_id else None
        payload = {k: x for k, x in data.items() if k not in ("id", "last_run", "incomplete")}
        a = Automation.model_validate({**payload, **({"id": automation_id} if automation_id else {})})
        self._check_trigger(a.trigger)
        self._check_conditions(a.conditions)
        a.actions = self._check_actions(a.actions)
        a.last_run = current.last_run if current else None
        self.automations[a.id] = a
        self._persist_automation(a)
        return a

    def set_enabled(self, automation_id: str, enabled: bool) -> Automation:
        a = _get(self.automations, automation_id)
        if enabled and a.incomplete:
            raise EngineError(f"{a.incomplete}. Edite a automação antes de ativar.")
        a.enabled = enabled
        self._persist_automation(a)
        return a

    def delete_automation(self, automation_id: str) -> None:
        _get(self.automations, automation_id)
        del self.automations[automation_id]
        self._fired.pop(automation_id, None)
        self.store.delete("automations", automation_id)
        self.bus.publish({"t": "automation_removed", "id": automation_id})

    async def test_actions(self, actions: list[dict[str, Any]] | list[Action]) -> RunResult:
        """'Testar agora': executa só as ações, pulando as esperas."""
        parsed = self._check_actions(_ACTIONS.validate_python(actions))
        run = self._new_run()
        await self._execute(parsed, run, depth=0, skip_delays=True)
        run.result.pending = False
        return run.result

    def _persist_automation(self, a: Automation) -> None:
        self.store.put("automations", a.id, a.model_dump(mode="json"))
        self.bus.publish({"t": "automation", "automation": a.model_dump(mode="json")})

    # Desfazer ---------------------------------------------------------------

    async def undo(self, run_id: str) -> RunResult:
        run = self._runs.get(run_id)
        if run is None or time.monotonic() - run.started > UNDO_WINDOW:
            raise EngineError("Não dá mais para desfazer.")
        del self._runs[run_id]
        if run.task and not run.task.done():
            run.task.cancel()
        result = RunResult(at=time.time())
        for kind, target, capability, value in reversed(run.undo):
            result.total += 1
            try:
                if kind == "device":
                    await self.hub.command(target, capability, value)
                else:
                    self.set_virtual(target, value)
                result.succeeded += 1
            except (CommandError, NotFound, EngineError) as exc:
                result.errors.append(str(exc))
        return result

    # Execução ---------------------------------------------------------------

    def _new_run(self) -> _Run:
        run = _Run()
        self._runs[run.result.id] = run
        cutoff = time.monotonic() - UNDO_WINDOW
        for rid in [rid for rid, r in self._runs.items() if r.started < cutoff and (not r.task or r.task.done())]:
            del self._runs[rid]
        return run

    async def _start(self, actions: list[Action], done: Callable[[RunResult], None]) -> RunResult:
        """Roda as ações. Volta quando acabam ou na primeira espera (o resto segue em segundo plano)."""
        run = self._new_run()

        async def body() -> None:
            try:
                await self._execute(actions, run, depth=0, skip_delays=False)
            except asyncio.CancelledError:
                run.result.skipped = "Desfeita"
                raise
            finally:
                run.result.pending = False
                run.paused.set()
                done(run.result)

        run.task = self._spawn(body())
        await run.paused.wait()
        return run.result.model_copy(deep=True)

    async def _execute(self, actions: list[Action], run: _Run, *, depth: int, skip_delays: bool) -> None:
        result = run.result
        for action in actions:
            if isinstance(action, DelayAction):
                if skip_delays:
                    continue
                result.pending = True
                run.paused.set()
                await asyncio.sleep(action.minutes * 60)
                continue
            if isinstance(action, RoutineAction):
                routine = self.routines.get(action.routine_id)
                if routine is None or depth >= MAX_DEPTH:
                    self._step(result, "Rotina", "Rotina não encontrada")
                    continue
                await self._execute(routine.actions, run, depth=depth + 1, skip_delays=skip_delays)
                continue
            if isinstance(action, VirtualAction):
                v = self.virtuals.get(action.virtual_id)
                if v is None:
                    self._step(result, "Objeto virtual", "Objeto virtual removido")
                    continue
                run.undo.append(("virtual", v.id, "value", v.value))
                self.set_virtual(v.id, action.value)
                self._step(result, v.name)
                continue
            await self._device_step(action, run)

    async def _device_step(self, action: DeviceAction, run: _Run) -> None:
        """Um aparelho, vários ajustes: liga primeiro, desliga por último; um ajuste que falha não para os outros."""
        result = run.result
        if not self.hub.has(action.device_id):
            self._step(result, "Aparelho", "Aparelho removido")
            return
        view = self.hub.view(action.device_id)
        caps = {c.id: c for c in view.capabilities}
        items = action.ordered()
        names = [_value_label(caps, k) for k, _ in items]
        label = f"{view.name} · {', '.join(names)}" if names else view.name
        if not items:
            self._step(result, label, "Nada para ajustar")
            return
        prior_power = view.state.get("power")
        power_undo = False
        ok = 0
        # (ajuste, motivo curto, mensagem inteira de quando a ação tem um ajuste só)
        fails: list[tuple[str, str, str]] = []
        for (capability, value), name in zip(items, names, strict=True):
            if fails and self.hub.view(action.device_id).online is False:
                # Parou de responder: não adianta esperar o tempo de cada ajuste.
                fails.append((name, "sem resposta", f"{view.name} sem resposta"))
                continue
            cap = caps.get(capability)
            prior = self.hub.state(action.device_id, capability)
            try:
                if capability == REMOTE_KEY:
                    await self.hub.remote(action.device_id, value)
                    ok += 1
                    continue
                after = await self.hub.command(action.device_id, capability, value)
            except CommandError as exc:
                if self.hub.view(action.device_id).online is False:
                    fails.append((name, "sem resposta", f"{view.name} sem resposta"))
                else:
                    fails.append((name, str(exc).rstrip("."), str(exc)))
                continue
            if cap and cap.type != "action" and prior is not None:
                # O desfazer roda ao contrário: o power (se um ajuste ligou o aparelho) volta por último.
                if (capability != "power" and "power" not in action.values and not power_undo
                        and prior_power is False and self.hub.state(action.device_id, "power")):
                    run.undo.append(("device", action.device_id, "power", False))
                    power_undo = True
                run.undo.append(("device", action.device_id, capability, prior))
            if after.partial:  # grupo em que só parte dos membros respondeu
                p = after.partial
                why = f"{p['ok']} de {p['total']} ok · {', '.join(p['failed'])} sem resposta"
                fails.append((name, why, f"{view.name}: {why}"))
                continue
            ok += 1
        if not fails:
            self._step(result, label)
        elif len(items) == 1:
            self._step(result, label, fails[0][2])
        elif ok == 0 and all(w == "sem resposta" for _, w, _ in fails):
            self._step(result, label, f"{view.name} sem resposta")
        else:
            detail = "; ".join(f"{n.lower()}: {w}" for n, w, _ in fails)
            self._step(result, label, f"{ok} de {len(items)} ajustes ok · {detail}")

    @staticmethod
    def _step(result: RunResult, label: str, error: str | None = None) -> None:
        result.total += 1
        result.steps.append(StepResult(label=label, ok=error is None, error=error))
        if error is None:
            result.succeeded += 1
        else:
            result.errors.append(error)

    def _spawn(self, coro: Any) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # Gatilhos ---------------------------------------------------------------

    def _on_event(self, event: Event) -> None:
        t = event.get("t")
        if t == "state":
            changes: dict[str, tuple[Any, Any]] = event["changes"]
            for a in list(self.automations.values()):
                trig = a.trigger
                if isinstance(trig, DeviceTrigger) and trig.device_id == event["device_id"]:
                    change = changes.get(trig.capability)
                    # old None = estado ainda desconhecido (backend acabou de subir): não dispara.
                    if change and change[0] is not None and change[1] == trig.to and change[0] != trig.to:
                        self._spawn(self._fire(a))
        elif t == "virtual_state":
            for a in list(self.automations.values()):
                trig = a.trigger
                if isinstance(trig, VirtualTrigger) and trig.virtual_id == event["id"] and event["new"] == trig.to:
                    self._spawn(self._fire(a))
        elif t == "device_removed":
            self._device_removed(event["id"], event.get("name") or "Aparelho")
        elif t == "device":
            self._device_changed(event["device"])

    async def _clock_loop(self) -> None:
        while True:
            now = self._now()
            await asyncio.sleep(60 - now.second - now.microsecond / 1e6 + 0.2)
            self.tick(self._now())

    def tick(self, now: datetime) -> None:
        """Dispara as automações de horário do minuto atual (uma vez por minuto)."""
        key = now.strftime("%Y-%m-%d %H:%M")
        if key == self._last_minute:
            return
        self._last_minute = key
        hhmm = now.strftime("%H:%M")
        for a in list(self.automations.values()):
            trig = a.trigger
            if isinstance(trig, TimeTrigger) and trig.at == hhmm and now.weekday() in trig.days:
                self._spawn(self._fire(a))
            elif isinstance(trig, SunTrigger) and now.weekday() in trig.days and self._sun_hhmm(trig, now) == hhmm:
                self._spawn(self._fire(a))

    def _sun_hhmm(self, trig: SunTrigger, now: datetime) -> str | None:
        """Hora (HH:MM) do gatilho de sol hoje; o cálculo fica em cache por dia e localização."""
        home = load_home(self.store)
        if home is None:
            return None
        key = (now.date(), home.lat, home.lon)
        if self._sun_cache[0] != key:
            self._sun_cache = (key, sun_times(now.date(), home.lat, home.lon))
        times = self._sun_cache[1]
        if times is None:
            return None
        base = times[0] if trig.event == "sunrise" else times[1]
        return (base + timedelta(minutes=trig.offset)).strftime("%H:%M")

    async def _fire(self, a: Automation) -> RunResult | None:
        if not a.enabled or a.incomplete or a.id not in self.automations:
            return None
        now = self._now()
        if not all(self._condition_ok(c, now) for c in a.conditions):
            return None
        fired = self._fired[a.id]
        mono = time.monotonic()
        while fired and mono - fired[0] > STORM_WINDOW:
            fired.popleft()
        if len(fired) >= STORM_LIMIT:
            log.warning("automação %s disparou demais; ignorando", a.name)
            if not (a.last_run and a.last_run.skipped):
                a.last_run = RunResult(at=time.time(), skipped="Disparou demais em 1 minuto (possível laço)")
                a.last_run.errors.append(a.last_run.skipped)
                self._persist_automation(a)
            return None
        fired.append(mono)

        def done(result: RunResult) -> None:
            if a.id in self.automations:
                a.last_run = result
                self._persist_automation(a)

        return await self._start(a.actions, done)

    def _condition_ok(self, c: Condition, now: datetime) -> bool:
        if isinstance(c, TimeBetween):
            t = now.strftime("%H:%M")
            return c.start <= t < c.end if c.start <= c.end else (t >= c.start or t < c.end)
        if isinstance(c, WeekdayIs):
            return now.weekday() in c.days
        if isinstance(c, DeviceIs):
            return self.hub.state(c.device_id, c.capability) == c.value
        if isinstance(c, VirtualIs):
            v = self.virtuals.get(c.virtual_id)
            return v is not None and v.value == c.value
        return False

    # Validação --------------------------------------------------------------

    def _check_device(self, device_id: str, capability: str) -> Any:
        if not self.hub.has(device_id):
            raise EngineError("Escolha um aparelho que existe.")
        cap = next((c for c in self.hub.capabilities(device_id) if c.id == capability), None)
        if cap is None:
            raise EngineError(f"{self.hub.record(device_id).name} não tem essa opção.")
        return cap

    def _check_virtual(self, virtual_id: str) -> None:
        if virtual_id not in self.virtuals:
            raise EngineError("Escolha um objeto virtual que existe.")

    def _check_trigger(self, trig: Trigger) -> None:
        if isinstance(trig, SunTrigger) and load_home(self.store) is None:
            raise EngineError("Defina a localização da casa em Ajustes para usar nascer e pôr do sol.")
        if isinstance(trig, DeviceTrigger):
            self._check_device(trig.device_id, trig.capability)
        elif isinstance(trig, VirtualTrigger):
            self._check_virtual(trig.virtual_id)

    def _check_conditions(self, conditions: list[Condition]) -> None:
        for c in conditions:
            if isinstance(c, DeviceIs):
                self._check_device(c.device_id, c.capability)
            elif isinstance(c, VirtualIs):
                self._check_virtual(c.virtual_id)

    def _check_values(self, action: DeviceAction) -> None:
        if not self.hub.has(action.device_id):
            raise EngineError("Escolha um aparelho que existe.")
        name = self.hub.record(action.device_id).name
        if not action.values:
            raise EngineError(f"{name}: escolha pelo menos um ajuste.")
        caps = {c.id: c for c in self.hub.capabilities(action.device_id)}
        commands = 0
        for key, value in list(action.values.items()):
            if key == REMOTE_KEY:
                keys = self.hub.view(action.device_id).remote or []
                if value not in keys:
                    raise EngineError(f"{name} não tem essa tecla do controle." if keys
                                      else f"{name} não tem controle remoto.")
                continue
            cap = caps.get(key)
            if cap is None:
                raise EngineError(f"{name} não tem essa opção.")
            try:
                action.values[key] = cap.validate_value(value)
            except ValueError as exc:
                raise EngineError(str(exc)) from None
            if cap.type == "action":
                commands += 1
        if commands > 1:
            raise EngineError(f"{name}: escolha um comando só por ação (ex.: Iniciar).")
        if REMOTE_KEY in action.values and action.values.get("power") is False:
            raise EngineError(f"{name}: a tecla do controle não funciona desligando a TV.")

    def _check_actions(self, actions: list[Action], *, routine_id: str | None = None) -> list[Action]:
        if not actions:
            raise EngineError("Adicione pelo menos uma ação.")
        for action in actions:
            if isinstance(action, DeviceAction):
                self._check_values(action)
            elif isinstance(action, VirtualAction):
                self._check_virtual(action.virtual_id)
            elif isinstance(action, RoutineAction):
                if action.routine_id not in self.routines:
                    raise EngineError("Escolha uma rotina que existe.")
                if routine_id and (action.routine_id == routine_id or self._reaches(action.routine_id, routine_id)):
                    raise EngineError("Uma rotina não pode chamar ela mesma.")
        return actions

    def _reaches(self, start: str, target: str, seen: set[str] | None = None) -> bool:
        seen = seen or set()
        if start in seen:
            return False
        seen.add(start)
        routine = self.routines.get(start)
        if routine is None:
            return False
        for a in routine.actions:
            if isinstance(a, RoutineAction) and (a.routine_id == target or self._reaches(a.routine_id, target, seen)):
                return True
        return False

    def _device_changed(self, device: dict[str, Any]) -> None:
        """Aparelho (ou grupo) que perdeu uma opção usada: item fica incompleto; voltou a ter, volta ao normal.

        Só olha aparelho respondendo: alguns só informam as opções depois de conectar.
        """
        if device.get("online") is not True:
            return
        device_id = device["id"]
        caps = device.get("capabilities") or []
        have = {c["id"] for c in caps}
        if device.get("remote"):
            have.add(REMOTE_KEY)
        prefix = f"Incompleta: {device.get('name') or 'Aparelho'} não tem mais "
        for item in [*self.automations.values(), *self.routines.values()]:
            used = _caps_used(item, device_id)
            if not used:
                continue
            current = item.incomplete or ""
            if current and not current.startswith(prefix):
                continue  # incompleta por outro motivo (ex.: aparelho removido): só salvar de novo resolve
            missing = [c for c in used if c not in have]
            reason = prefix + _join([_LOST.get(c, c) for c in missing]) if missing else None
            if (item.incomplete or None) == reason:
                continue
            item.incomplete = reason
            if isinstance(item, Automation):
                self._persist_automation(item)
            else:
                self._persist_routine(item)

    def _device_removed(self, device_id: str, name: str) -> None:
        reason = f"Incompleta: {name} foi removido"
        for a in self.automations.values():
            if device_id in _device_refs(a):
                a.enabled = False
                a.incomplete = reason
                self._persist_automation(a)
        for r in self.routines.values():
            if device_id in _device_refs(r):
                r.incomplete = reason
                self._persist_routine(r)


def _device_refs(item: Automation | Routine) -> set[str]:
    refs = {a.device_id for a in item.actions if isinstance(a, DeviceAction)}
    if isinstance(item, Automation):
        if isinstance(item.trigger, DeviceTrigger):
            refs.add(item.trigger.device_id)
        refs |= {c.device_id for c in item.conditions if isinstance(c, DeviceIs)}
    return refs


def _caps_used(item: Automation | Routine, device_id: str) -> list[str]:
    used: list[str] = []
    for a in item.actions:
        if isinstance(a, DeviceAction) and a.device_id == device_id:
            used += [k for k in a.values if k not in used]
    if isinstance(item, Automation):
        for r in (item.trigger, *item.conditions):
            if isinstance(r, DeviceTrigger | DeviceIs) and r.device_id == device_id and r.capability not in used:
                used.append(r.capability)
    return used


# Nome do que sumiu (o rótulo da capacidade some junto com ela); o resto aparece pelo id.
_LOST = {
    REMOTE_KEY: "controle remoto", "power": "liga/desliga", "brightness": "brilho", "color_temp": "temperatura de cor",
    "color": "cor", "target_temp": "temperatura", "ac_mode": "modo", "fan_speed": "ventilação", "volume": "volume",
    "muted": "mudo", "source": "entrada", "fan_power": "potência", "start": "iniciar", "pause": "pausar",
    "dock": "voltar à base", "locate": "bipar",
}


def _value_label(caps: dict[str, Any], key: str) -> str:
    if key == REMOTE_KEY:
        return "Tecla"
    cap = caps.get(key)
    return cap.label if cap else key


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} e {items[-1]}"


def _virtual_refs(item: Automation | Routine) -> set[str]:
    refs = {a.virtual_id for a in item.actions if isinstance(a, VirtualAction)}
    if isinstance(item, Automation):
        if isinstance(item.trigger, VirtualTrigger):
            refs.add(item.trigger.virtual_id)
        refs |= {c.virtual_id for c in item.conditions if isinstance(c, VirtualIs)}
    return refs


def _get(items: dict[str, Any], key: str | None) -> Any:
    if key is None or key not in items:
        raise NotFound(key)
    return items[key]


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"
