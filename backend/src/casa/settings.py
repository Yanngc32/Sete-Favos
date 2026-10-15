from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Empacotado (central.exe, PyInstaller): o painel vem dentro do pacote e os dados ficam em ProgramData.
FROZEN = bool(getattr(sys, "frozen", False))
_REPO_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"
_FROZEN_FRONTEND_DIST = Path(getattr(sys, "_MEIPASS", ".")) / "frontend" / "dist"
# Porta fora das conhecidas e da faixa dinâmica do Windows (49152+). Não é proteção, só evita varredura óbvia.
DEFAULT_PORT = 38471


def _default_data_dir() -> Path:
    if FROZEN:
        return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Central"
    return Path.home() / ".casa"


def read_env_file(path: Path) -> dict[str, str]:
    """`casa.env` (CHAVE=valor por linha), gravado pelo instalador na pasta de dados."""
    out: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return out
    for line in lines:
        key, sep, value = line.partition("=")
        key = key.strip()
        if sep and key.isidentifier() and key.isupper():
            out[key] = value.strip()
    return out


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    host: str
    port: int
    # Nomes extras aceitos no cabeçalho Host (ex.: nome do PC na tailnet).
    extra_hosts: frozenset[str]
    simulate: bool
    frontend_dir: Path | None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "casa.db"

    @classmethod
    def from_env(cls) -> Settings:
        data_dir = Path(os.environ.get("CASA_DATA_DIR") or _default_data_dir())
        # Variáveis do ambiente valem mais que o casa.env.
        env = {**read_env_file(data_dir / "casa.env"), **os.environ}
        frontend = env.get("CASA_FRONTEND_DIR")
        frontend_dir = Path(frontend) if frontend else _FROZEN_FRONTEND_DIST if FROZEN else _REPO_FRONTEND_DIST
        hosts = env.get("CASA_HOSTS", "")
        return cls(
            data_dir=data_dir,
            # Todas as placas; quem limita a LAN + Tailscale é a regra do Firewall (instalador).
            host=env.get("CASA_HOST", "0.0.0.0"),  # noqa: S104
            port=int(env.get("CASA_PORT") or DEFAULT_PORT),
            extra_hosts=frozenset(h.strip().lower().rstrip(".") for h in hosts.split(",") if h.strip()),
            simulate=env.get("CASA_SIMULAR", "").strip().lower() in {"1", "true", "sim", "yes"},
            frontend_dir=frontend_dir if frontend_dir.is_dir() else None,
        )
