"""Clima de agora na casa (card da Início), pela Open-Meteo: sem chave e sem conta.

Só sai da colmeia a posição arredondada (~1 km), e o resultado fica em cache por 10 min.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from casa.home import Home

_URL = "https://api.open-meteo.com/v1/forecast"
_TTL = 600.0
_FAIL_TTL = 60.0

# Códigos WMO (https://open-meteo.com/en/docs) → texto curto + ícone lucide.
_WMO: list[tuple[set[int], str, str]] = [
    ({0}, "Céu limpo", "sun"),
    ({1}, "Poucas nuvens", "cloud-sun"),
    ({2}, "Parcialmente nublado", "cloud-sun"),
    ({3}, "Nublado", "cloud"),
    ({45, 48}, "Neblina", "cloud-fog"),
    ({51, 53, 55, 56, 57}, "Garoa", "cloud-drizzle"),
    ({61, 63, 65, 66, 67, 80, 81, 82}, "Chuva", "cloud-rain"),
    ({71, 73, 75, 77, 85, 86}, "Neve", "cloud-snow"),
    ({95, 96, 99}, "Tempestade", "cloud-lightning"),
]


def describe(code: int | None, is_day: bool) -> tuple[str, str]:
    for codes, text, icon in _WMO:
        if code in codes:
            if not is_day and icon == "sun":
                return text, "moon"
            if not is_day and icon == "cloud-sun":
                return text, "cloud-moon"
            return text, icon
    return "Sem dados", "cloud"


class Weather:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self._cache: tuple[float, tuple[float, float], dict[str, Any]] | None = None

    async def current(self, home: Home | None) -> dict[str, Any]:
        if home is None:
            return {"available": False, "reason": "sem_local"}
        pos = (round(home.lat, 2), round(home.lon, 2))
        now = time.monotonic()
        if self._cache and self._cache[1] == pos and now < self._cache[0]:
            return self._cache[2]
        try:
            data = await self._fetch(pos)
            self._cache = (now + _TTL, pos, data)
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            last = self._cache[2] if self._cache and self._cache[1] == pos else None
            # Falha passageira: segue mostrando o último tempo bom; sem nenhum, avisa indisponível.
            data = last if last and last.get("available") else {"available": False, "reason": "indisponivel"}
            # Guarda por pouco tempo: sem internet não vira uma chamada por pedido.
            self._cache = (now + _FAIL_TTL, pos, data)
        return data

    async def _fetch(self, pos: tuple[float, float]) -> dict[str, Any]:
        params = {
            "latitude": pos[0], "longitude": pos[1], "timezone": "auto",
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,visibility,is_day",
            "wind_speed_unit": "kmh",
        }
        client = self._client or httpx.AsyncClient(timeout=6.0)
        try:
            r = await client.get(_URL, params=params)
            r.raise_for_status()
            cur = r.json()["current"]
        finally:
            if self._client is None:
                await client.aclose()
        is_day = bool(cur.get("is_day", 1))
        text, icon = describe(cur.get("weather_code"), is_day)
        vis = cur.get("visibility")
        return {
            "available": True,
            "temp_c": round(float(cur["temperature_2m"])),
            "humidity": round(float(cur["relative_humidity_2m"])),
            "wind_kmh": round(float(cur["wind_speed_10m"])),
            "visibility_km": round(float(vis) / 1000) if vis is not None else None,
            "condition": text,
            "icon": icon,
            "is_day": is_day,
            "time": cur.get("time"),
        }
