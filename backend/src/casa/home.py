"""Onde fica a casa: base do nascer/pôr do sol e da presença (celular em casa ou fora)."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from casa.store import Store
from casa.sun import sun_times

_DOC = "home"


class Home(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    # Raio de "em casa" para o celular (GPS de celular erra dezenas de metros).
    radius_m: int = Field(default=150, ge=50, le=5000)


def load_home(store: Store) -> Home | None:
    raw = store.get("settings", _DOC)
    return Home.model_validate(raw) if raw else None


def save_home(store: Store, home: Home) -> None:
    store.put("settings", _DOC, home.model_dump())


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância em metros (haversine)."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def home_view(home: Home | None, today: date) -> dict[str, Any]:
    if home is None:
        return {"lat": None, "lon": None, "radius_m": None, "sunrise": None, "sunset": None}
    times = sun_times(today, home.lat, home.lon)
    return {
        **home.model_dump(),
        "sunrise": times[0].strftime("%H:%M") if times else None,
        "sunset": times[1].strftime("%H:%M") if times else None,
    }
