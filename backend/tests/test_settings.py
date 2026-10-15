from __future__ import annotations

from pathlib import Path

import pytest

from casa.settings import Settings, read_env_file


def test_env_file_is_read_and_environment_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "casa.env").write_text("\ufeffCASA_PORT=9000\nCASA_HOSTS=pc, pc.tailnet.ts.net.\n# comentario=1\nlixo\n",
                                       encoding="utf-8")
    assert read_env_file(tmp_path / "casa.env") == {"CASA_PORT": "9000", "CASA_HOSTS": "pc, pc.tailnet.ts.net."}
    assert read_env_file(tmp_path / "nao-existe.env") == {}

    monkeypatch.setenv("CASA_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("CASA_PORT", raising=False)
    monkeypatch.delenv("CASA_HOSTS", raising=False)
    s = Settings.from_env()
    assert s.port == 9000 and s.extra_hosts == {"pc", "pc.tailnet.ts.net"}

    monkeypatch.setenv("CASA_PORT", "8484")
    assert Settings.from_env().port == 8484
