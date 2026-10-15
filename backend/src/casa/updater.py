"""Atualização automática pelos releases do GitHub (repositório privado, token no cofre).

Fluxo (só no central.exe instalado; rodando do código só avisa que há versão nova):
1. A cada hora (ou no "Verificar agora"), lê o último release.
2. Versão maior que a atual: baixa o instalador novo E o da versão atual (para voltar se der errado)
   e confere o SHA-256 publicado no release (arquivo inteiro e do release certo; quem garante a
   origem é o acesso ao repositório privado, como no Hugin).
3. Copia o banco para backups/ e dispara a tarefa "Central Atualizador" (SYSTEM), que roda o
   instalador em modo silencioso fora deste processo (o instalador para a central para trocar os
   arquivos), confere /api/health e reinstala a versão anterior se a nova não subir.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import httpx

from casa import __version__
from casa.settings import FROZEN, Settings
from casa.store import Store
from casa.vault import Vault

log = logging.getLogger(__name__)

REPO = "Yanngc32/Sete-Favos"
TOKEN_KEY = "update:github_token"  # noqa: S105 - nome da entrada no cofre, não o segredo
CHECK_EVERY = 3600.0
MAX_INSTALLER = 200 * 1024 * 1024
TASK = "Central Atualizador"
API = "https://api.github.com"

_VERSION = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")

State = Literal["sem_token", "ok", "verificando", "baixando", "instalando", "disponivel", "erro"]


class UpdateError(Exception):
    pass


def parse_version(text: str) -> tuple[int, int, int] | None:
    m = _VERSION.match(text.strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def sha256_matches(data: bytes, published: str) -> bool:
    """`published`: conteúdo do .sha256 do release (o hash, opcionalmente seguido do nome)."""
    expected = published.strip().split()[0].lower() if published.strip() else ""
    return bool(re.fullmatch(r"[0-9a-f]{64}", expected)) and hashlib.sha256(data).hexdigest() == expected


@dataclass
class Status:
    state: State = "sem_token"
    current: str = __version__
    latest: str | None = None
    checked_at: float | None = None
    message: str | None = None
    # Só o central.exe instalado aplica; rodando do código, só avisa.
    can_apply: bool = FROZEN


class Updater:
    def __init__(self, settings: Settings, store: Store, vault: Vault, *, transport: Any = None) -> None:
        self.settings = settings
        self.store = store
        self.vault = vault
        self.status = Status(state="ok" if vault.has(TOKEN_KEY) else "sem_token")
        self._lock = asyncio.Lock()
        self._transport = transport
        self._dir = settings.data_dir / "updates"

    # API ----------------------------------------------------------------------

    def view(self) -> dict[str, Any]:
        return asdict(self.status)

    async def set_token(self, token: str) -> None:
        token = token.strip()
        if not re.fullmatch(r"[A-Za-z0-9_]{20,255}", token):
            raise ValueError("Token inválido. Cole o token do GitHub (começa com github_pat_ ou ghp_).")
        async with self._client(token) as client:
            r = await client.get(f"/repos/{REPO}")
        if r.status_code != 200:
            raise ValueError("O GitHub recusou o token ou ele não tem acesso ao repositório.")
        self.vault.set(TOKEN_KEY, token)
        self.status.state, self.status.message = "ok", None

    def clear_token(self) -> None:
        self.vault.delete(TOKEN_KEY)
        self.status.state, self.status.message = "sem_token", None

    async def run_forever(self) -> None:
        await asyncio.sleep(30)  # deixa a central subir e os aparelhos conectarem antes
        while True:
            await self.check()
            await asyncio.sleep(CHECK_EVERY)

    async def check(self) -> None:
        """Verifica e, se houver versão nova no central.exe instalado, aplica na hora."""
        if self._lock.locked():
            return
        async with self._lock:
            token = self.vault.get(TOKEN_KEY)
            if not token:
                self.status.state = "sem_token"
                return
            try:
                await self._check(token)
            except UpdateError as exc:
                self.status.state, self.status.message = "erro", str(exc)
                log.warning("atualização: %s", exc)
            except (httpx.HTTPError, OSError) as exc:
                self.status.state, self.status.message = "erro", "Sem conexão com o GitHub."
                log.warning("atualização: %r", exc)
            except Exception:
                # Nunca derruba o laço de verificação horária.
                self.status.state, self.status.message = "erro", "A atualização falhou. Veja o log da colmeia."
                log.exception("atualização falhou")
            finally:
                self.status.checked_at = time.time()

    # Interno ------------------------------------------------------------------

    def _client(self, token: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=API, timeout=60, follow_redirects=True, transport=self._transport,
            headers={
                "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28", "User-Agent": f"Central/{__version__}",
            },
        )

    async def _check(self, token: str) -> None:
        self.status.state, self.status.message = "verificando", None
        async with self._client(token) as client:
            r = await client.get(f"/repos/{REPO}/releases/latest")
            if r.status_code == 404:
                self.status.state, self.status.latest = "ok", None
                return
            if r.status_code in (401, 403):
                raise UpdateError("O GitHub recusou o token de atualização (expirou?).")
            r.raise_for_status()
            release = r.json()
            latest = parse_version(str(release.get("tag_name", "")))
            current = parse_version(__version__)
            if latest is None:
                raise UpdateError(f"Tag de release inválida: {release.get('tag_name')!r}.")
            self.status.latest = ".".join(map(str, latest))
            if current is not None and latest <= current:
                self.status.state = "ok"
                return
            if not FROZEN:
                self.status.state = "disponivel"
                return
            self.status.state = "baixando"
            new = await self._fetch(client, release, self.status.latest)
            previous = None
            if current is not None:
                with contextlib.suppress(UpdateError, httpx.HTTPError):
                    r = await client.get(f"/repos/{REPO}/releases/tags/v{__version__}")
                    if r.status_code == 200:
                        previous = await self._fetch(client, r.json(), __version__)
        self.status.state = "instalando"
        self._backup()
        await asyncio.to_thread(self._launch, new, previous)

    async def _fetch(self, client: httpx.AsyncClient, release: dict[str, Any], version: str) -> Path:
        name = f"CentralSetup-{version}.exe"
        assets = {a.get("name"): a for a in release.get("assets") or []}
        exe, digest = assets.get(name), assets.get(f"{name}.sha256")
        if not exe or not digest:
            raise UpdateError(f"O release {version} não tem {name} com o .sha256.")
        if int(exe.get("size") or 0) > MAX_INSTALLER:
            raise UpdateError("Instalador grande demais; recusado.")
        published = (await self._download(client, digest["url"], 1024)).decode("ascii", "replace")
        data = await self._download(client, exe["url"], MAX_INSTALLER)
        if not sha256_matches(data, published):
            raise UpdateError(f"{name} não confere com o SHA-256 do release; atualização recusada.")
        self._dir.mkdir(parents=True, exist_ok=True)
        target = self._dir / name
        target.write_bytes(data)
        return target

    @staticmethod
    async def _download(client: httpx.AsyncClient, url: str, limit: int) -> bytes:
        # Asset por API + octet-stream: o GitHub redireciona para o storage, e o httpx não leva o
        # Authorization para outra origem no redirecionamento.
        chunks, size = [], 0
        async with client.stream("GET", url, headers={"Accept": "application/octet-stream"}) as r:
            r.raise_for_status()
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > limit:
                    raise UpdateError("Download maior que o esperado; recusado.")
                chunks.append(chunk)
        return b"".join(chunks)

    def _backup(self) -> None:
        backups = self.settings.data_dir / "backups"
        backups.mkdir(parents=True, exist_ok=True)
        self.store.backup(backups / f"casa-{__version__}-{time.strftime('%Y%m%d-%H%M%S')}.db")
        for old in sorted(backups.glob("casa-*.db"))[:-10]:  # guarda os 10 mais recentes
            old.unlink(missing_ok=True)

    def _launch(self, new: Path, previous: Path | None) -> None:
        """Registra e dispara a tarefa SYSTEM que roda update.ps1 fora deste processo."""
        script = self._dir / "update.ps1"
        shutil.copyfile(Path(__file__).with_name("update.ps1"), script)

        def q(p: Path | str) -> str:  # literal PowerShell entre aspas simples
            return "'" + str(p).replace("'", "''") + "'"

        args = (
            f"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" "
            f"-Novo \"{new}\" -Porta {self.settings.port}"
        )
        if previous:
            args += f" -Anterior \"{previous}\""
        command = (
            f"$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument {q(args)}; "
            "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; "
            "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries "
            "-ExecutionTimeLimit (New-TimeSpan -Minutes 30); "
            f"Register-ScheduledTask -TaskName {q(TASK)} -Action $a -Principal $p -Settings $s -Force | Out-Null; "
            f"Start-ScheduledTask -TaskName {q(TASK)}"
        )
        result = subprocess.run(  # noqa: S603
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],  # noqa: S607
            capture_output=True, text=True, timeout=60, check=False,
        )
        if result.returncode:
            raise UpdateError(f"Não consegui iniciar o atualizador: {result.stderr.strip()[:200]}")
        log.info("atualização para %s iniciada (anterior guardado: %s)", new.name, bool(previous))
