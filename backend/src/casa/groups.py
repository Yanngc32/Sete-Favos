"""Grupos de aparelhos: um grupo é um aparelho cujos controles e estado vêm dos membros.

- Controles = interseção do que todos os membros aceitam (mesmo id e tipo; faixas e opções cruzadas).
- Estado: ligado se algum membro ligado; nível = média dos ligados; texto/cor = o valor mais comum.
- Online se algum membro responde; offline só quando todos estão offline.
Funções puras: o Hub fornece os membros e aplica o resultado.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from casa.adapters.base import Adapter, AdapterError, Driver, Found
from casa.model import Capability, DeviceRecord, Kind, Option

GROUP_VENDOR = "grupo"
MIN_MEMBERS = 2
MAX_MEMBERS = 20


@dataclass
class Member:
    id: str
    name: str
    kind: Kind
    online: bool | None
    state: dict[str, Any]
    caps: list[Capability]
    last_seen: float | None = None


def common_capabilities(members: list[Member]) -> list[Capability]:
    if not members:
        return []
    out: list[Capability] = []
    for cap in members[0].caps:
        if cap.readonly or cap.type == "text":
            continue
        others = [next((c for c in m.caps if c.id == cap.id and c.type == cap.type and not c.readonly), None)
                  for m in members[1:]]
        if any(o is None for o in others):
            continue
        merged = _merge(cap, [o for o in others if o is not None])
        if merged is not None:
            out.append(merged)
    return out


def _merge(first: Capability, rest: list[Capability]) -> Capability | None:
    group = [first, *rest]
    if first.type in ("int", "float"):
        lows = [c.min for c in group if c.min is not None]
        highs = [c.max for c in group if c.max is not None]
        steps = [c.step for c in group if c.step is not None]
        low = max(lows) if lows else None
        high = min(highs) if highs else None
        if low is not None and high is not None and low > high:
            return None
        return first.model_copy(update={"min": low, "max": high, "step": max(steps) if steps else None})
    if first.type == "enum":
        keep = [o for o in first.options or [] if all(o.value in {x.value for x in c.options or []} for c in rest)]
        if not keep:
            return None
        return first.model_copy(update={"options": [Option(value=o.value, label=o.label) for o in keep]})
    return first


def group_kind(kinds: list[Kind]) -> Kind:
    return kinds[0] if kinds and all(k == kinds[0] for k in kinds) else "other"


def group_online(members: list[Member]) -> bool | None:
    if any(m.online is True for m in members):
        return True
    if members and all(m.online is False for m in members):
        return False
    return None


def group_state(caps: list[Capability], members: list[Member]) -> dict[str, Any]:
    alive = [m for m in members if m.online is not False]
    state: dict[str, Any] = {}
    for cap in caps:
        if cap.type == "action":
            continue
        values = [(m, m.state[cap.id]) for m in alive if m.state.get(cap.id) is not None]
        if not values:
            continue
        if cap.type == "bool":
            state[cap.id] = any(bool(v) for _, v in values)
        elif cap.type in ("int", "float"):
            lit = [v for m, v in values if m.state.get("power") is not False] or [v for _, v in values]
            mean = sum(lit) / len(lit)
            state[cap.id] = round(mean) if cap.type == "int" else round(mean, 1)
        else:
            state[cap.id] = Counter(v for _, v in values).most_common(1)[0][0]
    state["group_total"] = len(members)
    state["group_on"] = sum(1 for m in alive if m.state.get("power") is True)
    state["group_offline"] = sum(1 for m in members if m.online is False)
    return state


class GroupDriver(Driver):
    """Só informa; o Hub trata comando e estado do grupo direto nos membros."""

    poll_interval = 3600.0

    def __init__(self, record: DeviceRecord, vault: Any, hub: Any) -> None:
        super().__init__(record, vault)
        self._hub = hub

    def capabilities(self) -> list[Capability]:
        return self._hub.group_capabilities(self.record)

    async def refresh(self) -> dict[str, Any]:
        return {}

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        raise AdapterError("nao_suportado", "O grupo manda o comando para cada aparelho dele.")


class GroupAdapter(Adapter):
    vendor = GROUP_VENDOR
    label = "Grupo"
    description = "Vários aparelhos controlados juntos"

    def __init__(self, vault: Any, hub: Any) -> None:
        super().__init__(vault)
        self._hub = hub

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        return None

    def driver(self, record: DeviceRecord) -> Driver:
        return GroupDriver(record, self.vault, self._hub)
