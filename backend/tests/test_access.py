from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from casa.access import COOKIE, Access, PairingError, same_origin, split_host
from casa.events import EventBus
from casa.store import Store


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_access() -> tuple[Access, Clock, Store]:
    clock = Clock()
    store = Store(":memory:")
    return Access(store, EventBus(), now=clock), clock, store


def test_loopback_is_pc_only_without_proxy_headers() -> None:
    assert Access.is_pc("127.0.0.1", set(), "localhost")
    assert Access.is_pc("::1", set(), "::1")
    assert not Access.is_pc("192.168.1.2", set(), "localhost")
    assert not Access.is_pc("100.88.1.2", set(), "localhost")
    # Proxy local (ex.: tailscale serve) não pode virar "PC".
    assert not Access.is_pc("127.0.0.1", {b"x-forwarded-for"}, "localhost")
    assert not Access.is_pc("127.0.0.1", {b"tailscale-user-login"}, "localhost")
    assert not Access.is_pc(None, set(), "localhost")


@pytest.mark.parametrize(
    "header",
    [b"cf-connecting-ip", b"true-client-ip", b"x-client-ip", b"client-ip", b"x-forwarded-port",
     b"x-original-forwarded-for", b"tailscale-funnel-request", b"forwarded", b"via"],
)
def test_proxy_headers_by_prefix_are_not_pc(header: bytes) -> None:
    assert not Access.is_pc("127.0.0.1", {header}, "localhost")


def test_loopback_with_foreign_host_is_not_pc() -> None:
    # Proxy TCP local repassando "Host: 192.168.1.2:8484" ou o nome da tailnet não vira PC.
    assert not Access.is_pc("127.0.0.1", set(), "192.168.1.2")
    assert not Access.is_pc("127.0.0.1", set(), "casa.tailnet.ts.net")


def test_pairing_single_use_and_hash_only() -> None:
    access, _, store = make_access()
    code = access.start_pairing()["code"]
    device, token = access.pair(code, "iPhone da sala")
    assert access.by_token(token) is device
    saved = store.get("access_devices", device.id)
    assert saved and token not in str(saved) and saved["token_hash"] != token
    with pytest.raises(PairingError):
        access.pair(code, "outro")


def test_new_code_does_not_inherit_paired_status() -> None:
    access, _, _ = make_access()
    access.pair(access.start_pairing()["code"], "iPhone")
    assert access.pairing_status()["state"] == "paired"
    access.start_pairing()
    assert access.pairing_status()["state"] == "waiting"


def test_pairing_expires() -> None:
    access, clock, _ = make_access()
    code = access.start_pairing()["code"]
    clock.t += 301
    with pytest.raises(PairingError) as err:
        access.pair(code, None)
    assert err.value.code == "invalido"
    assert access.pairing_status()["state"] == "expired"


def test_pairing_invalidated_after_5_errors() -> None:
    access, _, _ = make_access()
    code = access.start_pairing()["code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(4):
        with pytest.raises(PairingError):
            access.pair(wrong, None)
    with pytest.raises(PairingError) as err:
        access.pair(wrong, None)
    assert err.value.code == "tentativas"
    with pytest.raises(PairingError):
        access.pair(code, None)


def test_revoke_cuts_token() -> None:
    access, _, store = make_access()
    device, token = access.pair(access.start_pairing()["code"], "Celular")
    access.revoke(device.id)
    assert access.by_token(token) is None
    assert store.get("access_devices", device.id) is None


def test_host_and_origin_helpers() -> None:
    assert split_host("[::1]:8484") == ("::1", "8484")
    assert split_host("localhost:8484") == ("localhost", "8484")
    assert same_origin("http://localhost:8484", "localhost:8484", "http")
    assert not same_origin("http://evil.com", "localhost:8484", "http")
    assert not same_origin("http://localhost:5173", "localhost:8484", "http")
    assert not same_origin("null", "localhost:8484", "http")


# Middleware ---------------------------------------------------------------------


def test_pc_has_access_phone_does_not(pc: TestClient, phone: TestClient) -> None:
    assert pc.get("/api/session").json() == {"access": "pc"}
    assert phone.get("/api/session").json() == {"access": "none"}
    assert phone.get("/api/devices").status_code == 401
    assert phone.post("/api/routines", json={}).status_code == 401
    assert phone.get("/api/access/devices").status_code == 401


def test_forwarded_header_from_loopback_is_not_pc(pc: TestClient) -> None:
    r = pc.get("/api/devices", headers={"X-Forwarded-For": "127.0.0.1"})
    assert r.status_code == 401


def test_dns_rebinding_host_rejected(pc: TestClient) -> None:
    assert pc.get("/api/devices", headers={"Host": "evil.example.com"}).status_code == 400
    # Nome conhecido passa pelo Host, mas de loopback com Host de fora não é o PC.
    assert pc.get("/api/devices", headers={"Host": "casa.tailnet.ts.net:8484"}).status_code == 401


def test_cross_origin_post_rejected(pc: TestClient) -> None:
    r = pc.post("/api/virtuals", json={"name": "Modo visita"}, headers={"Origin": "http://evil.example.com"})
    assert r.status_code == 403
    ok = pc.post("/api/virtuals", json={"name": "Modo visita"}, headers={"Origin": "http://localhost:8484"})
    assert ok.status_code == 200


def test_pair_phone_then_revoke(pc: TestClient, phone: TestClient) -> None:
    code = pc.post("/api/access/pairing").json()["code"]
    r = phone.post("/api/access/pair", json={"code": code, "name": "iPhone"})
    assert r.status_code == 200
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=strict" in set_cookie
    assert phone.cookies.get(COOKIE)
    assert phone.get("/api/session").json()["access"] == "device"
    assert phone.get("/api/devices").status_code == 200
    # Celular pareado não gerencia acesso.
    assert phone.post("/api/access/pairing").status_code == 403
    device_id = pc.get("/api/access/devices").json()[0]["id"]
    assert "token_hash" not in pc.get("/api/access/devices").json()[0]
    assert pc.delete(f"/api/access/devices/{device_id}").status_code == 204
    assert phone.get("/api/devices").status_code == 401


def test_revoke_closes_websocket(pc: TestClient, phone: TestClient) -> None:
    code = pc.post("/api/access/pairing").json()["code"]
    phone.post("/api/access/pair", json={"code": code})
    device_id = pc.get("/api/access/devices").json()[0]["id"]
    with phone.websocket_connect("ws://192.168.1.2:8484/api/ws") as ws:
        assert ws.receive_json()["t"] == "snapshot"
        pc.delete(f"/api/access/devices/{device_id}")
        with pytest.raises(Exception):
            while True:
                ws.receive_json()


def test_unpaired_websocket_rejected(phone: TestClient) -> None:
    with pytest.raises(Exception):
        with phone.websocket_connect("ws://192.168.1.2:8484/api/ws"):
            pass


def test_security_headers(pc: TestClient) -> None:
    r = pc.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_peer_outside_home_networks_is_refused() -> None:
    from casa.access import trusted_peer

    for ok in ("127.0.0.1", "::1", "192.168.1.50", "10.0.0.7", "172.16.4.2", "100.88.1.2", "169.254.3.3", "fd7a:115c:a1e0::1"):
        assert trusted_peer(ok), ok
    for bad in ("8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "not-an-ip", "", None):
        assert not trusted_peer(bad), bad


def test_public_peer_gets_403_before_any_route(app) -> None:
    with TestClient(app, base_url="http://192.168.1.2:8484", client=("8.8.8.8", 50002)) as outsider:
        assert outsider.get("/api/health").status_code == 403
        assert outsider.post("/api/access/pair", json={"code": "123456"}).status_code == 403


def test_pairing_code_with_non_ascii_is_a_normal_wrong_code(pc: TestClient, phone: TestClient) -> None:
    pc.post("/api/access/pairing")
    for bad in ("123456é", "１２３４５６", "x" * 16):
        r = phone.post("/api/access/pair", json={"code": bad})
        assert r.status_code == 400 and r.json()["code"] == "invalido", bad
    assert phone.post("/api/access/pair", json={"code": "x" * 17}).status_code == 422


def test_origin_with_invalid_port_is_rejected_not_500(pc: TestClient) -> None:
    r = pc.post("/api/virtuals", json={"name": "x"}, headers={"Origin": "http://localhost:99999"})
    assert r.status_code == 403
    assert same_origin("http://localhost:99999", "localhost:8484", "http") is False


def test_request_body_is_capped(pc: TestClient, phone: TestClient) -> None:
    assert phone.post("/api/access/pair", content=b"x" * 100_000).status_code == 413
    assert pc.post("/api/routines", content=b"x" * 2_000_000).status_code == 413


def test_static_path_guard() -> None:
    from casa.app import _unsafe_static_path

    for bad in (r"\\10.0.0.1\share\x", "C:x", "C:/Windows/win.ini", r"a\b", "../secret", "a/../../b", "/etc/passwd"):
        assert _unsafe_static_path(bad), bad
    for ok in ("favicon.svg", "assets/app.js", "aparelho/abc"):
        assert not _unsafe_static_path(ok), ok


def test_revoked_device_cannot_open_websocket(pc: TestClient, phone: TestClient) -> None:
    code = pc.post("/api/access/pairing").json()["code"]
    phone.post("/api/access/pair", json={"code": code})
    device_id = pc.get("/api/access/devices").json()[0]["id"]
    pc.delete(f"/api/access/devices/{device_id}")
    with pytest.raises(Exception):
        with phone.websocket_connect("ws://192.168.1.2:8484/api/ws"):
            pass


def test_websocket_connections_per_client_are_capped(pc: TestClient) -> None:
    from contextlib import ExitStack

    from casa.app import WS_MAX_PER_CLIENT

    with ExitStack() as stack:
        for _ in range(WS_MAX_PER_CLIENT):
            stack.enter_context(pc.websocket_connect("ws://localhost:8484/api/ws"))
        with pytest.raises(Exception):
            with pc.websocket_connect("ws://localhost:8484/api/ws") as extra:
                extra.receive_json()


def test_vendor_accounts_are_pc_only(pc: TestClient, phone: TestClient) -> None:
    code = pc.post("/api/access/pairing").json()["code"]
    assert phone.post("/api/access/pair", json={"code": code}).status_code == 200
    assert phone.get("/api/devices").status_code == 200  # pareado de verdade
    r = phone.put("/api/vendors/tuya/account", json={"values": {"x": "y"}})
    assert r.status_code == 403 and r.json()["detail"] == "so_no_pc"
    assert phone.delete("/api/vendors/tuya/account").status_code == 403
    assert pc.delete("/api/vendors/tuya/account").status_code in (204, 404)


def test_version_needs_access(pc: TestClient, phone: TestClient) -> None:
    from importlib.metadata import version

    assert pc.get("/api/version").json() == {"version": version("casa")}
    assert phone.get("/api/version").status_code in (401, 403)  # celular ainda não pareado


def test_tailscale_cli_found_outside_path(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    from casa import access

    monkeypatch.setattr(access.shutil, "which", lambda _: None)
    monkeypatch.setenv("ProgramFiles", str(tmp_path))
    assert access.tailscale_cli() is None
    exe = tmp_path / "Tailscale" / "tailscale.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"")
    assert access.tailscale_cli() == str(exe)
