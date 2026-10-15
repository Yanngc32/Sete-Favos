from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from casa.adapters.base import Candidate
from casa.adapters.sim import SimAdapter
from casa.engine import STORM_LIMIT, Engine, EngineError
from casa.events import EventBus
from casa.hub import Hub
from casa.store import Store
from casa.vault import MemoryKeyring, Vault


class Now:
    def __init__(self) -> None:
        self.value = datetime(2026, 10, 12, 22, 30)  # segunda-feira

    def __call__(self) -> datetime:
        return self.value


async def settle(hub: Hub) -> None:
    for _ in range(50):
        if all(hub.view(i).online for i in hub.ids()):
            return
        await asyncio.sleep(0.02)


@pytest.fixture
async def world(tmp_path):
    store = Store(tmp_path / "t.db")
    vault = Vault(MemoryKeyring())
    bus = EventBus()
    sim = SimAdapter(vault)
    hub = Hub(store, vault, bus, {"simulado": sim})
    now = Now()
    engine = Engine(store, hub, bus, now=now)
    await hub.start()
    await engine.start()
    ids = {}
    for key, kind in (("sim-luz-sala", "light"), ("sim-fita-quarto", "light"), ("sim-ar-quarto", "ac"),
                      ("sim-robo", "vacuum")):
        view = await hub.add_device(
            Candidate(key=key, vendor="simulado", name=key, kind=kind, config={"demo": key}),
            name=key, room="Sala", kind=kind,
        )
        ids[key] = view.id
    await settle(hub)
    yield store, hub, engine, now, ids
    await engine.stop()
    await hub.stop()


async def wait_for(predicate, timeout: float = 2.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.02)


async def test_time_trigger_with_virtual_condition(world) -> None:
    store, hub, engine, now, ids = world
    dormindo = engine.save_virtual({"name": "Dormindo"})
    a = engine.save_automation({
        "name": "Ar antes de dormir",
        "trigger": {"type": "time", "at": "22:30", "days": [0, 1, 2, 3, 4, 5, 6]},
        "conditions": [{"type": "virtual_is", "virtual_id": dormindo.id, "value": False}],
        "actions": [{"type": "device", "device_id": ids["sim-ar-quarto"], "capability": "target_temp", "value": 23}],
    })
    engine.tick(now())
    await wait_for(lambda: engine.automations[a.id].last_run is not None)
    assert hub.state(ids["sim-ar-quarto"], "target_temp") == 23.0
    assert engine.automations[a.id].last_run.succeeded == 1

    # Mesma minuto não dispara de novo; condição falsa não dispara.
    engine.set_virtual(dormindo.id, True)
    hub_value = hub.state(ids["sim-ar-quarto"], "target_temp")
    await hub.command(ids["sim-ar-quarto"], "target_temp", 20)
    now.value = now.value.replace(day=13)
    engine.tick(now())
    await asyncio.sleep(0.2)
    assert hub.state(ids["sim-ar-quarto"], "target_temp") == 20.0 != hub_value


async def test_device_trigger_ignores_unknown_initial_state(world) -> None:
    _, hub, engine, _, ids = world
    a = engine.save_automation({
        "name": "Robô quando luz apagar",
        "trigger": {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "power", "to": False},
        "actions": [{"type": "device", "device_id": ids["sim-robo"], "capability": "start"}],
    })
    await hub.command(ids["sim-luz-sala"], "power", False)
    await wait_for(lambda: engine.automations[a.id].last_run is not None)
    assert hub.state(ids["sim-robo"], "vacuum_status") == "cleaning"


async def test_routine_undo_restores_previous_state(world) -> None:
    _, hub, engine, _, ids = world
    r = engine.save_routine({"name": "Cinema", "actions": [
        {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "brightness", "value": 15},
    ]})
    before = hub.state(ids["sim-luz-sala"], "brightness")
    result = await engine.run_routine(r.id)
    assert result.succeeded == result.total == 1
    assert hub.state(ids["sim-luz-sala"], "brightness") == 15
    await engine.undo(result.id)
    assert hub.state(ids["sim-luz-sala"], "brightness") == before


async def test_brightness_turns_light_on_and_undo_turns_it_off(world) -> None:
    _, hub, engine, _, ids = world
    fita = ids["sim-fita-quarto"]
    assert hub.state(fita, "power") is False
    r = engine.save_routine({"name": "Leitura", "actions": [
        {"type": "device", "device_id": fita, "capability": "brightness", "value": 60},
    ]})
    result = await engine.run_routine(r.id)
    assert hub.state(fita, "power") is True and hub.state(fita, "brightness") == 60
    await engine.undo(result.id)
    assert hub.state(fita, "power") is False
    assert hub.state(fita, "brightness") == 40


async def test_delay_returns_pending_and_finishes_in_background(world, monkeypatch) -> None:
    _, hub, engine, _, ids = world
    real_sleep = asyncio.sleep
    monkeypatch.setattr("casa.engine.asyncio.sleep", lambda s: real_sleep(0.05))
    r = engine.save_routine({"name": "Café", "actions": [
        {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "power", "value": True},
        {"type": "delay", "minutes": 40},
        {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "power", "value": False},
    ]})
    result = await engine.run_routine(r.id)
    assert result.pending and result.succeeded == 1
    await wait_for(lambda: engine.routines[r.id].last_run and engine.routines[r.id].last_run.total == 2)
    assert hub.state(ids["sim-luz-sala"], "power") is False


async def test_storm_guard_stops_loops(world) -> None:
    _, hub, engine, _, ids = world
    flag = engine.save_virtual({"name": "Laço"})
    a = engine.save_automation({
        "name": "Laço",
        "trigger": {"type": "virtual", "virtual_id": flag.id, "to": True},
        "actions": [{"type": "virtual", "virtual_id": flag.id, "value": False}],
    })
    for _ in range(STORM_LIMIT + 3):
        engine.set_virtual(flag.id, True)
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.1)
    assert engine.automations[a.id].last_run.skipped


async def test_removed_device_disables_automation(world) -> None:
    _, hub, engine, _, ids = world
    a = engine.save_automation({
        "name": "Ar",
        "trigger": {"type": "time", "at": "07:00"},
        "actions": [{"type": "device", "device_id": ids["sim-ar-quarto"], "capability": "power", "value": True}],
    })
    await hub.remove_device(ids["sim-ar-quarto"])
    saved = engine.automations[a.id]
    assert not saved.enabled and saved.incomplete and "removido" in saved.incomplete
    with pytest.raises(EngineError):
        engine.set_enabled(a.id, True)


async def test_validation(world) -> None:
    _, hub, engine, _, ids = world
    v = engine.save_virtual({"name": "Modo visita"})
    with pytest.raises(EngineError):
        engine.save_automation({"name": "x", "trigger": {"type": "time", "at": "07:00"}, "actions": [
            {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "brightness", "value": 500}]})
    with pytest.raises(ValueError):
        engine.save_automation({"name": "x", "trigger": {"type": "time", "at": "25:00"}, "actions": [
            {"type": "virtual", "virtual_id": v.id, "value": True}]})
    with pytest.raises(ValueError):  # mais de 3 condições
        engine.save_automation({"name": "x", "trigger": {"type": "time", "at": "07:00"},
                                "conditions": [{"type": "weekday", "days": [1]}] * 4,
                                "actions": [{"type": "virtual", "virtual_id": v.id, "value": True}]})
    r1 = engine.save_routine({"name": "A", "actions": [{"type": "virtual", "virtual_id": v.id, "value": True}]})
    r2 = engine.save_routine({"name": "B", "actions": [{"type": "routine", "routine_id": r1.id}]})
    with pytest.raises(EngineError):
        engine.save_routine({"name": "A", "actions": [{"type": "routine", "routine_id": r2.id}]}, r1.id)
    with pytest.raises(EngineError):
        engine.delete_virtual(v.id)


async def test_persists_across_restart(world, tmp_path) -> None:
    store, hub, engine, now, ids = world
    engine.save_virtual({"name": "Férias"})
    engine.save_routine({"name": "Sair", "actions": [
        {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "power", "value": False}]})
    engine2 = Engine(store, hub, EventBus(), now=now)
    assert [v.name for v in engine2.virtuals.values()] == ["Férias"]
    assert [r.name for r in engine2.routines.values()] == ["Sair"]


async def test_sun_trigger_fires_at_sunset_with_offset(world) -> None:
    from datetime import timedelta

    from casa.home import Home, save_home
    from casa.sun import sun_times

    store, hub, engine, now, ids = world
    auto = {
        "name": "Spots no pôr do sol",
        "trigger": {"type": "sun", "event": "sunset", "offset": -15},
        "actions": [{"type": "device", "device_id": ids["sim-luz-sala"], "capability": "power", "value": True}],
    }
    with pytest.raises(EngineError, match="localização da casa"):
        engine.save_automation(auto)

    save_home(store, Home(lat=-22.9068, lon=-43.1729))
    a = engine.save_automation(auto)
    await hub.command(ids["sim-luz-sala"], "power", False)
    sunset = sun_times(now.value.date(), -22.9068, -43.1729)[1]
    target = (sunset - timedelta(minutes=15)).replace(second=0, microsecond=0)

    now.value = target - timedelta(minutes=1)
    engine.tick(now())
    await asyncio.sleep(0.1)
    assert engine.automations[a.id].last_run is None  # um minuto antes: nada

    now.value = target
    engine.tick(now())
    await wait_for(lambda: engine.automations[a.id].last_run is not None)
    assert hub.state(ids["sim-luz-sala"], "power") is True


def test_sun_times_match_reference_tables() -> None:
    from datetime import date

    from casa.sun import _utc_minutes

    # Rio de Janeiro, solstício de junho: nascer 06:32 e pôr 17:16 em UTC-3 = 09:32 e 20:16 UTC.
    rise, set_ = _utc_minutes(date(2026, 6, 21), -22.9068, -43.1729)
    assert abs(rise - (9 * 60 + 32)) <= 3 and abs(set_ - (20 * 60 + 16)) <= 3
    assert _utc_minutes(date(2026, 6, 21), 80.0, 0.0) is None  # sol da meia-noite
