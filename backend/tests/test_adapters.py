from __future__ import annotations

import pytest

from casa.adapters.base import AdapterError
from casa.adapters.tuya import _format_colour, _parse_colour, compact_mapping, guess_mapping, kind_for
from casa.adapters.xiaomi import build_vacuum_mapping, fault_pt, status_from


def test_tuya_colour_roundtrip() -> None:
    v2 = _format_colour("colour_data_v2", "#ff0000", 100)
    assert v2 == "000003e803e8"
    assert _parse_colour(v2) == "#ff0000"
    v1 = _format_colour("colour_data", "#00ff00", None)
    assert len(v1) == 14 and _parse_colour(v1) == "#00ff00"
    assert _parse_colour("zz") is None


def test_tuya_mapping_and_kind() -> None:
    cloud = {
        "20": {"code": "switch_led", "type": "Boolean", "values": "{}"},
        "22": {"code": "bright_value_v2", "type": "Integer", "values": '{"min":10,"max":1000}'},
        "99": {"code": "countdown", "type": "Integer", "values": {}},
    }
    m = compact_mapping(cloud)
    assert set(m) == {"switch_led", "bright_value_v2"}
    assert m["bright_value_v2"]["values"]["max"] == 1000
    assert kind_for("dj", m) == "light"
    assert kind_for("cz", {}) == "plug"
    assert kind_for(None, guess_mapping({"1": True, "19": 0})) == "plug"
    assert "bright_value_v2" in guess_mapping({"20": True, "21": "white", "22": 500})


SPEC = {"services": [
    {"iid": 2, "type": "urn:miot-spec-v2:service:vacuum:00007810:xiaomi-x:1", "properties": [
        {"iid": 1, "type": "urn:miot-spec-v2:property:status:00000007:xiaomi-x:1", "value-list": [
            {"value": 1, "description": "Sweeping"}, {"value": 2, "description": "Idle"},
            {"value": 5, "description": "Go Charging"}, {"value": 6, "description": "Charging"}]},
        {"iid": 2, "type": "urn:miot-spec-v2:property:fault:00000009:xiaomi-x:1", "value-list": [
            {"value": 0, "description": "No Faults"}, {"value": 3, "description": "Side Brush Stuck"}]},
        {"iid": 4, "type": "urn:miot-spec-v2:property:mode:00000008:xiaomi-x:1", "value-list": [
            {"value": 0, "description": "Silent"}, {"value": 1, "description": "Standard"}]},
    ], "actions": [
        {"iid": 1, "type": "urn:miot-spec-v2:action:start-sweep:00002804:xiaomi-x:1"},
        {"iid": 2, "type": "urn:miot-spec-v2:action:stop-sweeping:00002805:xiaomi-x:1"},
    ]},
    {"iid": 3, "type": "urn:miot-spec-v2:service:battery:00007805:xiaomi-x:1", "properties": [
        {"iid": 1, "type": "urn:miot-spec-v2:property:battery-level:00000014:xiaomi-x:1"}],
     "actions": [{"iid": 1, "type": "urn:miot-spec-v2:action:start-charge:00002802:xiaomi-x:1"}]},
]}


def test_xiaomi_mapping_from_spec() -> None:
    m = build_vacuum_mapping(SPEC)
    assert m["props"]["status"]["siid"] == 2 and m["props"]["battery"] == {"siid": 3, "piid": 1, "values": []}
    assert m["actions"]["dock"] == {"siid": 3, "aiid": 1}
    assert m["actions"]["stop"] == {"siid": 2, "aiid": 2}
    with pytest.raises(AdapterError):
        build_vacuum_mapping({"services": []})


def test_xiaomi_texts() -> None:
    assert status_from("Go Charging") == "returning"
    assert status_from("Charging") == "docked"
    assert status_from("Sweeping") == "cleaning"
    assert fault_pt("No Faults") is None
    assert fault_pt("Side Brush Stuck") == "Escova presa"


def test_tuya_broadcast_uses_datagram_ip_not_payload_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    from casa.adapters import tuya

    box = tuya._Broadcasts()
    monkeypatch.setattr(tuya, "decrypt_udp", lambda _: json.dumps({"gwId": "abc", "ip": "8.8.8.8"}).encode())
    box.handle(b"x", ("192.168.1.30", 6667))
    assert box.seen["abc"]["ip"] == "192.168.1.30"
    monkeypatch.setattr(tuya, "decrypt_udp", lambda _: json.dumps({"gwId": {"a": 1}}).encode())
    box.handle(b"x", ("192.168.1.31", 6667))  # id que não é texto: ignora, não levanta
    assert len(box.seen) == 1


def test_manual_ip_must_be_private_lan() -> None:
    from casa.net import is_lan_device_ip

    for ok in ("192.168.1.20", "10.1.2.3", "172.20.0.9"):
        assert is_lan_device_ip(ok), ok
    for bad in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "100.64.1.1", "0.0.0.0", "192.168.1.20:3000", "tv.local",
                "127.0.0.1:8484/api/ws?", "", "::1"):
        assert not is_lan_device_ip(bad), bad


def test_model_rejects_malformed_color_and_nan() -> None:
    from casa.model import Capability

    color = Capability(id="color", label="Cor", type="color")
    for bad in ("#-12345", "# 12345", "#1_2345", "#12345g", "123456", "#12345"):
        with pytest.raises(ValueError):
            color.validate_value(bad)
    assert color.validate_value("#FFAA00") == "#ffaa00"
    num = Capability(id="brightness", label="Brilho", type="int", min=1, max=100)
    for bad in (float("nan"), float("inf")):
        with pytest.raises(ValueError):
            num.validate_value(bad)


def test_automation_action_lists_are_capped() -> None:
    from pydantic import ValidationError

    from casa.automation import MAX_ACTIONS, Routine

    action = {"type": "device", "device_id": "d", "capability": "power", "value": True}
    Routine.model_validate({"name": "r", "actions": [action] * MAX_ACTIONS})
    with pytest.raises(ValidationError):
        Routine.model_validate({"name": "r", "actions": [action] * (MAX_ACTIONS + 1)})


async def test_lg_power_on_wakes_tv_in_quick_start_standby(monkeypatch: pytest.MonkeyPatch) -> None:
    # O Wake-on-LAN sai na hora, sem esperar conectar (com a TV desligada a conexão estourava o prazo).
    from types import SimpleNamespace

    from casa.adapters import lg
    from casa.model import DeviceRecord

    sent: list[str] = []
    monkeypatch.setattr(lg, "wake_on_lan", sent.append)
    record = DeviceRecord(vendor="lg", kind="tv", name="TV", config={"ip": "192.168.0.143", "macs": ["aa:bb:cc:dd:ee:ff"]})
    driver = lg.LgDriver(record, vault=None)

    async def never_connects() -> None:
        raise AssertionError("ligar não deve esperar a conexão")

    monkeypatch.setattr(driver, "_connect", never_connects)
    assert await driver.command("power", True) == {"power": True}
    assert sent == ["aa:bb:cc:dd:ee:ff"]

    # Já conectada e ligada: não manda WoL de novo.
    driver._client = SimpleNamespace(is_connected=lambda: True, tv_state=SimpleNamespace(is_on=True))
    assert await driver.command("power", True) == {"power": True}
    assert sent == ["aa:bb:cc:dd:ee:ff"]


async def test_lg_refresh_holds_on_while_tv_boots(monkeypatch: pytest.MonkeyPatch) -> None:
    from casa.adapters import lg
    from casa.model import DeviceRecord

    clock = [1000.0]
    monkeypatch.setattr(lg.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(lg, "wake_on_lan", lambda mac: None)
    record = DeviceRecord(vendor="lg", kind="tv", name="TV", config={"ip": "192.168.0.143", "macs": ["aa:bb:cc:dd:ee:ff"]})
    driver = lg.LgDriver(record, vault=None)

    async def no_answer() -> None:
        return None

    monkeypatch.setattr(driver, "_connect", no_answer)
    await driver.command("power", True)
    clock[0] += 10  # ainda subindo
    assert await driver.refresh() == {"power": True}
    clock[0] += lg.WAKE_GRACE  # não subiu: volta a desligada
    assert await driver.refresh() == {"power": False}


def test_tuya_expired_plan_is_reported_not_empty_list(monkeypatch: pytest.MonkeyPatch) -> None:
    # Plano vencido: o tinytuya devolve [] e o motivo fica em getdevices_raw.
    from casa.adapters import tuya

    class FakeCloud:
        error = None
        getdevices_raw = {"success": False, "code": 28841002, "msg": "IoT Core service subscription has expired."}

        def __init__(self, **_: object) -> None: ...

        def getdevices(self, include_map: bool = False) -> list:
            return []

    monkeypatch.setattr(tuya.tinytuya, "Cloud", FakeCloud)
    with pytest.raises(AdapterError) as exc:
        tuya.TuyaAdapter._fetch_cloud("k", "s", "us")
    assert exc.value.code == "tuya_expirado"


def test_xiaomi_captcha_reuses_the_same_login_session(monkeypatch: pytest.MonkeyPatch) -> None:
    from casa.adapters import xiaomi

    seen: list[tuple[int, str | None]] = []

    def login(self: xiaomi._Cloud) -> bool:
        seen.append((id(self), self.captcha_code))
        if self.captcha_code != "ab12":
            self.captcha_url = "/pass/getCode?icodeType=login"
            raise RuntimeError("captcha")
        return True

    monkeypatch.setattr(xiaomi._Cloud, "_login_request", login)
    monkeypatch.setattr(xiaomi._Cloud, "get_devices", lambda self, country=None: [{"did": 1, "token": "0" * 32}])
    monkeypatch.setattr(xiaomi, "_captcha_image", lambda cloud: "data:image/jpeg;base64,AA==")

    with pytest.raises(AdapterError) as exc:
        xiaomi._cloud_devices("Eu@x.com", "senha", "us")
    assert exc.value.code == "captcha" and exc.value.data == {"image": "data:image/jpeg;base64,AA=="}

    with pytest.raises(AdapterError) as exc:  # código errado: nova imagem, mesma sessão
        xiaomi._cloud_devices("eu@x.com", "senha", "us", captcha="zzzz")
    assert exc.value.code == "captcha"

    assert xiaomi._cloud_devices("eu@x.com", "senha", "us", captcha="ab12") == [{"did": 1, "token": "0" * 32}]
    assert len({sid for sid, _ in seen}) == 1
    assert [code for _, code in seen] == [None, "zzzz", "ab12"]
    assert not xiaomi._pending


async def test_tuya_multi_gang_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    from casa.adapters import tuya
    from casa.model import DeviceRecord

    cloud_map = {str(n): {"code": f"switch_{n}", "type": "Boolean"} for n in (1, 2, 3)}
    mapping = compact_mapping(cloud_map)
    assert kind_for("kg", mapping) == "switch"
    assert kind_for("kg", compact_mapping({"1": {"code": "switch_1", "type": "Boolean"}})) == "plug"

    record = DeviceRecord(vendor="tuya", kind="switch", name="Interruptor",
                          config={"dev_id": "x", "mapping": mapping, "labels": {"switch_2": "Ventilador"}})
    driver = tuya.TuyaDriver(record, vault=None)
    assert [(c.id, c.label) for c in driver.capabilities()] == [
        ("power", "Ligado"), ("switch_1", "Tecla 1"), ("switch_2", "Ventilador"), ("switch_3", "Tecla 3")]

    sent: list[dict] = []
    monkeypatch.setattr(driver, "_call", lambda fn: sent.append(fn(type("D", (), {"set_multiple_values": staticmethod(lambda d: d)})())) or {})
    state = await driver.command("switch_2", True)
    assert sent[-1] == {"2": True}
    assert state == {"switch_2": True, "power": True}
    state = await driver.command("power", False)
    assert sent[-1] == {"1": False, "2": False, "3": False}
    assert state["power"] is False


def test_xiaomi_stale_captcha_without_pending_session_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    from casa.adapters import xiaomi

    codes: list[str | None] = []

    def login(self: xiaomi._Cloud) -> bool:
        codes.append(self.captcha_code)
        return True

    monkeypatch.setattr(xiaomi._Cloud, "_login_request", login)
    monkeypatch.setattr(xiaomi._Cloud, "get_devices", lambda self, country=None: [])
    xiaomi._pending.clear()
    xiaomi._cloud_devices("eu@x.com", "senha", "us", captcha="velho")
    assert codes == [None]
