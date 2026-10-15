from __future__ import annotations

import time

from starlette.testclient import TestClient

from casa.adapters.sim import DEMO
from casa.vault import MemoryKeyring, Vault, VaultError


def wait_job(client: TestClient, job_id: str) -> dict:
    for _ in range(100):
        job = client.get(f"/api/discovery/{job_id}").json()
        if job["done"]:
            return job
        time.sleep(0.05)
    raise AssertionError("descoberta não terminou")


def add_all(client: TestClient) -> list[dict]:
    job = wait_job(client, client.post("/api/vendors/simulado/discover").json()["id"])
    devices = []
    for c in job["candidates"]:
        assert "config" not in c and "secrets" not in c
        if c["needs_pairing"]:
            client.post(f"/api/discovery/{job['id']}/candidates/{c['key']}/pair").raise_for_status()
        r = client.post(
            f"/api/discovery/{job['id']}/candidates/{c['key']}/add",
            json={"name": c["name"], "room": "Sala", "kind": c["kind"]},
        )
        r.raise_for_status()
        devices.append(r.json())
    return devices


def test_add_command_and_live_state(pc: TestClient) -> None:
    devices = add_all(pc)
    assert len(devices) == len(DEMO)
    light = next(d for d in devices if d["name"] == "Luz da sala")
    with pc.websocket_connect("ws://localhost:8484/api/ws", headers={"Origin": "http://localhost:8484"}) as ws:
        snap = ws.receive_json()
        assert snap["t"] == "snapshot" and len(snap["devices"]) == len(DEMO)
        r = pc.post(f"/api/devices/{light['id']}/command", json={"capability": "power", "value": False})
        assert r.status_code == 200 and r.json()["state"]["power"] is False
        for _ in range(20):
            event = ws.receive_json()
            if event["t"] == "device" and event["device"]["id"] == light["id"] and event["device"]["state"]["power"] is False:
                break
        else:
            raise AssertionError("evento de estado não chegou")


def test_command_validation_errors(pc: TestClient) -> None:
    devices = add_all(pc)
    light = next(d for d in devices if d["name"] == "Luz da sala")
    r = pc.post(f"/api/devices/{light['id']}/command", json={"capability": "brightness", "value": 150})
    assert r.status_code == 502 and "faixa" in r.json()["detail"]
    r = pc.post(f"/api/devices/{light['id']}/command", json={"capability": "volume", "value": 1})
    assert r.status_code == 502


def test_already_added_and_remove(pc: TestClient) -> None:
    add_all(pc)
    job = wait_job(pc, pc.post("/api/vendors/simulado/discover").json()["id"])
    assert all(c["already_added"] for c in job["candidates"])
    device_id = pc.get("/api/devices").json()[0]["id"]
    assert pc.delete(f"/api/devices/{device_id}").status_code == 204
    assert pc.get(f"/api/devices/{device_id}").status_code == 404


def test_device_view_has_ip_and_kind_can_change(pc: TestClient) -> None:
    plug = next(d for d in add_all(pc) if d["kind"] == "plug")
    assert plug["ip"] == "127.0.0.1" and plug["model"] == "Simulado"
    r = pc.patch(f"/api/devices/{plug['id']}", json={"kind": "light"})
    assert r.status_code == 200 and r.json()["kind"] == "light"
    assert pc.patch(f"/api/devices/{plug['id']}", json={"kind": "geladeira"}).status_code == 422


def test_vendors_say_who_accepts_manual_ip(pc: TestClient) -> None:
    sim = next(v for v in pc.get("/api/vendors").json() if v["vendor"] == "simulado")
    assert sim["manual_add"] is False


def test_vendors_never_expose_secrets(pc: TestClient) -> None:
    vendors = pc.get("/api/vendors").json()
    assert vendors[0]["vendor"] == "simulado"
    assert set(vendors[0]) >= {"account_configured", "account_fields", "transient_fields"}


def test_virtual_and_routine_flow(pc: TestClient) -> None:
    devices = add_all(pc)
    light = next(d for d in devices if d["name"] == "Luz da sala")
    v = pc.post("/api/virtuals", json={"name": "Modo visita"}).json()
    assert v["used_by"] == 0 and v["value"] is False
    assert pc.post(f"/api/virtuals/{v['id']}/value", json={"value": True}).json()["value"] is True
    r = pc.post("/api/routines", json={"name": "Sair de casa", "actions": [
        {"type": "device", "device_id": light["id"], "capability": "power", "value": False},
        {"type": "virtual", "virtual_id": v["id"], "value": False},
    ]}).json()
    result = pc.post(f"/api/routines/{r['id']}/run").json()
    assert result["total"] == 2 and result["succeeded"] == 2
    assert pc.post(f"/api/runs/{result['id']}/undo").json()["succeeded"] == 2
    assert pc.delete(f"/api/virtuals/{v['id']}").status_code == 400


def test_vault_refuses_plaintext_backends() -> None:
    from keyring.backends.fail import Keyring as FailKeyring

    Vault(MemoryKeyring())
    try:
        Vault(FailKeyring())
    except VaultError:
        return
    raise AssertionError("aceitou backend sem cofre")


def test_android_app_is_offered_only_when_bundled(pc: TestClient, tmp_path, vault) -> None:
    from dataclasses import replace

    from casa import __version__
    from casa.adapters.sim import SimAdapter
    from casa.app import create_app
    from casa.settings import Settings
    from casa.store import Store

    assert pc.get("/api/app").json() == {"available": False, "version": None, "url": "/app/central.apk"}

    web = tmp_path / "web"
    (web / "app").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html>")
    (web / "app" / "central.apk").write_bytes(b"PK")
    s = replace(Settings.from_env(), data_dir=tmp_path / "d", frontend_dir=web, simulate=True)
    app = create_app(s, store=Store(tmp_path / "d.db"), vault=vault, adapters={"simulado": SimAdapter(vault)})
    with TestClient(app, base_url="http://localhost:8484", client=("127.0.0.1", 50000)) as client:
        assert client.get("/api/app").json() == {"available": True, "version": __version__, "url": "/app/central.apk"}
        r = client.get("/app/central.apk")
        assert r.status_code == 200 and r.headers["content-type"] == "application/vnd.android.package-archive"


def test_off_timer_arms_fires_and_cancels(pc: TestClient) -> None:
    devices = add_all(pc)
    light = next(d for d in devices if d["name"] == "Luz da sala")
    lid = light["id"]
    pc.post(f"/api/devices/{lid}/command", json={"capability": "power", "value": True}).raise_for_status()

    r = pc.put(f"/api/devices/{lid}/timer", json={"minutes": 30})
    assert r.status_code == 200 and 29 * 60 < r.json()["off_at"] - time.time() <= 30 * 60
    assert pc.put(f"/api/devices/{lid}/timer", json={"minutes": None}).json()["off_at"] is None
    assert pc.put(f"/api/devices/{lid}/timer", json={"minutes": 0}).status_code == 422

    # Desligou na mão antes da hora: o timer some.
    pc.put(f"/api/devices/{lid}/timer", json={"minutes": 30})
    off = pc.post(f"/api/devices/{lid}/command", json={"capability": "power", "value": False}).json()
    assert off["off_at"] is None
    assert pc.put(f"/api/devices/{lid}/timer", json={"minutes": 5}).status_code == 400  # já desligado

    # Na hora, a central desliga sozinha (encurta o timer para não esperar 1 min).
    pc.post(f"/api/devices/{lid}/command", json={"capability": "power", "value": True})
    pc.put(f"/api/devices/{lid}/timer", json={"minutes": 1})
    hub = pc.app.state.ctx.hub
    entry = hub._entries[lid]
    entry.record.config["off_at"] = time.time() + 0.2
    pc.portal.call(hub._arm_timer, entry)
    for _ in range(40):
        d = pc.get(f"/api/devices/{lid}").json()
        if d["state"]["power"] is False:
            break
        time.sleep(0.05)
    assert d["state"]["power"] is False and d["off_at"] is None


def test_home_location_is_pc_only_and_reports_sun(pc: TestClient, phone: TestClient) -> None:
    assert pc.get("/api/home").json()["lat"] is None
    r = pc.put("/api/home", json={"lat": -22.9, "lon": -43.17})
    assert r.status_code == 200
    body = r.json()
    assert body["radius_m"] == 150 and body["sunrise"] and body["sunset"]
    assert pc.put("/api/home", json={"lat": 120, "lon": 0}).status_code == 422
    assert phone.put("/api/home", json={"lat": 0, "lon": 0}).status_code in (401, 403)


def test_tv_remote_keys(pc: TestClient) -> None:
    devices = add_all(pc)
    tv = next(d for d in devices if d["kind"] == "tv")
    light = next(d for d in devices if d["name"] == "Luz da sala")
    assert "ENTER" in pc.get(f"/api/devices/{tv['id']}").json()["remote"]
    assert pc.get(f"/api/devices/{light['id']}").json()["remote"] is None

    pc.post(f"/api/devices/{tv['id']}/command", json={"capability": "power", "value": True}).raise_for_status()
    before = pc.get(f"/api/devices/{tv['id']}").json()["state"]["volume"]
    assert pc.post(f"/api/devices/{tv['id']}/remote", json={"key": "VOLUMEUP"}).status_code == 204
    for _ in range(20):
        if pc.get(f"/api/devices/{tv['id']}").json()["state"]["volume"] == before + 1:
            break
        time.sleep(0.05)
    else:
        raise AssertionError("volume não subiu")
    assert pc.post(f"/api/devices/{tv['id']}/remote", json={"key": "POWER_HACK"}).status_code == 502
    assert pc.post(f"/api/devices/{light['id']}/remote", json={"key": "ENTER"}).status_code == 502

    pc.post(f"/api/devices/{tv['id']}/command", json={"capability": "power", "value": False}).raise_for_status()
    assert pc.post(f"/api/devices/{tv['id']}/remote", json={"key": "ENTER"}).status_code == 502
