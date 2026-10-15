from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from casa.adapters.sim import SimAdapter
from casa.app import create_app
from casa.settings import Settings
from casa.store import Store
from casa.vault import MemoryKeyring, Vault


@pytest.fixture
def vault() -> Vault:
    return Vault(MemoryKeyring())


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path, host="127.0.0.1", port=8484, extra_hosts=frozenset({"casa.tailnet.ts.net"}),
        simulate=True, frontend_dir=None,
    )


@pytest.fixture
def app(settings: Settings, vault: Vault):
    return create_app(settings, store=Store(settings.db_path), vault=vault, adapters={"simulado": SimAdapter(vault)})


@pytest.fixture
def pc(app):
    """Cliente rodando no próprio PC (loopback)."""
    with TestClient(app, base_url="http://localhost:8484", client=("127.0.0.1", 50000)) as client:
        yield client


@pytest.fixture
def phone(app):
    """Celular na rede de casa, sem pareamento."""
    with TestClient(app, base_url="http://192.168.1.2:8484", client=("192.168.1.50", 50001)) as client:
        yield client
