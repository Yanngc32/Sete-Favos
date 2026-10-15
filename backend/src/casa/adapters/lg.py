"""TVs LG webOS pela LAN com aiowebostv (WebSocket 3000/3001).

Primeira conexão: a TV mostra um pedido; aceito, ela devolve o client_key, que
vai para o cofre. Ligar com a TV desligada usa Wake-on-LAN com o MAC lido no
pareamento (pode não funcionar em todo modelo: não verificado).
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
from aiowebostv import WebOsClient
from aiowebostv.exceptions import WebOsTvPairError
from defusedxml import ElementTree

from casa.adapters.base import Adapter, AdapterError, Candidate, DeviceUnreachable, Driver, Found
from casa.adapters.caps import REMOTE_KEYS, tv_caps
from casa.model import Capability, DeviceRecord
from casa.net import lan_ipv4s, wake_on_lan

log = logging.getLogger(__name__)

SSDP_ADDR = ("239.255.255.250", 1900)
SSDP_ST = "urn:lge-com:service:webos-second-screen:1"
PAIR_TIMEOUT = 60.0
CONNECT_TIMEOUT = 4.0
# A TV leva uns 5–20 s pra subir depois do Wake-on-LAN; nesse tempo "não respondeu" não é "desligada".
WAKE_GRACE = 25.0
NO_WOL_NOTE = "Esta TV só liga pelo controle."


class _PairingClient(WebOsClient):
    """Igual ao WebOsClient, mas espera até 60 s o "Aceitar" na TV (o original espera 10 s)."""

    async def _check_registration(self, ws: Any) -> None:
        await ws.send_json(self.registration_msg())
        async with asyncio.timeout(PAIR_TIMEOUT):
            response = await ws.receive_json()
            if response["type"] == "response" and response["payload"].get("pairingType") == "PROMPT":
                response = await ws.receive_json()
        if response["type"] == "error":
            raise WebOsTvPairError(response.get("error"))
        if response["type"] == "registered":
            self.client_key = response["payload"]["client-key"]
        if not self.client_key:
            raise WebOsTvPairError("sem client_key")


class LgAdapter(Adapter):
    vendor = "lg"
    label = "LG (TV webOS)"
    description = "TVs LG com webOS"
    device_secrets = ("client_key",)

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        seen: set[str] = set()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, dict[str, str]]] = asyncio.Queue()
        transports = []
        message = (
            "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\n"
            f"MX: 2\r\nST: {SSDP_ST}\r\n\r\n"
        ).encode()
        for local in lan_ipv4s():
            try:
                transport, _ = await loop.create_datagram_endpoint(
                    lambda: _SsdpProtocol(queue), local_addr=(local, 0)
                )
            except OSError:
                continue
            sock = transport.get_extra_info("socket")
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(local))
            transports.append(transport)
            for _ in range(2):
                transport.sendto(message, SSDP_ADDR)
        try:
            async with asyncio.timeout(min(timeout, 6)):
                while True:
                    ip, headers = await queue.get()
                    if ip in seen:
                        continue
                    seen.add(ip)
                    found(await self._candidate(ip, headers))
        except TimeoutError:
            pass
        finally:
            for t in transports:
                t.close()

    async def _candidate(self, ip: str, headers: dict[str, str]) -> Candidate:
        name, model = "TV LG", None
        location = headers.get("location")
        # O M-SEARCH é UDP: qualquer um na LAN responde com um LOCATION qualquer. Só segue se for do mesmo IP.
        if location and urlsplit(location).hostname == ip:
            name, model = await _describe(location, name)
        usn = headers.get("usn", "")
        key = usn.split("::")[0].removeprefix("uuid:") or ip
        return Candidate(key=key, vendor=self.vendor, name=name, model=model, ip=ip, kind="tv", needs_pairing=True)

    async def manual_candidate(self, ip: str, device_id: str | None, secret: str | None) -> Candidate:
        candidate = Candidate(key=ip, vendor=self.vendor, name="TV LG", ip=ip, kind="tv", needs_pairing=secret is None)
        if secret:
            candidate.secrets = {"client_key": secret}
        return candidate

    async def pair(self, candidate: Candidate) -> Candidate:
        assert candidate.ip
        client = _PairingClient(candidate.ip, client_key=None, connect_timeout=CONNECT_TIMEOUT)
        try:
            await client.connect()
        except WebOsTvPairError:
            raise AdapterError("tv_recusou", "A TV não confirmou. Tente de novo e aceite na tela.") from None
        except Exception as exc:
            log.info("pareamento LG falhou: %r", exc)
            raise AdapterError(
                "tv_sem_resposta", "A TV não respondeu. Ela está ligada e no mesmo Wi-Fi do PC?"
            ) from None
        try:
            if not client.client_key:
                raise AdapterError("tv_recusou", "A TV não confirmou. Tente de novo e aceite na tela.")
            candidate.secrets = {"client_key": client.client_key}
            candidate.config["macs"] = _macs(client.tv_info.connection)
            candidate.model = client.tv_info.system.get("modelName") or candidate.model
        finally:
            await client.disconnect()
        return candidate

    def driver(self, record: DeviceRecord) -> Driver:
        return LgDriver(record, self.vault)


class _SsdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, queue: asyncio.Queue[tuple[str, dict[str, str]]]) -> None:
        self.queue = queue

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        text = data.decode("utf-8", "replace")
        if SSDP_ST not in text:
            return
        headers = {}
        for line in text.split("\r\n")[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        self.queue.put_nowait((addr[0], headers))


async def _describe(location: str, default: str) -> tuple[str, str | None]:
    """Lê friendlyName/modelName do XML de descrição UPnP da TV."""
    try:
        async with httpx.AsyncClient(timeout=3, follow_redirects=False) as http, http.stream("GET", location) as resp:
            body = b""
            async for chunk in resp.aiter_bytes():
                body += chunk
                if len(body) > 64 * 1024:
                    return default, None
        root = ElementTree.fromstring(body)
    except Exception:
        return default, None
    name = model = None
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "friendlyName" and not name:
            name = (el.text or "").strip()
        elif tag == "modelName" and not model:
            model = (el.text or "").strip()
    return name or default, model or None


def _macs(connection: dict[str, Any]) -> list[str]:
    macs: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if k.lower() == "macaddress" and isinstance(v, str) and v and v not in macs:
                    macs.append(v)
                else:
                    walk(v)

    walk(connection or {})
    return macs


class LgDriver(Driver):
    # Também é o intervalo para tentar reconectar quando a TV está desligada.
    poll_interval = 10.0

    def __init__(self, record: DeviceRecord, vault: Any) -> None:
        super().__init__(record, vault)
        self._client: WebOsClient | None = None
        self._sources: list[tuple[str, str]] = []
        self._waking_until = 0.0

    def capabilities(self) -> list[Capability]:
        return tv_caps(self._sources)

    def notes(self) -> list[str]:
        return [] if self.record.config.get("macs") else [NO_WOL_NOTE]

    async def _connect(self) -> WebOsClient | None:
        if self._client and self._client.is_connected():
            return self._client
        key = self.secret("client_key")
        if not key:
            raise DeviceUnreachable("sem client_key no cofre")
        if self._client is None:
            self._client = WebOsClient(self.record.config["ip"], client_key=key, connect_timeout=CONNECT_TIMEOUT)
            await self._client.register_state_update_callback(self._on_state)
        try:
            # shield: cancelar o future interno do aiowebostv faz a conexão cair quando ela completa
            # depois do prazo (InvalidStateError); assim ela segue e a próxima leitura já a aproveita.
            task = asyncio.ensure_future(self._client.connect())
            task.add_done_callback(lambda t: t.cancelled() or t.exception())
            await asyncio.wait_for(asyncio.shield(task), CONNECT_TIMEOUT + 2)
        except WebOsTvPairError:
            raise AdapterError("tv_despareada", "A TV esqueceu o pareamento. Remova e adicione de novo.") from None
        except Exception:
            return None
        return self._client

    def _waking(self) -> bool:
        return time.monotonic() < self._waking_until

    async def refresh(self) -> dict[str, Any]:
        client = await self._connect()
        # TV desligada (ou em standby) não responde: aparece como "Desligada", não como offline.
        # Logo depois do Wake-on-LAN ela ainda está subindo: segura o "Ligada" até o prazo.
        if client is None:
            return {"power": True} if self._waking() else {"power": False}
        state = self._read(client)
        if state.get("power"):
            self._waking_until = 0.0
        elif self._waking():
            state["power"] = True
        return state

    async def _on_state(self, _: Any) -> None:
        if self._client is not None:
            self.push(self._read(self._client))

    def _read(self, client: WebOsClient) -> dict[str, Any]:
        s = client.tv_state
        sources = [(app_id, i.get("label") or app_id) for app_id, i in (s.inputs or {}).items()]
        known = {v for v, _ in sources}
        apps = sorted(
            ((app_id, a.get("title") or app_id) for app_id, a in (s.apps or {}).items() if app_id not in known),
            key=lambda x: x[1].casefold(),
        )
        self._sources = sources + apps
        state: dict[str, Any] = {"power": bool(s.is_on)}
        if s.volume is not None:
            state["volume"] = int(s.volume)
        if s.muted is not None:
            state["muted"] = bool(s.muted)
        if s.current_app_id:
            state["source"] = s.current_app_id
        return state

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        if capability == "power" and value:
            live = self._client if self._client and self._client.is_connected() else None
            if live is not None and live.tv_state.is_on:
                return {"power": True}
            macs = self.record.config.get("macs") or []
            if not macs:
                # Sem MAC só dá pra saber se ela já está ligada (aí a conexão responde).
                client = await self._connect()
                if client is not None and client.tv_state.is_on:
                    return {"power": True}
                raise AdapterError("sem_wol", NO_WOL_NOTE)
            # Manda o Wake-on-LAN JÁ, sem esperar conexão: com a TV desligada a conexão leva até ~6 s e
            # estourava o prazo do comando (erro na tela e a TV ligando depois). Com "Ligar via Wi-Fi"/
            # Quick Start+ ela também precisa do WoL pra acender a tela.
            for mac in macs:
                await asyncio.to_thread(wake_on_lan, mac)
            self._waking_until = time.monotonic() + WAKE_GRACE
            return {"power": True}  # a leitura seguinte confirma (e segura enquanto ela sobe)
        client = await self._connect()
        if client is None:
            raise DeviceUnreachable("TV desligada")
        if capability == "power":
            await client.power_off()
            return {"power": False}
        if capability == "volume":
            await client.set_volume(int(value))
        elif capability == "muted":
            await client.set_mute(bool(value))
        elif capability == "source":
            await client.launch_app(value)
        else:
            raise AdapterError("nao_suportado", "A TV não aceita esse comando.")
        return {capability: value}

    def remote_keys(self) -> tuple[str, ...]:
        return REMOTE_KEYS

    async def remote(self, key: str) -> None:
        client = await self._connect()
        if client is None or not client.tv_state.is_on:
            raise DeviceUnreachable("TV desligada")
        await client.button(key)

    async def test(self) -> None:
        client = await self._connect()
        if client is None:
            raise AdapterError("tv_desligada", "Ligue a TV para testar.")
        await client.send_message("Casa: esta é a TV certa.")

    async def close(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.disconnect()
