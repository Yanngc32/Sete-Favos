"""Xiaomi (robô aspirador) pela LAN via miIO/MIoT com python-miio.

- Token: buscado UMA vez na nuvem Xiaomi com a conta Mi (a senha não é guardada).
  Se a Xiaomi pedir verificação em 2 etapas, devolvemos o link para a pessoa
  confirmar e tentar de novo.
- Os ids MIoT (siid/piid/aiid) vêm da spec pública do modelo (miot-spec.org),
  lida no cadastro e guardada no config do aparelho.
- O "pareamento" valida se o modelo responde pela rede local. Se não responder,
  o cadastro é bloqueado com a explicação (o H50 Pro ainda não está confirmado).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import threading
import time
from typing import Any

import httpx
from micloud import MiCloud
from micloud.micloudexception import MiCloudAccessDenied, MiCloudException
from miio import Device as MiioDevice
from miio.exceptions import DeviceException

from casa.adapters.base import AccountField, Adapter, AdapterError, Candidate, DeviceUnreachable, Driver, Found
from casa.adapters.caps import vacuum_caps
from casa.model import Capability, DeviceRecord

log = logging.getLogger(__name__)

SERVERS = ("cn", "de", "us", "ru", "tw", "sg", "in", "i2")
SERVER_OPTIONS = (
    ("auto", "Procurar em todas"), ("us", "Américas"), ("de", "Europa"), ("sg", "Sudeste Asiático"),
    ("cn", "China"), ("in", "Índia"), ("ru", "Rússia"), ("tw", "Taiwan"),
)
SPEC_BASE = "https://miot-spec.org/miot-spec-v2"
FAN_PROPS = ("mode", "suction-level", "fan-level", "cleaning-mode")
NOT_LOCAL = (
    "Este modelo não respondeu pela rede local. Ele pode depender da nuvem da Xiaomi, "
    "e aí os problemas do app podem continuar."
)

_FAULTS_PT = (
    ("brush", "Escova presa"), ("wheel", "Roda presa"), ("dust", "Reservatório de pó fora do lugar"),
    ("bin", "Reservatório de pó fora do lugar"), ("cliff", "Sensor de queda sujo ou bloqueado"),
    ("laser", "Sensor laser com problema"), ("lds", "Sensor laser com problema"),
    ("battery", "Problema na bateria"), ("stuck", "Robô preso"), ("trapped", "Robô preso"),
    ("water", "Tanque de água fora do lugar"), ("filter", "Filtro bloqueado"), ("bumper", "Para-choque preso"),
)
_FAN_PT = (
    (("silent", "quiet"), "Silenciosa"), (("standard", "normal", "balanced"), "Padrão"),
    (("strong", "turbo"), "Forte"), (("max", "full"), "Máx"),
)


CAPTCHA_TTL = 300.0


class _Cloud(MiCloud):
    """MiCloud que reconhece verificação em 2 etapas e captcha da Xiaomi."""

    notification_url: str | None = None
    captcha_url: str | None = None
    captcha_code: str | None = None

    def _login_step2(self, sign: str) -> str:
        post = {
            # MD5 é exigência do protocolo de login da Xiaomi, não escolha nossa.
            "sid": "xiaomiio", "hash": hashlib.md5(self.password.encode()).hexdigest().upper(),  # noqa: S324
            "callback": "https://sts.api.io.mi.com/sts", "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
            "user": self.username, "_json": "true",
        }
        if sign:
            post["_sign"] = sign
        if self.captcha_code:
            post["captCode"] = self.captcha_code
        resp = self.session.post("https://account.xiaomi.com/pass/serviceLoginAuth2", data=post)
        data = json.loads(resp.text.replace("&&&START&&&", ""))
        if data.get("notificationUrl"):
            self.notification_url = data["notificationUrl"]
            raise MiCloudException("verificação em 2 etapas")
        if data.get("captchaUrl"):
            self.captcha_url = data["captchaUrl"]
            raise MiCloudException("captcha")
        if data.get("result") != "ok" or not data.get("location"):
            raise MiCloudAccessDenied("credenciais")
        self.user_id = data["userId"]
        self.ssecurity = data["ssecurity"]
        self.cuser_id = data.get("cUserId")
        self.pass_token = data.get("passToken")
        return data["location"]


# Login que parou no captcha: a resposta tem que sair da MESMA sessão (cookie da imagem).
_pending: dict[str, tuple[float, _Cloud]] = {}
_pending_lock = threading.Lock()


def _take_pending(username: str) -> _Cloud | None:
    with _pending_lock:
        now = time.monotonic()
        for user in [u for u, (at, _) in _pending.items() if now - at > CAPTCHA_TTL]:
            _pending.pop(user)
        entry = _pending.pop(username.casefold(), None)
    return entry[1] if entry else None


def _captcha_image(cloud: _Cloud) -> str:
    url = cloud.captcha_url or ""
    if not url.startswith("http"):
        url = "https://account.xiaomi.com" + url
    resp = cloud.session.get(url, timeout=10)
    kind = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    return f"data:{kind};base64,{base64.b64encode(resp.content).decode()}"


def _cloud_devices(username: str, password: str, server: str, captcha: str = "") -> list[dict[str, Any]]:
    # Qualquer tentativa nova encerra o login pendente; o código só vale para a sessão da imagem.
    pending = _take_pending(username)
    cloud = pending if pending is not None and captcha else _Cloud(username, password)
    cloud.password = password
    cloud.captcha_code = (captcha or None) if cloud is pending else None
    cloud.captcha_url = None
    try:
        cloud._login_request()
    except Exception:
        if cloud.notification_url:
            raise AdapterError(
                "verificacao",
                "A Xiaomi pediu verificação em 2 etapas. Abra o link, confirme e depois toque em \"Já confirmei\".",
                {"url": cloud.notification_url},
            ) from None
        if cloud.captcha_url:
            try:
                image = _captcha_image(cloud)
            except Exception as img_exc:
                log.warning("imagem do captcha Xiaomi falhou: %r", img_exc)
                raise AdapterError(
                    "captcha", "A Xiaomi pediu captcha e não consegui baixar a imagem. Tente de novo mais tarde."
                ) from None
            with _pending_lock:
                _pending[username.casefold()] = (time.monotonic(), cloud)
            raise AdapterError(
                "captcha",
                "Código incorreto. Digite o da nova imagem." if captcha
                else "Digite os caracteres da imagem e toque em Continuar.",
                {"image": image},
            ) from None
        raise AdapterError("xiaomi_recusou", "A Xiaomi recusou o login. Confira o e-mail/telefone e a senha.") from None
    devices: dict[str, dict[str, Any]] = {}
    for srv in SERVERS if server == "auto" else (server,):
        try:
            for d in cloud.get_devices(country=srv) or []:
                devices.setdefault(str(d.get("did")), d)
        except Exception as exc:
            log.debug("servidor Xiaomi %s falhou: %r", srv, exc)
    return list(devices.values())


class XiaomiAdapter(Adapter):
    vendor = "xiaomi"
    label = "Xiaomi"
    description = "Robô aspirador"
    transient_fields = (
        AccountField("username", "E-mail ou telefone da conta Mi",
                     help="Usamos uma vez pra buscar o token; a senha não fica salva."),
        AccountField("password", "Senha", secret=True),
        AccountField("server", "Região da conta", options=SERVER_OPTIONS, required=False),
        AccountField("captcha", "Código da imagem", required=False, hidden=True),
    )
    transient_required = True
    device_secrets = ("token",)

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        devices = await asyncio.to_thread(
            _cloud_devices, credentials["username"], credentials["password"],
            credentials.get("server") or "auto", credentials.get("captcha") or "",
        )
        for d in devices:
            token, ip, model = d.get("token"), d.get("localip"), d.get("model") or ""
            if not token or len(token) != 32:
                continue  # sub-aparelhos BLE/Zigbee não têm token próprio
            is_vacuum = ".vacuum." in model
            found(Candidate(
                key=str(d["did"]), vendor=self.vendor, name=d.get("name") or model, model=model, ip=ip,
                kind="vacuum" if is_vacuum else "other", needs_pairing=is_vacuum,
                config={"did": str(d["did"]), "model": model},
                secrets={"token": token},
                problem=None if is_vacuum else "Só o robô aspirador Xiaomi é suportado por enquanto.",
            ))

    async def manual_candidate(self, ip: str, device_id: str | None, secret: str | None) -> Candidate:
        if not secret or not re.fullmatch(r"[0-9a-fA-F]{32}", secret):
            raise AdapterError("falta_token", "Informe o token do aparelho (32 caracteres).")
        try:
            info = await asyncio.to_thread(lambda: MiioDevice(ip, secret, timeout=4).info())
        except Exception:
            raise AdapterError("xiaomi_sem_local", NOT_LOCAL) from None
        model = info.model or ""
        return Candidate(
            key=str(info.raw.get("did") or ip), vendor=self.vendor, name="Robô Xiaomi", model=model, ip=ip,
            kind="vacuum" if ".vacuum." in model else "other", needs_pairing=True,
            config={"did": str(info.raw.get("did") or ""), "model": model}, secrets={"token": secret.lower()},
        )

    async def pair(self, candidate: Candidate) -> Candidate:
        """Valida o controle local e monta o mapa MIoT do modelo."""
        if not candidate.ip:
            raise AdapterError("xiaomi_sem_ip", "A Xiaomi não informou o IP local deste aparelho.")
        mapping = await _vacuum_mapping(candidate.model or "")
        driver_probe = _Miot(candidate.ip, candidate.secrets["token"])
        status = mapping["props"]["status"]
        try:
            result = await asyncio.to_thread(driver_probe.get, [status])
        except Exception:
            raise AdapterError("xiaomi_sem_local", NOT_LOCAL) from None
        if not result or result[0].get("code", 0) != 0:
            raise AdapterError("xiaomi_sem_local", NOT_LOCAL)
        candidate.config["miot"] = mapping
        return candidate

    def driver(self, record: DeviceRecord) -> Driver:
        return XiaomiDriver(record, self.vault)


# Spec MIoT --------------------------------------------------------------------


def _name(urn: str) -> str:
    """'urn:miot-spec-v2:property:battery-level:00000014:...' -> 'battery-level'."""
    parts = urn.split(":")
    return parts[3] if len(parts) > 3 else ""


async def _vacuum_mapping(model: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            instances = (await http.get(f"{SPEC_BASE}/instances", params={"status": "all"})).json()["instances"]
            matches = [i for i in instances if i.get("model") == model]
            if not matches:
                raise AdapterError(
                    "xiaomi_sem_spec", f"Não achei a especificação MIoT do modelo {model}. {NOT_LOCAL}"
                )
            best = max(matches, key=lambda i: (i.get("status") == "released", i.get("version", 0)))
            spec = (await http.get(f"{SPEC_BASE}/instance", params={"type": best["type"]})).json()
    except AdapterError:
        raise
    except Exception:
        raise AdapterError(
            "xiaomi_spec_rede", "Não consegui baixar a especificação do robô. O PC está com internet?"
        ) from None
    return build_vacuum_mapping(spec)


def build_vacuum_mapping(spec: dict[str, Any]) -> dict[str, Any]:
    props: dict[str, dict[str, Any]] = {}
    actions: dict[str, dict[str, int]] = {}
    for service in spec.get("services", []):
        sname = _name(service.get("type", ""))
        siid = service["iid"]
        for prop in service.get("properties", []):
            pname = _name(prop.get("type", ""))
            entry = {"siid": siid, "piid": prop["iid"], "values": [
                {"value": v["value"], "description": v.get("description", "")} for v in prop.get("value-list", [])
            ]}
            if sname == "vacuum" and pname == "status":
                props.setdefault("status", entry)
            elif sname == "vacuum" and pname == "fault":
                props.setdefault("fault", entry)
            elif pname == "battery-level":
                props.setdefault("battery", entry)
            elif sname == "vacuum" and pname in FAN_PROPS and entry["values"]:
                props.setdefault("fan", entry)
        for action in service.get("actions", []):
            aname = _name(action.get("type", ""))
            key = {"start-sweep": "start", "pause-sweeping": "pause", "stop-sweeping": "stop",
                   "start-charge": "dock", "identify": "locate"}.get(aname)
            if key and key not in actions:
                actions[key] = {"siid": siid, "aiid": action["iid"]}
    if "status" not in props or "start" not in actions:
        raise AdapterError("xiaomi_sem_vacuum", f"A especificação deste modelo não tem controle de robô. {NOT_LOCAL}")
    return {"props": props, "actions": actions}


def status_from(description: str) -> str:
    d = description.lower()
    if "error" in d or "fault" in d:
        return "error"
    if "go charg" in d or "return" in d or "back" in d:
        return "returning"
    if "pause" in d:
        return "paused"
    if any(w in d for w in ("sweep", "clean", "mop", "working", "busy")):
        return "cleaning"
    if "charg" in d or "dock" in d:
        return "docked"
    return "idle"


def fault_pt(description: str) -> str | None:
    d = description.lower()
    if not d or "no " in d or d in ("none", "normal"):
        return None
    for word, text in _FAULTS_PT:
        if word in d:
            return text
    return description


def fan_label(description: str) -> str:
    d = description.lower()
    for words, label in _FAN_PT:
        if any(w in d for w in words):
            return label
    return description


# Driver -----------------------------------------------------------------------


class _Miot:
    def __init__(self, ip: str, token: str) -> None:
        self.dev = MiioDevice(ip, token, timeout=4)

    def get(self, props: list[dict[str, Any]]) -> list[dict[str, Any]]:
        params = [{"did": f"{p['siid']}-{p['piid']}", "siid": p["siid"], "piid": p["piid"]} for p in props]
        return self.dev.send("get_properties", params)

    def set(self, prop: dict[str, Any], value: Any) -> Any:
        params = [{"did": "set", "siid": prop["siid"], "piid": prop["piid"], "value": value}]
        return self.dev.send("set_properties", params)

    def action(self, action: dict[str, int]) -> Any:
        return self.dev.send("action", {"did": "call", "siid": action["siid"], "aiid": action["aiid"], "in": []})


class XiaomiDriver(Driver):
    poll_interval = 10.0

    def __init__(self, record: DeviceRecord, vault: Any) -> None:
        super().__init__(record, vault)
        self._map: dict[str, Any] = record.config.get("miot") or {"props": {}, "actions": {}}
        self._miot: _Miot | None = None

    def _client(self) -> _Miot:
        if self._miot is None:
            token = self.secret("token")
            if not token:
                raise DeviceUnreachable("sem token no cofre")
            self._miot = _Miot(self.record.config["ip"], token)
        return self._miot

    def capabilities(self) -> list[Capability]:
        fan = self._map["props"].get("fan")
        options = [(str(v["value"]), fan_label(v["description"])) for v in fan["values"]] if fan else []
        caps = vacuum_caps(options)
        actions = self._map["actions"]
        allowed = {"start", "dock", "locate"} & set(actions)
        if {"pause", "stop"} & set(actions):
            allowed.add("pause")
        return [c for c in caps if c.type != "action" or c.id in allowed]

    async def refresh(self) -> dict[str, Any]:
        props = self._map["props"]
        wanted = [(k, props[k]) for k in ("status", "fault", "battery", "fan") if k in props]
        try:
            result = await asyncio.to_thread(self._client().get, [p for _, p in wanted])
        except DeviceException as exc:
            raise DeviceUnreachable(repr(exc)) from exc
        values = {k: r.get("value") for (k, _), r in zip(wanted, result, strict=False) if r.get("code", 0) == 0}
        state: dict[str, Any] = {}
        if "status" in values:
            state["vacuum_status"] = status_from(_describe(props["status"], values["status"]))
        if "fault" in values:
            state["vacuum_error"] = fault_pt(_describe(props["fault"], values["fault"]))
            if state["vacuum_error"]:
                state["vacuum_status"] = "error"
        if "battery" in values:
            state["battery"] = int(values["battery"])
        if "fan" in values:
            state["fan_power"] = str(values["fan"])
        return state

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        actions = self._map["actions"]
        client = self._client()
        try:
            if capability == "fan_power":
                await asyncio.to_thread(client.set, self._map["props"]["fan"], int(value))
                return {"fan_power": value}
            name = "stop" if capability == "pause" and "pause" not in actions else capability
            if name not in actions:
                raise AdapterError("nao_suportado", "O robô não aceita esse comando.")
            await asyncio.to_thread(client.action, actions[name])
        except DeviceException as exc:
            raise DeviceUnreachable(repr(exc)) from exc
        status = {"start": "cleaning", "pause": "paused", "dock": "returning"}.get(capability)
        return {"vacuum_status": status} if status else {}


def _describe(prop: dict[str, Any], value: Any) -> str:
    return next((v["description"] for v in prop.get("values", []) if v["value"] == value), str(value))
