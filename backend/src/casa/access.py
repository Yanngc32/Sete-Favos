"""Quem pode usar o painel, sem login.

- O PC (pedido vindo de 127.0.0.1/::1, com Host de loopback e sem cabeçalho de
  proxy) sempre pode. Qualquer processo do próprio PC conta como PC: não rode
  proxy TCP local (`netsh portproxy`, `ssh -L`, `tailscale serve --tcp`) pra esta porta.
- Outros aparelhos são pareados uma vez com um código de 6 dígitos gerado no PC
  (vale 5 min, uso único, invalida após 5 erros) e recebem um token longo em
  cookie HttpOnly. O backend guarda só o hash do token. Revogar corta na hora.

Defesas do "PC sempre liberado":
- uvicorn roda com proxy_headers=False: X-Forwarded-* nunca muda o IP do cliente.
- Pedido de loopback com cabeçalho de proxy (Forwarded, X-Forwarded-*, Via,
  Tailscale-*) NÃO conta como PC: um proxy local (ex.: `tailscale serve`) não
  consegue fazer pedido de fora parecer do PC.
- Host precisa ser IP literal ou nome conhecido (bloqueia DNS rebinding).
- Origem do pedido fora de loopback, rede privada, link-local ou Tailscale é
  recusada antes de qualquer rota (mesmo se o firewall estiver aberto demais).
- Corpo de pedido tem teto (16 KB sem acesso, 1 MB com acesso).
- Pedido que muda estado e WebSocket com Origin diferente do Host são recusados
  (bloqueia CSRF de um site aberto no navegador do PC).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import shutil
import socket
import time
from dataclasses import dataclass
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from casa.events import EventBus
from casa.model import new_id
from casa.net import TAILNET
from casa.store import Store

COOKIE = "casa_acesso"
COOKIE_MAX_AGE = 10 * 365 * 24 * 3600
CODE_TTL = 300.0
MAX_ATTEMPTS = 5
TOUCH_EVERY = 60.0

LOOPBACK = frozenset({"127.0.0.1", "::1"})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
# Cabeçalhos que só um proxy escreve. Por prefixo, porque cada proxy inventa o seu.
PROXY_HEADERS = frozenset({
    b"forwarded", b"via", b"client-ip", b"true-client-ip", b"cluster-client-ip", b"proxy-connection",
})
PROXY_HEADER_PREFIXES = (
    b"x-forwarded-", b"x-real-", b"x-original-", b"x-client-", b"x-cluster-", b"x-envoy-", b"cf-", b"tailscale-",
    b"fastly-", b"akamai-", b"x-azure-",
)
MAX_BODY_PUBLIC = 16 * 1024
MAX_BODY = 1024 * 1024
# Rotas da API abertas a quem ainda não tem acesso.
PUBLIC_API = frozenset({"/api/health", "/api/session", "/api/access/pair"})


class AccessDevice(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    token_hash: str
    created_at: float = Field(default_factory=time.time)
    last_seen: float | None = None
    last_via: Literal["lan", "tailscale"] | None = None


@dataclass
class Principal:
    kind: Literal["pc", "device"]
    device: AccessDevice | None = None

    @property
    def is_pc(self) -> bool:
        return self.kind == "pc"


class PairingError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class _Pairing:
    code: str
    expires: float
    attempts: int = 0


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Access:
    def __init__(self, store: Store, bus: EventBus, now: Any = time.time) -> None:
        self.store = store
        self.bus = bus
        self._now = now
        self.devices = {d["id"]: AccessDevice.model_validate(d) for d in store.all("access_devices")}
        self._pairing: _Pairing | None = None
        self._last_paired: tuple[float, str] | None = None

    # Identificação ------------------------------------------------------------

    @staticmethod
    def is_pc(client_host: str | None, header_names: set[bytes], host: str) -> bool:
        if client_host is None:
            return False
        peer = client_host.removeprefix("::ffff:")
        return peer in LOOPBACK and host in LOOPBACK_HOSTS and not _has_proxy_header(header_names)

    def by_token(self, token: str | None) -> AccessDevice | None:
        if not token:
            return None
        digest = _hash(token)
        for d in self.devices.values():
            if hmac.compare_digest(d.token_hash, digest):
                return d
        return None

    def touch(self, device: AccessDevice, client_host: str | None) -> None:
        now = self._now()
        via = _via(client_host)
        if device.last_seen and now - device.last_seen < TOUCH_EVERY and device.last_via == via:
            return
        device.last_seen = now
        device.last_via = via
        self.store.put("access_devices", device.id, device.model_dump())

    # Pareamento ---------------------------------------------------------------

    def start_pairing(self) -> dict[str, Any]:
        code = f"{secrets.randbelow(10**6):06d}"
        self._pairing = _Pairing(code=code, expires=self._now() + CODE_TTL)
        self._last_paired = None  # o dialog novo não pode herdar o "pareado" do código anterior
        return {"code": code, "expires_at": self._pairing.expires}

    def cancel_pairing(self) -> None:
        self._pairing = None

    def pairing_status(self) -> dict[str, Any]:
        now = self._now()
        if self._last_paired and now - self._last_paired[0] < 30:
            return {"state": "paired", "device": self._last_paired[1]}
        p = self._pairing
        if p is None:
            return {"state": "none"}
        if now >= p.expires:
            return {"state": "expired"}
        return {"state": "waiting", "expires_at": p.expires}

    def pair(self, code: str, name: str | None) -> tuple[AccessDevice, str]:
        p = self._pairing
        invalid = PairingError("invalido", "Código inválido ou expirado. Gere outro no PC.")
        if p is None or self._now() >= p.expires:
            raise invalid
        if not hmac.compare_digest(p.code.encode(), (code or "").strip().encode()):
            p.attempts += 1
            if p.attempts >= MAX_ATTEMPTS:
                self._pairing = None
                raise PairingError("tentativas", "Muitas tentativas. Gere um código novo no PC.")
            raise invalid
        self._pairing = None
        token = secrets.token_urlsafe(32)
        device = AccessDevice(name=(name or "").strip()[:60] or "Aparelho novo", token_hash=_hash(token))
        self.devices[device.id] = device
        self.store.put("access_devices", device.id, device.model_dump())
        self._last_paired = (self._now(), device.name)
        self.bus.publish({"t": "access_paired", "pc_only": True, "device": public_view(device)})
        return device, token

    # Gestão -------------------------------------------------------------------

    def rename(self, device_id: str, name: str) -> AccessDevice:
        device = self.devices[device_id]
        name = name.strip()
        if not name:
            raise ValueError("Dê um nome ao aparelho.")
        device.name = name[:60]
        self.store.put("access_devices", device.id, device.model_dump())
        return device

    def revoke(self, device_id: str) -> None:
        device = self.devices.pop(device_id)
        self.store.delete("access_devices", device.id)
        self.bus.publish({"t": "access_revoked", "id": device.id})


def _has_proxy_header(names: set[bytes]) -> bool:
    return bool(names & PROXY_HEADERS) or any(n.startswith(PROXY_HEADER_PREFIXES) for n in names)


def trusted_peer(client_host: str | None) -> bool:
    """Só rede de casa: loopback, privada, link-local ou Tailscale."""
    if not client_host:
        return False
    try:
        ip = ipaddress.ip_address(client_host.removeprefix("::ffff:"))
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip in TAILNET


def public_view(device: AccessDevice) -> dict[str, Any]:
    return device.model_dump(exclude={"token_hash"})


def _via(client_host: str | None) -> Literal["lan", "tailscale"]:
    try:
        return "tailscale" if client_host and ipaddress.ip_address(client_host) in TAILNET else "lan"
    except ValueError:
        return "lan"


# Host / Origin ----------------------------------------------------------------


class HostNames:
    """Nomes aceitos no cabeçalho Host além de IPs literais (localhost, nome do PC, nome na tailnet)."""

    REFRESH = 300.0

    def __init__(self, extra: frozenset[str]) -> None:
        self._extra = extra
        self.tailnet_name: str | None = None
        self._names = frozenset({"localhost", socket.gethostname().lower(), *extra})

    async def refresh(self) -> None:
        self.tailnet_name = await _tailscale_dns_name()
        names = {"localhost", socket.gethostname().lower(), *self._extra}
        if self.tailnet_name:
            names |= {self.tailnet_name, self.tailnet_name.split(".")[0]}
        self._names = frozenset(names)

    async def keep_fresh(self) -> None:
        while True:
            await asyncio.sleep(self.REFRESH)
            await self.refresh()

    def allowed(self, host: str) -> bool:
        return _is_ip(host) or host in self._names


def tailscale_cli() -> str | None:
    """O instalador do Tailscale no Windows nem sempre põe a CLI no PATH."""
    found = shutil.which("tailscale")
    if found:
        return found
    default = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tailscale" / "tailscale.exe"
    return str(default) if default.is_file() else None


async def _tailscale_dns_name() -> str | None:
    cli = tailscale_cli()
    if cli is None:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            cli, "status", "--json", "--peers=false",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), 5)
        except TimeoutError:
            proc.kill()
            return None
        name = (json.loads(out).get("Self") or {}).get("DNSName") or ""
        return name.lower().rstrip(".") or None
    except (OSError, ValueError, AttributeError):
        return None


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def split_host(value: str) -> tuple[str, str | None]:
    """'Host: [::1]:8484' -> ('::1', '8484')."""
    value = value.strip().lower()
    if value.startswith("["):
        end = value.find("]")
        host, rest = value[1:end], value[end + 1:]
        return host, rest[1:] if rest.startswith(":") else None
    if value.count(":") == 1:
        host, port = value.split(":")
        return host, port
    return value, None


def same_origin(origin: str, host_header: str, scheme: str) -> bool:
    try:
        o = urlsplit(origin)
        o_port = o.port
    except ValueError:
        return False
    if o.scheme not in ("http", "https") or not o.hostname:
        return False
    default = "443" if o.scheme == "https" else "80"
    o_port = str(o_port) if o_port else default
    host, port = split_host(host_header)
    h_default = "443" if scheme in ("https", "wss") else "80"
    return o.hostname.lower() == host and o_port == (port or h_default)


def read_cookie(raw: str | None) -> str | None:
    if not raw:
        return None
    jar = SimpleCookie()
    try:
        jar.load(raw)
    except Exception:
        return None
    morsel = jar.get(COOKIE)
    return morsel.value if morsel else None


class AccessMiddleware:
    """ASGI: aplica Host/Origin e decide quem é o cliente antes de qualquer rota."""

    def __init__(self, app: Any, access: Access, hosts: HostNames) -> None:
        self.app = app
        self.access = access
        self.hosts = hosts

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers: dict[bytes, bytes] = {}
        for k, v in scope.get("headers", []):
            headers[k.lower()] = v
        is_ws = scope["type"] == "websocket"
        client = scope.get("client")
        client_host = client[0] if client else None
        if not trusted_peer(client_host):
            await _reject(scope, send, 403, "origem_de_rede_recusada")
            return
        host_header = headers.get(b"host", b"").decode("latin-1")
        host, _ = split_host(host_header)
        if not host or not self.hosts.allowed(host):
            await _reject(scope, send, 400, "host_desconhecido")
            return
        origin = headers.get(b"origin")
        unsafe = is_ws or scope.get("method") not in ("GET", "HEAD", "OPTIONS")
        if unsafe and origin is not None and not same_origin(origin.decode("latin-1"), host_header, scope["scheme"]):
            await _reject(scope, send, 403, "origem_recusada")
            return

        principal: Principal | None = None
        if Access.is_pc(client_host, set(headers), host):
            principal = Principal("pc")
        else:
            device = self.access.by_token(read_cookie(headers.get(b"cookie", b"").decode("latin-1")))
            if device is not None:
                self.access.touch(device, client_host)
                principal = Principal("device", device)
        scope.setdefault("state", {})["principal"] = principal

        path: str = scope["path"]
        public = path in PUBLIC_API or not path.startswith("/api/")
        if not public and principal is None:
            await _reject(scope, send, 401, "nao_autorizado")
            return
        if is_ws:
            await self.app(scope, receive, send)
            return
        await self._limited(scope, receive, send, MAX_BODY if principal else MAX_BODY_PUBLIC, headers)

    async def _limited(self, scope: dict, receive: Any, send: Any, limit: int, headers: dict[bytes, bytes]) -> None:
        """Corta corpo grande antes de a rota (ou o parser JSON) engolir tudo na memória."""
        declared = headers.get(b"content-length", b"0")
        if declared.isdigit() and int(declared) > limit:
            await _reject(scope, send, 413, "corpo_grande_demais")
            return
        total = 0
        started = False

        async def counted_receive() -> dict:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise _BodyTooLarge
            return message

        async def tracked_send(message: dict) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except _BodyTooLarge:
            if not started:
                await _reject(scope, send, 413, "corpo_grande_demais")


class _BodyTooLarge(Exception):
    pass


async def _reject(scope: dict, send: Any, status: int, code: str) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": 4000 + status})
        return
    body = json.dumps({"detail": code}).encode()
    await send({
        "type": "http.response.start", "status": status,
        "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
            (b"x-content-type-options", b"nosniff"),
        ],
    })
    await send({"type": "http.response.body", "body": body})
