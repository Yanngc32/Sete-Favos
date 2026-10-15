"""Sobe a central: `uv run casa` (ou `python -m casa`)."""

from __future__ import annotations

import logging
import logging.handlers

import uvicorn

from casa.app import create_app
from casa.settings import Settings

# Estas bibliotecas registram tokens/senhas em nível DEBUG: nunca abaixo de WARNING.
_QUIET = ("micloud", "miio", "tinytuya", "msmart", "aiowebostv", "httpx", "httpcore")


def setup_logging(settings: Settings) -> None:
    log_dir = settings.data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / "casa.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[file_handler, console])
    for name in _QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)


def main() -> None:
    settings = Settings.from_env()
    setup_logging(settings)
    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        # Nunca confiar em X-Forwarded-*: o "PC sempre liberado" depende do IP real do cliente.
        proxy_headers=False,
        forwarded_allow_ips="",
        server_header=False,
        log_config=None,
    )


if __name__ == "__main__":
    main()
