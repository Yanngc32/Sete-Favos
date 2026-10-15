from __future__ import annotations

import asyncio

import pytest

from casa.adapters.base import Candidate
from casa.adapters.sim import SimAdapter
from casa.engine import Engine
from casa.events import EventBus
from casa.hub import CommandError, Hub, NotFound
from casa.store import Store
from casa.vault import MemoryKeyring, Vault


async def settle(hub: Hub) -> None:
    for _ in range(50):
        if all(hub.view(i).online for i in hub.ids()):
            return
        await asyncio.sleep(0.02)


async def add(hub: Hub, key: str, demo: str, kind: str, name: str | None = None) -> str:
    view = await hub.add_device(
        Candidate(key=key, vendor="simulado", name=name or key, kind=kind, config={"demo": demo}),
        name=name or key, room="Sala", kind=kind,
    )
    return view.id


@pytest.fixture
async def world(tmp_path):
    store = Store(tmp_path / "g.db")
    vault = Vault(MemoryKeyring())
    bus = EventBus()
    hub = Hub(store, vault, bus, {"simulado": SimAdapter(vault)})
    engine = Engine(store, hub, bus)
    await hub.start()
    await engine.start()
    ids = {
        "luz1": await add(hub, "l1", "sim-luz-sala", "light", "Luz 1"),
        "luz2": await add(hub, "l2", "sim-fita-quarto", "light", "Luz 2"),
        "luz3": await add(hub, "l3", "sim-luz-sala", "light", "Luz 3"),
        "tomada": await add(hub, "p1", "sim-cafeteira", "plug", "Tomada"),
        "ar": await add(hub, "a1", "sim-ar-quarto", "ac", "Ar"),
    }
    await settle(hub)
    yield store, vault, bus, hub, engine, ids
    await engine.stop()
    await hub.stop()


def caps(hub: Hub, group_id: str) -> set[str]:
    return {c.id for c in hub.view(group_id).capabilities}


async def test_common_controls_are_the_intersection(world) -> None:
    _, _, _, hub, _, ids = world
    lights = hub.create_group(name="Luzes", room="Sala", members=[ids["luz1"], ids["luz2"]])
    assert lights.kind == "light" and lights.vendor == "grupo" and lights.members == [ids["luz1"], ids["luz2"]]
    assert {"power", "brightness", "color_temp"} <= caps(hub, lights.id)
    mixed = hub.create_group(name="Luz e tomada", room=None, members=[ids["luz1"], ids["tomada"]])
    assert mixed.kind == "other" and caps(hub, mixed.id) == {"power"}
    ac = hub.create_group(name="Luz e ar", room=None, members=[ids["luz2"], ids["ar"]])
    assert caps(hub, ac.id) == {"power"}
    preview = hub.preview_group([ids["luz1"], ids["luz2"]])
    assert preview["kind"] == "light" and {c["id"] for c in preview["capabilities"]} >= {"power", "brightness"}


async def test_command_fans_out_and_state_follows_members(world) -> None:
    _, _, _, hub, _, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"], ids["luz3"]])
    await hub.command(ids["luz1"], "power", False)
    await hub.command(ids["luz2"], "power", False)
    await hub.command(ids["luz3"], "power", False)
    assert hub.state(g.id, "power") is False and hub.state(g.id, "group_on") == 0
    view = await hub.command(g.id, "brightness", 40)  # acende quem estava apagado
    assert view.partial is None
    for k in ("luz1", "luz2", "luz3"):
        assert hub.state(ids[k], "power") is True and hub.state(ids[k], "brightness") == 40
    assert hub.state(g.id, "power") is True and hub.state(g.id, "brightness") == 40
    assert hub.state(g.id, "group_on") == 3 and hub.state(g.id, "group_total") == 3
    await hub.command(g.id, "power", False)
    assert hub.state(g.id, "power") is False and hub.state(g.id, "group_on") == 0


async def test_level_is_the_mean_of_the_lit_members(world) -> None:
    _, _, _, hub, _, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"], ids["luz3"]])
    await hub.command(ids["luz1"], "brightness", 20)
    await hub.command(ids["luz2"], "brightness", 60)
    await hub.command(ids["luz3"], "power", False)
    assert hub.state(g.id, "power") is True
    assert hub.state(g.id, "brightness") == 40  # luz3 apagada não entra na média
    assert hub.state(g.id, "group_on") == 2


async def test_partial_result_and_all_offline(world) -> None:
    _, _, _, hub, _, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"]])
    hub._entries[ids["luz2"]].online = False
    hub._sync_groups_of(ids["luz2"])
    assert hub.view(g.id).online is True and hub.state(g.id, "group_offline") == 1
    view = await hub.command(g.id, "brightness", 55)
    assert view.partial == {"ok": 1, "total": 2, "failed": ["Luz 2"]}
    assert hub.state(ids["luz1"], "brightness") == 55
    hub._entries[ids["luz1"]].online = False
    hub._sync_groups_of(ids["luz1"])
    assert hub.view(g.id).online is False
    with pytest.raises(CommandError):
        await hub.command(g.id, "power", True)


async def test_group_works_inside_routines_and_reports_partial(world) -> None:
    _, _, _, hub, engine, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"]])
    r = engine.save_routine({"name": "Apagar", "actions": [
        {"type": "device", "device_id": g.id, "capability": "power", "value": False},
    ]})
    result = await engine.run_routine(r.id)
    assert result.succeeded == result.total == 1
    hub._entries[ids["luz2"]].online = False
    hub._sync_groups_of(ids["luz2"])
    result = await engine.run_routine(r.id)
    assert result.succeeded == 0 and "1 de 2 ok" in result.errors[0] and "Luz 2" in result.errors[0]


async def test_validation(world) -> None:
    _, _, _, hub, _, ids = world
    with pytest.raises(ValueError, match="pelo menos 2"):
        hub.create_group(name="X", room=None, members=[ids["luz1"]])
    with pytest.raises(ValueError, match="uma vez só"):
        hub.create_group(name="X", room=None, members=[ids["luz1"], ids["luz1"]])
    with pytest.raises(ValueError, match="nome"):
        hub.create_group(name="  ", room=None, members=[ids["luz1"], ids["luz2"]])
    with pytest.raises(NotFound):
        hub.create_group(name="X", room=None, members=[ids["luz1"], "nao-existe"])
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"]])
    with pytest.raises(ValueError, match="Já existe"):
        hub.create_group(name="luzes", room=None, members=[ids["luz1"], ids["luz3"]])
    with pytest.raises(ValueError, match="outro grupo"):
        hub.create_group(name="Dentro", room=None, members=[g.id, ids["luz3"]])
    with pytest.raises(ValueError, match="no máximo 20"):
        hub.create_group(name="Muitos", room=None, members=[f"m{i}" for i in range(21)])
    other = hub.create_group(name="Outras", room=None, members=[ids["luz2"], ids["luz3"]])
    with pytest.raises(ValueError, match="Já existe"):
        hub.update_device(other.id, name=" LUZES ")
    assert hub.update_device(other.id, name="Outras").name == "Outras"
    assert hub.update_device(ids["luz3"], name="Luzes").name == "Luzes"  # aparelho comum pode repetir
    with pytest.raises(CommandError):
        await hub.test(g.id)


async def test_update_members_and_prune_on_removal(world) -> None:
    store, _, bus, hub, _, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["luz1"], ids["luz2"]])
    hub.set_group_members(g.id, [ids["luz1"], ids["luz2"], ids["luz3"]])
    assert hub.view(g.id).members == [ids["luz1"], ids["luz2"], ids["luz3"]]
    await hub.remove_device(ids["luz3"])
    assert hub.view(g.id).members == [ids["luz1"], ids["luz2"]]
    sub = bus.subscribe()
    await hub.remove_device(ids["luz2"])  # sobra 1 membro: o grupo some
    assert not hub.has(g.id)
    assert g.id not in {r["id"] for r in store.all("devices")}
    events = []
    while not sub.queue.empty():
        events.append(sub.queue.get_nowait())
    assert any(e.get("t") == "device_removed" and e.get("id") == g.id for e in events)


async def test_group_survives_restart(world, tmp_path) -> None:
    store, vault, bus, hub, _, ids = world
    g = hub.create_group(name="Luzes", room="Sala", members=[ids["luz1"], ids["luz2"]])
    await hub.command(g.id, "brightness", 33)
    hub2 = Hub(store, vault, EventBus(), {"simulado": SimAdapter(vault)})
    await hub2.start()
    try:
        await settle(hub2)
        view = hub2.view(g.id)
        assert view.name == "Luzes" and view.members == [ids["luz1"], ids["luz2"]]
        assert "brightness" in {c.id for c in view.capabilities}
    finally:
        await hub2.stop()


def test_groups_over_http(pc) -> None:
    hub = pc.app.state.ctx.hub
    ids = [
        pc.portal.call(add, hub, key, "sim-luz-sala", "light", key) for key in ("h1", "h2")
    ]
    assert pc.post("/api/groups", json={"name": "Dupla", "members": ids[:1]}).status_code == 400
    r = pc.post("/api/groups", json={"name": "Dupla", "room": "Sala", "members": ids})
    assert r.status_code == 201 and r.json()["vendor"] == "grupo" and r.json()["members"] == ids
    gid = r.json()["id"]
    assert pc.post("/api/groups/preview", json={"members": ids}).json()["kind"] == "light"
    cmd = pc.post(f"/api/devices/{gid}/command", json={"capability": "brightness", "value": 30})
    assert cmd.status_code == 200 and cmd.json()["state"]["brightness"] == 30
    assert pc.put(f"/api/groups/{gid}/members", json={"members": ids[:1]}).status_code == 400
    assert pc.delete(f"/api/devices/{gid}").status_code == 204
    assert pc.get(f"/api/devices/{gid}").status_code == 404
    assert pc.post("/api/groups", json={"name": "x" * 41, "members": ids}).status_code == 422
