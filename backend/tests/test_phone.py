from __future__ import annotations

from starlette.testclient import TestClient

from casa.adapters.phone import phone_state
from casa.home import Home

CASA = (-22.9068, -43.1729)


def _offset(meters: float) -> tuple[float, float]:
    """Ponto `meters` ao norte da casa (1° de latitude ~ 111,2 km)."""
    return CASA[0] + meters / 111_200, CASA[1]


def test_at_home_has_hysteresis() -> None:
    home = Home(lat=CASA[0], lon=CASA[1], radius_m=150)
    near = phone_state({"battery": 80, "charging": False, "lat": _offset(100)[0], "lon": CASA[1]}, home, {})
    assert near["at_home"] is True and near["distance_km"] == 0.1
    # 200 m: fora do raio, mas estava em casa e não passou do raio + 100 m -> continua em casa.
    still = phone_state({"battery": 79, "charging": False, "lat": _offset(200)[0], "lon": CASA[1]}, home, near)
    assert still["at_home"] is True
    left = phone_state({"battery": 79, "charging": False, "lat": _offset(300)[0], "lon": CASA[1]}, home, still)
    assert left["at_home"] is False
    # 200 m vindo de fora: ainda fora (só entra dentro do raio).
    assert phone_state({"battery": 79, "charging": True, "lat": _offset(200)[0], "lon": CASA[1]}, home, left)["at_home"] is False
    # Sem localização: mantém o último local conhecido.
    no_loc = phone_state({"battery": 50, "charging": True}, home, left)
    assert no_loc["at_home"] is False and no_loc["battery"] == 50 and no_loc["lat"] == left["lat"]


def test_phone_report_creates_one_device_per_paired_phone(pc: TestClient, phone: TestClient) -> None:
    assert phone.post("/api/phone/report", json={"battery": 50, "charging": False}).status_code in (401, 403)
    code = pc.post("/api/access/pairing").json()["code"]
    phone.post("/api/access/pair", json={"code": code, "name": "S23"}).raise_for_status()

    r = phone.post("/api/phone/report", json={"battery": 64, "charging": True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "phone" and d["name"] == "S23" and d["vendor"] == "celular"
    assert d["state"]["battery"] == 64 and d["state"]["charging"] is True and "at_home" not in d["state"]

    pc.put("/api/home", json={"lat": CASA[0], "lon": CASA[1]}).raise_for_status()
    lat, lon = _offset(50)
    d2 = phone.post("/api/phone/report", json={"battery": 63, "charging": False, "lat": lat, "lon": lon}).json()
    assert d2["id"] == d["id"] and d2["state"]["at_home"] is True
    assert sum(1 for x in pc.get("/api/devices").json() if x["kind"] == "phone") == 1
    assert pc.get(f"/api/devices/{d['id']}").json()["online"] is True

    assert pc.post("/api/phone/report", json={"battery": 50, "charging": False}).status_code == 400
    assert phone.post("/api/phone/report", json={"battery": 150, "charging": False}).status_code == 422
    assert "celular" not in [v["vendor"] for v in pc.get("/api/vendors").json()]
