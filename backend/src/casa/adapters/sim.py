"""Aparelhos simulados, só para desenvolver sem a casa por perto (CASA_SIMULAR=1)."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from casa.adapters.base import Adapter, Candidate, DeviceUnreachable, Driver, Found
from casa.adapters.caps import (
    REMOTE_KEYS,
    ac_caps,
    light_caps,
    plug_caps,
    switch_caps,
    tv_caps,
    vacuum_caps,
)
from casa.model import Capability, DeviceRecord

DEMO: list[dict[str, Any]] = [
    {"key": "sim-luz-sala", "name": "Luz da sala", "kind": "light", "room": "Sala",
     "state": {"power": True, "brightness": 70, "color_temp": 20}},
    {"key": "sim-fita-quarto", "name": "Fita LED do quarto", "kind": "light", "room": "Quarto", "rgb": True,
     "state": {"power": False, "brightness": 40, "color_temp": 10, "color": "#ff8a3d"}},
    {"key": "sim-cafeteira", "name": "Tomada da cafeteira", "kind": "plug", "room": "Cozinha",
     "state": {"power": False, "power_w": 0.0}},
    {"key": "sim-ar-quarto", "name": "Ar do quarto", "kind": "ac", "room": "Quarto",
     "state": {"power": True, "target_temp": 22.0, "current_temp": 26.0, "ac_mode": "cool", "fan_speed": "auto"}},
    {"key": "sim-tv-sala", "name": "TV da sala", "kind": "tv", "room": "Sala",
     "state": {"power": True, "volume": 18, "muted": False, "source": "netflix"}},
    {"key": "sim-interruptor", "name": "Interruptor do corredor", "kind": "switch", "room": "Corredor",
     "state": {"power": True, "switch_1": True, "switch_2": False, "switch_3": False}},
    {"key": "sim-robo", "name": "Robô H50 Pro", "kind": "vacuum", "room": "Sala",
     "state": {"vacuum_status": "docked", "battery": 100, "fan_power": "standard"}},
]

_TV_SOURCES = [("HDMI_1", "HDMI 1"), ("HDMI_2", "HDMI 2"), ("tv", "TV"), ("netflix", "Netflix"), ("youtube", "YouTube")]
_GANGS = [("switch_1", "Teto"), ("switch_2", "Arandela"), ("switch_3", "Varanda")]
_FAN_POWER = [("silent", "Silenciosa"), ("standard", "Padrão"), ("strong", "Forte"), ("max", "Máx")]


class SimAdapter(Adapter):
    vendor = "simulado"
    label = "Simulado"
    description = "Aparelhos de mentira para testar o painel"

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        for demo in DEMO:
            await asyncio.sleep(min(0.3, timeout / len(DEMO)))
            found(Candidate(
                key=demo["key"], vendor=self.vendor, name=demo["name"], model="Simulado",
                ip="127.0.0.1", kind=demo["kind"], needs_pairing=demo["kind"] == "tv",
                config={"demo": demo["key"]},
            ))

    async def pair(self, candidate: Candidate) -> Candidate:
        if candidate.needs_pairing:
            await asyncio.sleep(1)
        return candidate

    def driver(self, record: DeviceRecord) -> Driver:
        return SimDriver(record, self.vault)


class SimDriver(Driver):
    poll_interval = 2.0

    def __init__(self, record: DeviceRecord, vault) -> None:
        super().__init__(record, vault)
        demo = next((d for d in DEMO if d["key"] == record.config.get("demo")), None)
        self._rgb = bool(demo and demo.get("rgb"))
        self._state: dict[str, Any] = dict(demo["state"]) if demo else {"power": False}
        self._offline = bool(record.config.get("offline"))
        self._last_tick = time.monotonic()

    def capabilities(self) -> list[Capability]:
        kind = self.record.kind
        if kind == "light":
            return light_caps(brightness=True, color_temp=True, color=self._rgb)
        if kind == "plug":
            return plug_caps(power_w=True)
        if kind == "ac":
            return ac_caps(16, 30, 1.0, ["cool", "heat", "fan", "dry", "auto"], ["auto", "low", "medium", "high"])
        if kind == "tv":
            return tv_caps(_TV_SOURCES)
        if kind == "vacuum":
            return vacuum_caps(_FAN_POWER)
        if kind == "switch":
            return switch_caps(_GANGS)
        return [Capability(id="power", type="bool", label="Ligado")]

    def remote_keys(self) -> tuple[str, ...]:
        return REMOTE_KEYS if self.record.kind == "tv" else ()

    async def remote(self, key: str) -> None:
        if not self._state.get("power"):
            raise DeviceUnreachable("TV desligada")
        # Simulado: volume e canal respondem; o resto só "aperta".
        if key in ("VOLUMEUP", "VOLUMEDOWN"):
            vol = int(self._state.get("volume", 0)) + (1 if key == "VOLUMEUP" else -1)
            self._state["volume"] = max(0, min(100, vol))
            self.push({"volume": self._state["volume"]})

    async def refresh(self) -> dict[str, Any]:
        if self._offline:
            raise DeviceUnreachable("simulado offline")
        self._tick()
        return dict(self._state)

    def _tick(self) -> None:
        now = time.monotonic()
        dt, self._last_tick = now - self._last_tick, now
        if self.record.kind == "vacuum":
            s = self._state
            if s["vacuum_status"] == "cleaning":
                s["battery"] = max(15, s["battery"] - dt * 0.2)
            elif s["vacuum_status"] == "returning":
                s["vacuum_status"] = "docked"
            elif s["vacuum_status"] == "docked":
                s["battery"] = min(100, s["battery"] + dt * 0.5)
            s["battery"] = round(s["battery"])

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        if self._offline:
            raise DeviceUnreachable("simulado offline")
        await asyncio.sleep(0.15)
        if capability in ("start", "pause", "dock", "locate"):
            status = {"start": "cleaning", "pause": "paused", "dock": "returning"}.get(capability)
            if status:
                self._state["vacuum_status"] = status
            return {"vacuum_status": self._state.get("vacuum_status")}
        self._state[capability] = value
        if self.record.kind == "switch":
            # Como o Tuya: "power" vale para todas as teclas; o aparelho está ligado se alguma estiver.
            gangs = [g for g, _ in _GANGS]
            if capability == "power":
                self._state.update(dict.fromkeys(gangs, value))
            self._state["power"] = any(self._state.get(g) for g in gangs)
            return {g: self._state.get(g) for g in gangs} | {"power": self._state["power"]}
        if capability == "power" and self.record.kind == "plug":
            self._state["power_w"] = 1120.0 if value else 0.0
            return {"power": value, "power_w": self._state["power_w"]}
        if capability in ("brightness", "color_temp", "color", "target_temp") and "power" in self._state:
            self._state["power"] = True
            return {capability: value, "power": True}
        return {capability: value}
