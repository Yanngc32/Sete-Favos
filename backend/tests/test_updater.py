from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from casa import updater as up
from casa.settings import Settings
from casa.store import Store
from casa.vault import MemoryKeyring, Vault

INSTALLER = b"MZ" + b"\x00" * 1000


def github(*, tag: str = "v9.0.0", tamper: bool = False, status: int = 200,
           seen: list[httpx.Request] | None = None) -> httpx.MockTransport:
    def release(version: str) -> dict:
        name = f"CentralSetup-{version}.exe"
        return {"tag_name": f"v{version}", "assets": [
            {"name": name, "size": len(INSTALLER), "url": f"https://api.github.com/assets/{version}/exe"},
            {"name": f"{name}.sha256", "size": 90, "url": f"https://api.github.com/assets/{version}/sha"},
        ]}

    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        path = req.url.path
        if path.endswith("/releases/latest"):
            return httpx.Response(status, json=release(tag.lstrip("v")))
        if "/releases/tags/" in path:
            return httpx.Response(200, json=release(path.rsplit("/v", 1)[1]))
        if path.endswith("/exe"):
            return httpx.Response(200, content=INSTALLER)
        if path.endswith("/sha"):
            digest = hashlib.sha256(INSTALLER + (b"x" if tamper else b"")).hexdigest()
            return httpx.Response(200, content=f"{digest}  CentralSetup.exe\n".encode())
        if path.startswith("/repos/"):
            return httpx.Response(200, json={"private": True})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def make(tmp_path: Path, transport: httpx.MockTransport, vault: Vault, *, token: bool = True) -> up.Updater:
    if token:
        vault.set(up.TOKEN_KEY, "github_pat_" + "a" * 30)
    settings = Settings(data_dir=tmp_path, host="127.0.0.1", port=38471, extra_hosts=frozenset(),
                        simulate=True, frontend_dir=None)
    return up.Updater(settings, Store(tmp_path / "casa.db"), vault, transport=transport)


def test_versions_and_hashes() -> None:
    assert up.parse_version("v1.2.10") == (1, 2, 10) and up.parse_version("1.2") is None
    assert up.parse_version("v1.2.3-rc1") is None
    digest = hashlib.sha256(b"dados").hexdigest()
    assert up.sha256_matches(b"dados", digest.upper() + "\n")
    assert up.sha256_matches(b"dados", f"{digest}  arquivo.exe")
    assert not up.sha256_matches(b"outros", digest)
    assert not up.sha256_matches(b"dados", "") and not up.sha256_matches(b"dados", "abc")


async def test_new_version_is_verified_backed_up_and_launched(tmp_path, vault, monkeypatch) -> None:
    launched: list[tuple[Path, Path | None]] = []
    monkeypatch.setattr(up, "FROZEN", True)
    monkeypatch.setattr(up.Updater, "_launch", lambda self, new, prev: launched.append((new, prev)))
    seen: list[httpx.Request] = []
    u = make(tmp_path, github(seen=seen), vault)
    await u.check()
    assert u.status.state == "instalando" and u.status.latest == "9.0.0"
    new, prev = launched[0]
    assert new.read_bytes() == INSTALLER and new.name == "CentralSetup-9.0.0.exe"
    assert prev is not None and prev.name == f"CentralSetup-{up.__version__}.exe"
    assert list((tmp_path / "backups").glob("casa-*.db"))
    assert all(r.headers["authorization"].startswith("Bearer github_pat_") for r in seen)


async def test_wrong_hash_is_refused(tmp_path, vault, monkeypatch) -> None:
    monkeypatch.setattr(up, "FROZEN", True)
    monkeypatch.setattr(up.Updater, "_launch", lambda *a: pytest.fail("não podia instalar"))
    u = make(tmp_path, github(tamper=True), vault)
    await u.check()
    assert u.status.state == "erro" and "SHA-256" in (u.status.message or "")
    assert not (tmp_path / "updates").exists()


async def test_same_version_dev_mode_and_no_token(tmp_path, vault, monkeypatch) -> None:
    monkeypatch.setattr(up.Updater, "_launch", lambda *a: pytest.fail("não podia instalar"))
    u = make(tmp_path, github(tag=f"v{up.__version__}"), vault)
    await u.check()
    assert u.status.state == "ok"

    monkeypatch.setattr(up, "FROZEN", False)  # rodando do código: só avisa
    u = make(tmp_path, github(), vault)
    await u.check()
    assert u.status.state == "disponivel"

    u = make(tmp_path / "x", github(), Vault(MemoryKeyring()), token=False)
    await u.check()
    assert u.status.state == "sem_token"


async def test_rejected_token(tmp_path, vault) -> None:
    u = make(tmp_path, github(status=401), vault)
    await u.check()
    assert u.status.state == "erro" and "token" in (u.status.message or "")
    with pytest.raises(ValueError):
        await u.set_token("curto")


async def test_unexpected_failure_keeps_updater_alive(tmp_path, vault, monkeypatch) -> None:
    def boom(*_):
        raise RuntimeError("powershell travou")

    monkeypatch.setattr(up, "FROZEN", True)
    monkeypatch.setattr(up.Updater, "_launch", boom)
    u = make(tmp_path, github(), vault)
    await u.check()
    assert u.status.state == "erro" and u.status.checked_at is not None
