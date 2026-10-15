"""Nascer e pôr do sol (algoritmo simplificado da NOAA, erro de ~1 min; sem dependência externa).

Horários na hora local do PC (o fuso do Windows, inclusive horário de verão se houver).
"""

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta

# 90°50': centro do sol no horizonte + refração atmosférica + raio aparente.
_ZENITH = math.radians(90.833)


def _utc_minutes(day: date, lat: float, lon: float) -> tuple[float, float] | None:
    gamma = 2 * math.pi / 365 * (day.timetuple().tm_yday - 1)
    eqtime = 229.18 * (
        0.000075 + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
    )
    phi = math.radians(lat)
    cos_ha = math.cos(_ZENITH) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
    if not -1 <= cos_ha <= 1:
        return None  # sol da meia-noite ou noite polar
    ha = math.degrees(math.acos(cos_ha))
    return 720 - 4 * (lon + ha) - eqtime, 720 - 4 * (lon - ha) - eqtime


def sun_times(day: date, lat: float, lon: float) -> tuple[datetime, datetime] | None:
    """(nascer, pôr) do dia, em datetime local sem fuso (como o relógio do motor)."""
    mins = _utc_minutes(day, lat, lon)
    if mins is None:
        return None
    noon = datetime.combine(day, time(12)).astimezone()  # fuso do PC nesse dia
    offset = (noon.utcoffset() or timedelta()).total_seconds() / 60
    start = datetime.combine(day, time())
    return start + timedelta(minutes=mins[0] + offset), start + timedelta(minutes=mins[1] + offset)
