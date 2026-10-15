"""Celular como sensor: bateria, carregando, em casa e distância, enviados pelo app Android.

Não é descoberto na rede: o app manda POST /api/phone/report com o pareamento dele e a central
cria (uma vez) o aparelho "Celular" ligado àquele acesso. Sem notícia há 45 min, aparece offline.
"""

from __future__ import annotations

import time
from typing import Any, ClassVar

from casa.adapters.base import Adapter, DeviceUnreachable, Driver, Found
from casa.home import Home, distance_m
from casa.model import Capability, DeviceRecord

VENDOR = "celular"
STALE_AFTER = 45 * 60
# Histerese: entra "em casa" dentro do raio e só sai passando do raio + isto (GPS oscila).
LEAVE_MARGIN_M = 100


def phone_caps() -> list[Capability]:
    return [
        Capability(id="battery", type="int", label="Bateria", readonly=True, min=0, max=100, unit="%"),
        Capability(id="charging", type="bool", label="Carregando", readonly=True),
        Capability(id="at_home", type="bool", label="Em casa", readonly=True),
        Capability(id="distance_km", type="float", label="Distância de casa", readonly=True, unit="km"),
    ]


def phone_state(report: dict[str, Any], home: Home | None, previous: dict[str, Any]) -> dict[str, Any]:
    """Estado do aparelho a partir do que o app mandou (lat/lon opcionais: sem permissão de local)."""
    state: dict[str, Any] = {
        "battery": int(report["battery"]),
        "charging": bool(report["charging"]),
        "updated_at": time.time(),
    }
    lat, lon = report.get("lat"), report.get("lon")
    if lat is None or lon is None:
        # Sem localização nova: mantém o que se sabia.
        for key in ("at_home", "distance_km", "lat", "lon", "accuracy_m", "located_at"):
            if key in previous:
                state[key] = previous[key]
        return state
    state.update(lat=lat, lon=lon, accuracy_m=report.get("accuracy_m"), located_at=time.time())
    if home is not None:
        dist = distance_m(home.lat, home.lon, lat, lon)
        was_home = previous.get("at_home") is True
        state["at_home"] = dist <= home.radius_m + (LEAVE_MARGIN_M if was_home else 0)
        state["distance_km"] = round(dist / 1000, 1)
    return state


class PhoneAdapter(Adapter):
    vendor = VENDOR
    label = "Celular"
    description = "Bateria e localização enviadas pelo app"
    # Não aparece em "Adicionar aparelho": quem cria é o próprio app.
    listed: ClassVar[bool] = False

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        return None

    def driver(self, record: DeviceRecord) -> Driver:
        return PhoneDriver(record, self.vault)


class PhoneDriver(Driver):
    poll_interval = 60.0

    def capabilities(self) -> list[Capability]:
        return phone_caps()

    def notes(self) -> list[str]:
        return ["Atualiza quando o app abre e a cada ~15 min em segundo plano."]

    async def refresh(self) -> dict[str, Any]:
        state = self.record.config.get("last_report") or {}
        if not state or time.time() - float(state.get("updated_at", 0)) > STALE_AFTER:
            raise DeviceUnreachable("sem notícias do celular")
        return dict(state)

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        raise DeviceUnreachable("o celular só informa")
