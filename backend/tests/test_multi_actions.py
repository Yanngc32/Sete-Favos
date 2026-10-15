"""Ação de aparelho com vários ajustes ("Ar: liga, 23 °C, frio, ventilação baixa")."""

from __future__ import annotations

import asyncio

import pytest

from casa.adapters.base import AdapterError, Candidate
from casa.adapters.sim import SimAdapter
from casa.automation import MAX_VALUES, DeviceAction, Routine
from casa.engine import Engine, EngineError
from casa.events import EventBus
from casa.hub import Hub
from casa.store import Store
from casa.vault import MemoryKeyring, Vault

DEVICES = (("sim-luz-sala", "light"), ("sim-fita-quarto", "light"), ("sim-ar-quarto", "ac"),
           ("sim-robo", "vacuum"), ("sim-tv-sala", "tv"))


@pytest.fixture
async def world(tmp_path):
    store = Store(tmp_path / "t.db")
    vault = Vault(MemoryKeyring())
    bus = EventBus()
    hub = Hub(store, vault, bus, {"simulado": SimAdapter(vault)})
    engine = Engine(store, hub, bus)
    await hub.start()
    await engine.start()
    ids = {}
    for key, kind in DEVICES:
        view = await hub.add_device(
            Candidate(key=key, vendor="simulado", name=key, kind=kind, config={"demo": key}),
            name=key, room="Sala", kind=kind,
        )
        ids[key] = view.id
    for _ in range(50):
        if all(hub.view(i).online for i in hub.ids()):
            break
        await asyncio.sleep(0.02)
    yield store, hub, engine, ids
    await engine.stop()
    await hub.stop()


def act(device_id: str, **values) -> dict:
    return {"type": "device", "device_id": device_id, "values": values}


def record_commands(hub: Hub, monkeypatch) -> list[tuple[str, object]]:
    sent: list[tuple[str, object]] = []
    real = hub.command

    async def spy(device_id, capability, value=None):
        sent.append((capability, value))
        return await real(device_id, capability, value)

    monkeypatch.setattr(hub, "command", spy)
    return sent


def test_old_format_still_loads_and_becomes_values() -> None:
    a = DeviceAction.model_validate({"type": "device", "device_id": "x", "capability": "target_temp", "value": 23})
    assert a.values == {"target_temp": 23}
    assert "capability" not in a.model_dump()
    # Comando sem valor ("start") no formato antigo.
    assert DeviceAction.model_validate({"type": "device", "device_id": "x", "capability": "start"}).values == {
        "start": None}
    # O que já está salvo no banco continua carregando.
    r = Routine.model_validate({"id": "r1", "name": "Antiga", "actions": [
        {"type": "device", "device_id": "x", "capability": "power", "value": False}]})
    assert r.actions[0].values == {"power": False}
    # Os dois juntos: vale `values`.
    both = DeviceAction.model_validate({"device_id": "x", "capability": "power", "value": True,
                                        "values": {"brightness": 10}})
    assert both.values == {"brightness": 10}


async def test_old_format_saved_through_engine(world) -> None:
    _, hub, engine, ids = world
    r = engine.save_routine({"name": "Antiga", "actions": [
        {"type": "device", "device_id": ids["sim-luz-sala"], "capability": "brightness", "value": 15}]})
    assert r.model_dump(mode="json")["actions"][0] == act(ids["sim-luz-sala"], brightness=15)
    result = await engine.run_routine(r.id)
    assert result.succeeded == result.total == 1
    assert result.steps[0].label == "sim-luz-sala · Brilho"


async def test_validation(world) -> None:
    _, hub, engine, ids = world
    ar, robo, luz = ids["sim-ar-quarto"], ids["sim-robo"], ids["sim-luz-sala"]

    def save(*actions):
        return engine.save_routine({"name": "x", "actions": list(actions)})

    with pytest.raises(EngineError, match="não tem essa opção"):
        save(act(ar, power=True, brightness=10))
    with pytest.raises(EngineError, match="fora da faixa"):
        save(act(ar, power=True, target_temp=40))
    with pytest.raises(EngineError, match="opção inválida"):
        save(act(ar, ac_mode="gelado"))
    with pytest.raises(EngineError, match="só pode ser lido"):
        save(act(ar, current_temp=20))
    with pytest.raises(EngineError, match="pelo menos um ajuste"):
        save(act(ar))
    with pytest.raises(EngineError, match="um comando só"):
        save(act(robo, start=None, dock=None))
    with pytest.raises(EngineError, match="controle remoto"):
        save(act(luz, remote="HOME"))
    with pytest.raises(EngineError, match="tecla"):
        save(act(ids["sim-tv-sala"], remote="NAO_EXISTE"))
    with pytest.raises(ValueError, match="no máximo"):
        save(act(ar, **{f"k{i}": True for i in range(MAX_VALUES + 1)}))
    # Comando com potência: o valor do comando vira None; o resto é normalizado.
    r = save(act(robo, fan_power=_first_fan(hub, robo), start="qualquer"),
             act(ar, target_temp=23, ac_mode="cool", power=True))
    assert r.actions[0].values["start"] is None
    assert r.actions[1].values["target_temp"] == 23.0


def _first_fan(hub: Hub, device_id: str) -> str:
    cap = next(c for c in hub.capabilities(device_id) if c.id == "fan_power")
    return cap.options[0].value


async def test_runs_power_on_first_and_power_off_last(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar = ids["sim-ar-quarto"]
    sent = record_commands(hub, monkeypatch)
    r = engine.save_routine({"name": "Ar", "actions": [
        act(ar, target_temp=23, ac_mode="cool", power=True, fan_speed="low")]})
    result = await engine.run_routine(r.id)
    assert [c for c, _ in sent] == ["power", "target_temp", "ac_mode", "fan_speed"]
    assert result.total == result.succeeded == 1
    assert result.steps[0].label == "sim-ar-quarto · Ligado, Temperatura, Modo, Ventilação"
    assert hub.state(ar, "ac_mode") == "cool" and hub.state(ar, "fan_speed") == "low"

    sent.clear()
    r2 = engine.save_routine({"name": "Sair", "actions": [act(ar, power=False, target_temp=26)]})
    await engine.run_routine(r2.id)
    assert [c for c, _ in sent] == ["target_temp", "power"]
    assert hub.state(ar, "power") is False


async def test_partial_failure_keeps_going_and_says_what_failed(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar = ids["sim-ar-quarto"]
    driver = hub._entries[ar].driver
    real = driver.command

    async def flaky(capability, value):
        if capability == "ac_mode":
            raise AdapterError("recusado", "O ar recusou o modo.")
        return await real(capability, value)

    monkeypatch.setattr(driver, "command", flaky)
    result = await engine.test_actions([act(ar, power=True, ac_mode="heat", target_temp=21)])
    assert result.total == 1 and result.succeeded == 0
    assert result.steps[0].error == "2 de 3 ajustes ok · modo: O ar recusou o modo"
    assert hub.state(ar, "power") is True and hub.state(ar, "target_temp") == 21.0

    # Um ajuste só: a mensagem continua a de antes.
    single = await engine.test_actions([act(ar, ac_mode="heat")])
    assert single.steps[0].error == "O ar recusou o modo."


async def test_offline_device_stops_trying(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar = ids["sim-ar-quarto"]
    sent = record_commands(hub, monkeypatch)
    hub._entries[ar].driver._offline = True
    hub._entries[ar].online = False
    result = await engine.test_actions([act(ar, power=True, target_temp=21, ac_mode="cool")])
    assert result.steps[0].error == "sim-ar-quarto sem resposta"
    assert len(sent) == 1  # parou no primeiro: não espera o tempo de cada ajuste


async def test_undo_restores_every_value_and_turns_off_last(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar = ids["sim-ar-quarto"]
    await hub.command(ar, "power", False)
    before = {k: hub.state(ar, k) for k in ("target_temp", "ac_mode", "fan_speed")}
    r = engine.save_routine({"name": "Ar", "actions": [
        act(ar, power=True, target_temp=18, ac_mode="dry", fan_speed="high")]})
    result = await engine.run_routine(r.id)
    assert hub.state(ar, "ac_mode") == "dry"
    sent = record_commands(hub, monkeypatch)
    undo = await engine.undo(result.id)
    assert undo.succeeded == undo.total == 4
    assert {k: hub.state(ar, k) for k in before} == before
    assert hub.state(ar, "power") is False
    assert sent[-1] == ("power", False)


async def test_undo_turns_light_off_once_when_values_turned_it_on(world) -> None:
    _, hub, engine, ids = world
    fita = ids["sim-fita-quarto"]
    assert hub.state(fita, "power") is False
    result = await engine.test_actions([act(fita, brightness=70, color_temp=10, color="#FF0000")])
    assert result.succeeded == 1 and hub.state(fita, "power") is True
    assert hub.state(fita, "color") == "#ff0000"
    run = engine._runs[result.id]
    assert [u[2] for u in run.undo].count("power") == 1
    await engine.undo(result.id)
    assert hub.state(fita, "power") is False


async def test_remote_key_runs_after_power_on(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    tv = ids["sim-tv-sala"]
    await hub.command(tv, "power", False)
    order: list[str] = []
    real_remote = hub.remote

    async def remote(device_id, key):
        order.append(f"remote:{key}")
        await real_remote(device_id, key)

    monkeypatch.setattr(hub, "remote", remote)
    sent = record_commands(hub, monkeypatch)
    result = await engine.test_actions([act(tv, remote="VOLUMEUP", volume=10, power=True)])
    assert result.succeeded == 1, result.steps
    assert [c for c, _ in sent] == ["power", "volume"] and order == ["remote:VOLUMEUP"]
    assert hub.state(tv, "volume") == 11


async def test_remote_key_failure_is_partial(world) -> None:
    _, hub, engine, ids = world
    tv = ids["sim-tv-sala"]
    await hub.command(tv, "power", False)
    result = await engine.test_actions([act(tv, muted=True, remote="HOME")])
    assert result.steps[0].error.startswith("1 de 2 ajustes ok · tecla:")
    assert hub.state(tv, "muted") is True


async def test_incomplete_when_device_removed_or_option_lost(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar, luz = ids["sim-ar-quarto"], ids["sim-luz-sala"]
    r = engine.save_routine({"name": "Ar", "actions": [act(ar, power=True, ac_mode="cool")]})
    a = engine.save_automation({"name": "Luz", "trigger": {"type": "time", "at": "07:00"},
                                "actions": [act(luz, power=True, brightness=40)]})

    # Aparelho perdeu "Modo" (ex.: firmware novo): a rotina fica incompleta, sem desligar nada.
    driver = hub._entries[ar].driver
    full = driver.capabilities()
    monkeypatch.setattr(driver, "capabilities", lambda: [c for c in full if c.id != "ac_mode"])
    hub._publish(hub._entries[ar])
    assert engine.routines[r.id].incomplete == "Incompleta: sim-ar-quarto não tem mais modo"
    # Voltou a ter: volta ao normal.
    monkeypatch.setattr(driver, "capabilities", lambda: full)
    hub._publish(hub._entries[ar])
    assert engine.routines[r.id].incomplete is None

    await hub.remove_device(luz)
    saved = engine.automations[a.id]
    assert not saved.enabled and saved.incomplete == "Incompleta: sim-luz-sala foi removido"


async def test_group_accepts_common_values_only(world) -> None:
    _, hub, engine, ids = world
    g = hub.create_group(name="Luzes", room=None, members=[ids["sim-luz-sala"], ids["sim-fita-quarto"]])
    r = engine.save_routine({"name": "Luzes", "actions": [act(g.id, power=True, brightness=30, color_temp=50)]})
    result = await engine.run_routine(r.id)
    assert result.succeeded == 1
    assert hub.state(ids["sim-luz-sala"], "brightness") == 30 and hub.state(ids["sim-fita-quarto"], "brightness") == 30
    with pytest.raises(EngineError, match="não tem essa opção"):  # só a fita tem cor
        engine.save_routine({"name": "Cor", "actions": [act(g.id, color="#00ff00")]})


async def test_delays_and_second_card_of_same_device(world, monkeypatch) -> None:
    _, hub, engine, ids = world
    ar = ids["sim-ar-quarto"]
    sent = record_commands(hub, monkeypatch)
    result = await engine.test_actions([
        act(ar, power=True, target_temp=22), {"type": "delay", "minutes": 10}, act(ar, power=False)])
    assert result.total == result.succeeded == 2 and not result.pending
    assert [c for c, _ in sent] == ["power", "target_temp", "power"]
