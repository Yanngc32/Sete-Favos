"""Tuya / Smart Life e Positivo Casa Inteligente (Tuya por baixo), pela LAN com tinytuya.

A nuvem (projeto no iot.tuya.com) só é usada para listar os aparelhos e pegar a
local_key de cada um, na hora de cadastrar. O controle do dia a dia é local
(TCP 6668); os anúncios UDP (6666/6667/7000) dão o IP e a versão do protocolo.

Não usamos o wizard/scanner do tinytuya: eles gravam devices.json/snapshot.json
com as chaves em texto puro.
"""

from __future__ import annotations

import asyncio
import colorsys
import json
import logging
import time
from collections.abc import Callable
from typing import Any

import tinytuya
from tinytuya.core.udp_helper import decrypt_udp

from casa.adapters.base import (
    AccountField,
    Adapter,
    AdapterError,
    Candidate,
    DeviceUnreachable,
    Driver,
    Found,
)
from casa.adapters.caps import light_caps, plug_caps, switch_caps
from casa.model import Capability, DeviceRecord, Kind

log = logging.getLogger(__name__)

REGIONS = (("us", "América"), ("eu", "Europa"), ("cn", "China"), ("in", "Índia"))
LIGHT_CATEGORIES = frozenset({"dj", "dd", "fwd", "dc", "xdd", "tyndj", "gyd", "sxd", "tgq", "tgkg"})
PLUG_CATEGORIES = frozenset({"cz", "pc", "kg", "tdq", "wkcz", "dlq", "znjdq"})
VERSIONS = ("3.3", "3.4", "3.5", "3.1")

# Códigos de DP que o integrador entende, por função.
POWER_CODES = ("switch_led", "switch_1", "switch")
BRIGHT_CODES = ("bright_value_v2", "bright_value")
TEMP_CODES = ("temp_value_v2", "temp_value")
COLOUR_CODES = ("colour_data_v2", "colour_data")
GANG_CODES = tuple(f"switch_{n}" for n in range(1, 7))  # teclas de interruptor (switch_1..switch_6)
USED_CODES = frozenset({
    *POWER_CODES, *GANG_CODES, *BRIGHT_CODES, *TEMP_CODES, *COLOUR_CODES, "work_mode", "cur_power",
})

# DPs padrão quando a nuvem não manda o mapa (cadastro pelo IP sem conta).
_GUESS_LIGHT_V2 = {
    "switch_led": ("20", "Boolean", {}), "work_mode": ("21", "Enum", {}),
    "bright_value_v2": ("22", "Integer", {"min": 10, "max": 1000}),
    "temp_value_v2": ("23", "Integer", {"min": 0, "max": 1000}), "colour_data_v2": ("24", "Json", {}),
}
_GUESS_LIGHT_V1 = {
    "switch_led": ("1", "Boolean", {}), "work_mode": ("2", "Enum", {}),
    "bright_value": ("3", "Integer", {"min": 25, "max": 255}),
    "temp_value": ("4", "Integer", {"min": 0, "max": 255}), "colour_data": ("5", "String", {}),
}
_GUESS_PLUG = {"switch_1": ("1", "Boolean", {}), "cur_power": ("19", "Integer", {"scale": 1})}


class _Broadcasts:
    """Escuta os anúncios UDP dos aparelhos Tuya: id -> IP e versão. Um só por processo."""

    PORTS = (6666, 6667, 7000)

    def __init__(self) -> None:
        self.seen: dict[str, dict[str, Any]] = {}
        self.listeners: set[Callable[[str, dict[str, Any]], None]] = set()
        self._started = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        async with self._lock:
            if self._started:
                return
            loop = asyncio.get_running_loop()
            for port in self.PORTS:
                try:
                    await loop.create_datagram_endpoint(
                        # Anúncio é broadcast: precisa escutar em todas as placas.
                        lambda: _BroadcastProtocol(self), local_addr=("0.0.0.0", port),  # noqa: S104
                        allow_broadcast=True,
                    )
                except OSError as exc:
                    log.warning("não consegui escutar UDP %d (anúncios Tuya): %s", port, exc)
            self._started = True

    def ip(self, dev_id: str) -> str | None:
        info = self.seen.get(dev_id)
        return info["ip"] if info else None

    def handle(self, data: bytes, addr: tuple[str, int]) -> None:
        try:
            payload = json.loads(decrypt_udp(data))
        except Exception:
            return
        if payload.get("from") == "app":
            return
        dev_id = payload.get("gwId") or payload.get("id")
        if not dev_id or not isinstance(dev_id, str):
            return
        info = {
            # IP do datagrama, não o do JSON: o broadcast é cifrado com uma chave pública,
            # qualquer um na LAN forja um anúncio apontando pra outro endereço.
            "ip": addr[0],
            "version": str(payload.get("version") or "3.3"),
            "product_key": payload.get("productKey"),
            "at": time.monotonic(),
        }
        self.seen[dev_id] = info
        for callback in list(self.listeners):
            callback(dev_id, info)


class _BroadcastProtocol(asyncio.DatagramProtocol):
    def __init__(self, owner: _Broadcasts) -> None:
        self.owner = owner

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        self.owner.handle(data, addr)


BROADCASTS = _Broadcasts()


def _cloud_error(result: Any) -> AdapterError | None:
    if isinstance(result, dict) and (result.get("Error") or result.get("Err")):
        text = json.dumps(result, ensure_ascii=False).lower()
        if "expire" in text:
            return AdapterError(
                "tuya_expirado",
                "O plano de teste da Tuya expirou. Renove em platform.tuya.com "
                "(Cloud > Cloud Services > IoT Core > Extend Trial Period) e tente de novo.",
            )
        return AdapterError("tuya_recusou", "A Tuya recusou a chave. Confira API Key/Secret e a região.")
    return None


def _values(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    return raw if isinstance(raw, dict) else {}


def compact_mapping(mapping: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Mapa da nuvem {dp: {code, type, values}} -> {code: {dp, type, values}} só com o que usamos."""
    out: dict[str, dict[str, Any]] = {}
    for dp, info in (mapping or {}).items():
        code = info.get("code")
        if code in USED_CODES and code not in out:
            out[code] = {"dp": str(dp), "type": info.get("type"), "values": _values(info.get("values"))}
    return out


def guess_mapping(dps: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if "20" in dps and "22" in dps:
        table = _GUESS_LIGHT_V2
    elif "1" in dps and "3" in dps and isinstance(dps.get("3"), int):
        table = _GUESS_LIGHT_V1
    else:
        table = _GUESS_PLUG
    return {code: {"dp": dp, "type": t, "values": v} for code, (dp, t, v) in table.items() if dp in dps}


def kind_for(category: str | None, mapping: dict[str, dict[str, Any]]) -> Kind:
    if category in LIGHT_CATEGORIES or "switch_led" in mapping:
        return "light"
    if "switch_2" in mapping:
        return "switch"
    if category in PLUG_CATEGORIES or "switch_1" in mapping or "switch" in mapping:
        return "plug"
    return "other"


class TuyaAdapter(Adapter):
    vendor = "tuya"
    label = "Tuya / Smart Life"
    description = "Lâmpadas, tomadas, fitas LED"
    account_fields = (
        AccountField("api_key", "API Key (Access ID)", secret=True),
        AccountField("api_secret", "API Secret", secret=True),
        AccountField("region", "Região", options=REGIONS),
    )
    account_required = True
    device_secrets = ("local_key",)

    def __init__(self, vault: Any) -> None:
        super().__init__(vault)
        self._cloud_cache: tuple[float, dict[str, dict[str, Any]]] | None = None

    # Conta --------------------------------------------------------------------

    async def validate_account(self, values: dict[str, str]) -> None:
        if values["region"] not in dict(REGIONS):
            raise AdapterError("regiao", "Escolha a região.")
        await asyncio.to_thread(self._fetch_cloud, values["api_key"], values["api_secret"], values["region"])

    @staticmethod
    def _fetch_cloud(key: str, secret: str, region: str) -> dict[str, dict[str, Any]]:
        try:
            cloud = tinytuya.Cloud(apiRegion=region, apiKey=key, apiSecret=secret)
        except Exception as exc:
            log.warning("Tuya Cloud falhou: %r", exc)
            raise AdapterError("tuya_rede", "Não consegui falar com a nuvem da Tuya. O PC está com internet?") from None
        if err := _cloud_error(cloud.error):
            raise err
        devices = cloud.getdevices(include_map=True)
        if err := _cloud_error(devices):
            raise err
        # Com o plano vencido o tinytuya devolve lista vazia; o motivo fica só na resposta crua.
        raw = getattr(cloud, "getdevices_raw", None)
        if isinstance(raw, dict) and raw.get("success") is False:
            if err := _cloud_error({"Error": raw.get("msg") or "falha"}):
                raise err
        if not isinstance(devices, list):
            raise AdapterError("tuya_recusou", "A Tuya não devolveu a lista de aparelhos.")
        return {d["id"]: d for d in devices if d.get("id")}

    async def _cloud(self) -> dict[str, dict[str, Any]]:
        if self._cloud_cache and time.monotonic() - self._cloud_cache[0] < 600:
            return self._cloud_cache[1]
        key, secret, region = (self.account_value(n) for n in ("api_key", "api_secret", "region"))
        if not (key and secret and region):
            raise AdapterError("sem_conta", f"Conecte a conta {self.label} antes de procurar.")
        devices = await asyncio.to_thread(self._fetch_cloud, key, secret, region)
        self._cloud_cache = (time.monotonic(), devices)
        return devices

    def clear_account(self) -> None:
        super().clear_account()
        self._cloud_cache = None

    # Descoberta ---------------------------------------------------------------

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        await BROADCASTS.start()
        self._cloud_cache = None
        cloud = await self._cloud()
        emitted: set[str] = set()

        def on_broadcast(dev_id: str, info: dict[str, Any]) -> None:
            if dev_id in emitted:
                return
            emitted.add(dev_id)
            dev = cloud.get(dev_id)
            if dev is None:
                found(Candidate(
                    key=dev_id, vendor=self.vendor, name="Aparelho Tuya", ip=info["ip"],
                    problem=f"Achado na rede, mas não está nesta conta {self.label}.",
                ))
                return
            found(self._candidate(dev, info["ip"], info["version"]))

        recent = time.monotonic() - 60
        for dev_id, info in list(BROADCASTS.seen.items()):
            if info["at"] >= recent:
                on_broadcast(dev_id, info)
        BROADCASTS.listeners.add(on_broadcast)
        try:
            # Aparelhos 3.5 só se anunciam quando o "app" pergunta.
            await asyncio.to_thread(_send_app_discovery)
            await asyncio.sleep(timeout)
        finally:
            BROADCASTS.listeners.discard(on_broadcast)

        for dev_id, dev in cloud.items():
            if dev_id in emitted:
                continue
            problem = (
                "Ligado por hub (Zigbee/Bluetooth): ainda não suportado."
                if dev.get("sub") else "Não respondeu na rede local. Ele está ligado e no mesmo Wi-Fi do PC?"
            )
            candidate = self._candidate(dev, None, None)
            candidate.problem = problem
            found(candidate)

    def _candidate(self, dev: dict[str, Any], ip: str | None, version: str | None) -> Candidate:
        mapping = compact_mapping(dev.get("mapping"))
        return Candidate(
            key=dev["id"], vendor=self.vendor, name=dev.get("name") or "Aparelho Tuya",
            model=dev.get("product_name") or dev.get("model"), ip=ip,
            kind=kind_for(dev.get("category"), mapping),
            config={"dev_id": dev["id"], "version": version or "3.3", "mapping": mapping,
                    "category": dev.get("category")},
            secrets={"local_key": dev["key"]} if dev.get("key") else {},
            problem=None if dev.get("key") else "A Tuya não mandou a chave local deste aparelho.",
        )

    async def manual_candidate(self, ip: str, device_id: str | None, secret: str | None) -> Candidate:
        if not device_id:
            raise AdapterError(
                "falta_id", "Informe o ID do aparelho (no app Smart Life: aparelho > editar > informações)."
            )
        cloud: dict[str, dict[str, Any]] = {}
        if self.account_configured():
            cloud = await self._cloud()
        dev = cloud.get(device_id)
        key = secret or (dev or {}).get("key")
        if not key:
            raise AdapterError("falta_chave", "Informe a local_key ou conecte a conta para buscar a chave.")
        heard = BROADCASTS.seen.get(device_id, {}).get("version")
        versions = [heard] + [v for v in VERSIONS if v != heard] if heard else list(VERSIONS)
        for version in versions:
            status = await asyncio.to_thread(_status, device_id, ip, key, version)
            if status is not None:
                mapping = compact_mapping((dev or {}).get("mapping")) or guess_mapping(status)
                return Candidate(
                    key=device_id, vendor=self.vendor, name=(dev or {}).get("name") or "Aparelho Tuya",
                    model=(dev or {}).get("product_name"), ip=ip,
                    kind=kind_for((dev or {}).get("category"), mapping),
                    config={"dev_id": device_id, "version": version, "mapping": mapping,
                            "category": (dev or {}).get("category")},
                    secrets={"local_key": key},
                )
        raise AdapterError(
            "sem_resposta",
            "O PC não conseguiu falar com o aparelho. Confira IP, ID e chave, "
            "e libere o integrador no Firewall do Windows.",
        )

    def driver(self, record: DeviceRecord) -> Driver:
        return TuyaDriver(record, self.vault)


class PositivoAdapter(TuyaAdapter):
    vendor = "positivo"
    label = "Positivo Casa Inteligente"
    description = "Lâmpadas, tomadas e sensores Positivo"


def _send_app_discovery() -> None:
    try:
        from tinytuya import scanner

        scanner.send_discovery_request()
    except Exception as exc:
        log.debug("pedido de descoberta 3.5 falhou: %r", exc)


def _device(dev_id: str, ip: str, key: str, version: str) -> tinytuya.Device:
    return tinytuya.Device(
        dev_id, address=ip, local_key=key, version=float(version),
        connection_timeout=3, connection_retry_limit=1, connection_retry_delay=0,
    )


def _status(dev_id: str, ip: str, key: str, version: str) -> dict[str, Any] | None:
    try:
        result = _device(dev_id, ip, key, version).status()
    except Exception:
        return None
    if not isinstance(result, dict) or "Error" in result or "dps" not in result:
        return None
    return result["dps"]


class TuyaDriver(Driver):
    poll_interval = 5.0

    def __init__(self, record: DeviceRecord, vault: Any) -> None:
        super().__init__(record, vault)
        cfg = record.config
        self._dev_id: str = cfg["dev_id"]
        self._version: str = str(cfg.get("version") or "3.3")
        self._map: dict[str, dict[str, Any]] = cfg.get("mapping") or {}
        self._dev: tinytuya.Device | None = None
        self._dps: dict[str, Any] = {}

    def _code(self, codes: tuple[str, ...]) -> str | None:
        return next((c for c in codes if c in self._map), None)

    def _gangs(self) -> list[str]:
        return [c for c in GANG_CODES if c in self._map]

    def capabilities(self) -> list[Capability]:
        if self.record.kind == "switch" and (gangs := self._gangs()):
            labels = self.record.config.get("labels") or {}
            return switch_caps([(c, labels.get(c) or f"Tecla {c.rsplit('_', 1)[1]}") for c in gangs])
        if self.record.kind == "light":
            return light_caps(
                brightness=self._code(BRIGHT_CODES) is not None,
                color_temp=self._code(TEMP_CODES) is not None,
                color=self._code(COLOUR_CODES) is not None,
            )
        return plug_caps(power_w="cur_power" in self._map)

    def _client(self) -> tinytuya.Device:
        ip = BROADCASTS.ip(self._dev_id) or self.record.config.get("ip")
        if not ip:
            raise DeviceUnreachable("sem IP")
        if self._dev is None:
            key = self.secret("local_key")
            if not key:
                raise DeviceUnreachable("sem local_key no cofre")
            self._dev = _device(self._dev_id, ip, key, self._version)
        elif self._dev.address != ip:
            self._dev.address = ip
        return self._dev

    def _call(self, fn: Callable[[tinytuya.Device], Any]) -> dict[str, Any]:
        result = fn(self._client())
        if not isinstance(result, dict) or "Error" in result:
            raise DeviceUnreachable(str(result))
        return result

    async def refresh(self) -> dict[str, Any]:
        await BROADCASTS.start()
        result = await asyncio.to_thread(self._call, lambda d: d.status())
        self._dps.update(result.get("dps") or {})
        return self._read()

    def _get(self, code: str | None) -> Any:
        if code is None or code not in self._map:
            return None
        return self._dps.get(self._map[code]["dp"])

    def _range(self, code: str) -> tuple[int, int]:
        values = self._map[code].get("values") or {}
        default_max = 1000 if code.endswith("_v2") else 255
        return int(values.get("min", 0)), int(values.get("max", default_max))

    def _to_pct(self, code: str, raw: int, low: int) -> int:
        lo, hi = self._range(code)
        lo = max(lo, 0)
        return max(low, min(100, round((raw - lo) / max(1, hi - lo) * 100)))

    def _from_pct(self, code: str, pct: float) -> int:
        lo, hi = self._range(code)
        return round(lo + (hi - lo) * pct / 100)

    def _read(self) -> dict[str, Any]:
        state: dict[str, Any] = {}
        power = self._get(self._code(POWER_CODES))
        if power is not None:
            state["power"] = bool(power)
        if self.record.kind == "switch" and (gangs := self._gangs()):
            keys = {c: bool(v) for c in gangs if (v := self._get(c)) is not None}
            state.update(keys)
            if keys:
                state["power"] = any(keys.values())
        bright_code = self._code(BRIGHT_CODES)
        if (raw := self._get(bright_code)) is not None and bright_code:
            state["brightness"] = self._to_pct(bright_code, int(raw), 1)
        temp_code = self._code(TEMP_CODES)
        if (raw := self._get(temp_code)) is not None and temp_code:
            state["color_temp"] = self._to_pct(temp_code, int(raw), 0)
        colour_code = self._code(COLOUR_CODES)
        if (raw := self._get(colour_code)) and colour_code:
            if rgb := _parse_colour(str(raw)):
                state["color"] = rgb
        if (raw := self._get("cur_power")) is not None:
            scale = int((self._map["cur_power"].get("values") or {}).get("scale", 1))
            state["power_w"] = round(float(raw) / 10**scale, 1)
        return state

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        dps: dict[str, Any] = {}
        gangs = self._gangs() if self.record.kind == "switch" else []
        if capability == "power" and gangs:
            dps.update({self._map[c]["dp"]: bool(value) for c in gangs})
        elif capability in gangs:
            dps[self._map[capability]["dp"]] = bool(value)
        elif capability == "power":
            code = self._code(POWER_CODES)
            assert code
            dps[self._map[code]["dp"]] = bool(value)
        elif capability == "brightness":
            colour = self._code(COLOUR_CODES)
            if colour and self._get("work_mode") == "colour" and (rgb := _parse_colour(str(self._get(colour) or ""))):
                dps[self._map[colour]["dp"]] = _format_colour(colour, rgb, value)
            else:
                code = self._code(BRIGHT_CODES)
                assert code
                dps[self._map[code]["dp"]] = self._from_pct(code, value)
                if "work_mode" in self._map:
                    dps[self._map["work_mode"]["dp"]] = "white"
        elif capability == "color_temp":
            code = self._code(TEMP_CODES)
            assert code
            dps[self._map[code]["dp"]] = self._from_pct(code, value)
            if "work_mode" in self._map:
                dps[self._map["work_mode"]["dp"]] = "white"
        elif capability == "color":
            code = self._code(COLOUR_CODES)
            assert code
            dps[self._map[code]["dp"]] = _format_colour(code, value, None)
            if "work_mode" in self._map:
                dps[self._map["work_mode"]["dp"]] = "colour"
        else:
            raise AdapterError("nao_suportado", "Este aparelho não aceita esse comando.")
        # Mexer no brilho/cor de uma luz desligada liga ela (arrastar no card a partir de desligado).
        if capability != "power" and not gangs and (power := self._code(POWER_CODES)):
            dps[self._map[power]["dp"]] = True
        await asyncio.to_thread(self._call, lambda d: d.set_multiple_values(dps))
        self._dps.update(dps)
        return self._read()

    async def close(self) -> None:
        dev, self._dev = self._dev, None
        if dev is not None:
            await asyncio.to_thread(dev.close)


def _parse_colour(raw: str) -> str | None:
    """'hhhhssssvvvv' (v2) ou 'rrggbb0hhhssvv' (v1) -> '#rrggbb'."""
    try:
        if len(raw) == 12:
            h, s = int(raw[0:4], 16), int(raw[4:8], 16)
            r, g, b = colorsys.hsv_to_rgb(h / 360, s / 1000, 1.0)
        elif len(raw) == 14:
            return "#" + raw[0:6].lower()
        else:
            return None
    except ValueError:
        return None
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"


def _format_colour(code: str, rgb: str, brightness_pct: float | None) -> str:
    r, g, b = (int(rgb[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if brightness_pct is not None:
        v = brightness_pct / 100
    v = max(v, 0.01)
    if code == "colour_data_v2":
        return f"{round(h * 360):04x}{round(s * 1000):04x}{round(v * 1000):04x}"
    rr, gg, bb = (round(x * 255) for x in colorsys.hsv_to_rgb(h, s, v))
    return f"{rr:02x}{gg:02x}{bb:02x}{round(h * 360):04x}{round(s * 255):02x}{round(v * 255):02x}"
