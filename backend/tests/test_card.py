"""Aparência do card (tamanho e o que mostra): salva no registro, volta na view, sai ao vivo, vale pra grupo."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from test_api import add_all

from casa.dashboard import DashView
from casa.model import CardPrefs, DeviceRecord


def test_patch_card_is_validated_saved_and_published(pc) -> None:
    devices = add_all(pc)
    light = next(d for d in devices if d["name"] == "Luz da sala")
    assert light["card"] is None
    with pc.websocket_connect("ws://localhost:8484/api/ws", headers={"Origin": "http://localhost:8484"}) as ws:
        ws.receive_json()  # snapshot
        r = pc.patch(f"/api/devices/{light['id']}", json={"card": {"size": "s", "show": {"room": False}}})
        assert r.status_code == 200
        assert r.json()["card"] == {"size": "s", "show": {"room": False}}
        for _ in range(20):
            event = ws.receive_json()
            if event["t"] == "device" and event["device"]["id"] == light["id"] and event["device"]["card"]:
                assert event["device"]["card"]["size"] == "s"
                break
        else:
            raise AssertionError("evento do card não chegou")
    assert pc.get(f"/api/devices/{light['id']}").json()["card"]["show"]["room"] is False
    # Mudar o nome não mexe no card.
    assert pc.patch(f"/api/devices/{light['id']}", json={"name": "Luz"}).json()["card"]["size"] == "s"


@pytest.mark.parametrize(
    "card",
    [{"size": "xl"}, {"show": {"cor": True}}, {"show": {"room": "sim"}}, {"tamanho": "s"},
     # existe no catálogo, mas não é de luz
     {"show": {"mute": False}}, {"show": {"remote": False}}, {"show": {"members": False}}],
)
def test_invalid_card_is_rejected(pc, card) -> None:
    light = next(d for d in add_all(pc) if d["name"] == "Luz da sala")
    r = pc.patch(f"/api/devices/{light['id']}", json={"card": card})
    assert r.status_code == 422
    assert pc.get(f"/api/devices/{light['id']}").json()["card"] is None


def test_back_to_default(pc) -> None:
    light = next(d for d in add_all(pc) if d["name"] == "Luz da sala")
    url = f"/api/devices/{light['id']}"
    pc.patch(url, json={"card": {"size": "l"}}).raise_for_status()
    # Tudo vazio também é "padrão".
    assert pc.patch(url, json={"card": {"size": None, "show": {}}}).json()["card"] is None
    pc.patch(url, json={"card": {"show": {"quick": False}}}).raise_for_status()
    assert pc.patch(url, json={"clear_card": True}).json()["card"] is None


def test_group_card_and_restart_roundtrip(pc) -> None:
    devices = add_all(pc)
    lights = [d["id"] for d in devices if d["kind"] == "light"][:2]
    group = pc.post("/api/groups", json={"name": "Luzes", "room": "Sala", "members": lights}).json()
    r = pc.patch(f"/api/devices/{group['id']}", json={"card": {"size": "l", "show": {"status": False}}})
    assert r.status_code == 200 and r.json()["card"]["size"] == "l"
    assert next(d for d in pc.get("/api/devices").json() if d["id"] == group["id"])["card"]["show"]["status"] is False


def test_record_without_card_still_loads() -> None:
    old = {"id": "a", "vendor": "simulado", "kind": "light", "name": "Luz", "room": None, "pinned": False, "config": {}}
    assert DeviceRecord.model_validate(old).card is None
    assert CardPrefs(size=None).normalized() is None


def test_dashboard_card_override() -> None:
    v = DashView.model_validate({
        "id": "v", "name": "Casa", "sections": [{"id": "s", "cards": [
            {"id": "a", "type": "device", "device_id": "luz", "size": "s", "show": {"room": False}},
            {"id": "b", "type": "summary", "cols": 4, "size": "l"},
            {"id": "c", "type": "device", "device_id": "tv", "show": {}},
        ]}],
    })
    a, b, c = v.sections[0].cards
    assert a.size == "s" and a.show == {"room": False}
    assert b.size is None and b.show is None  # só card de aparelho tem tamanho
    assert c.show is None
    with pytest.raises(ValidationError):
        DashView.model_validate({"id": "v", "name": "Casa", "sections": [{"id": "s", "cards": [
            {"id": "a", "type": "device", "device_id": "luz", "size": "gigante"}]}]})


def test_show_keys_by_kind(pc) -> None:
    devices = {d["kind"]: d for d in add_all(pc)}
    ok = {
        "light": {"color": False, "palette": False, "nudge": True, "level": False},
        "tv": {"source": False, "mute": False, "remote": False, "power": True},
        "ac": {"current": False, "mode": False, "fan": False, "nudge": False},
        "vacuum": {"fan_power": False, "actions": False, "dock": False},
        "switch": {"keynames": False, "all": False},
        "plug": {"level": False, "room": False},
    }
    for kind, show in ok.items():
        r = pc.patch(f"/api/devices/{devices[kind]['id']}", json={"card": {"show": show}})
        assert r.status_code == 200, (kind, r.json())
        assert r.json()["card"]["show"] == show
    bad = {"tv": {"palette": False}, "ac": {"mute": False}, "plug": {"dock": False}, "vacuum": {"color": False}}
    for kind, show in bad.items():
        r = pc.patch(f"/api/devices/{devices[kind]['id']}", json={"card": {"show": show}})
        assert r.status_code == 422 and "não tem" in r.json()["detail"], kind


def test_group_keys_and_kind_change(pc) -> None:
    devices = add_all(pc)
    lights = [d["id"] for d in devices if d["kind"] == "light"][:2]
    group = pc.post("/api/groups", json={"name": "Luzes", "room": "Sala", "members": lights}).json()
    r = pc.patch(f"/api/devices/{group['id']}", json={"card": {"show": {"members": False, "offline": False, "color": False}}})
    assert r.status_code == 200
    # Aparelho comum não tem as chaves de grupo.
    assert pc.patch(f"/api/devices/{lights[0]}", json={"card": {"show": {"offline": False}}}).status_code == 422
    # Trocar o tipo some com o que o tipo novo não tem.
    tv = next(d for d in devices if d["kind"] == "tv")
    pc.patch(f"/api/devices/{tv['id']}", json={"card": {"size": "l", "show": {"mute": False, "room": False}}}).raise_for_status()
    r = pc.patch(f"/api/devices/{tv['id']}", json={"kind": "plug"})
    assert r.json()["card"] == {"size": "l", "show": {"room": False}}


def test_legacy_saved_card_still_loads() -> None:
    # Formato da 1ª versão: as quatro chaves fixas com None.
    old = {"id": "a", "vendor": "simulado", "kind": "tv", "name": "TV", "room": None, "pinned": False, "config": {},
           "card": {"size": "m", "show": {"level": None, "room": False, "status": None, "quick": False}}}
    rec = DeviceRecord.model_validate(old)
    assert rec.card is not None and rec.card.show == {"room": False, "quick": False}
