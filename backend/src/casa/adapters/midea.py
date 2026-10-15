"""Ar-condicionado Midea pela LAN com msmart-ng.

Aparelhos "V3" precisam de token/key pegos UMA vez na nuvem Midea, durante a
descoberta. Sem e-mail/senha, o msmart-ng usa a conta padrão dele; com e-mail
e senha, eles servem só para essa busca e não são guardados.
"""

from __future__ import annotations

import logging
from typing import Any

from msmart.cloud import CloudError
from msmart.const import DeviceType
from msmart.device import AirConditioner
from msmart.discover import Discover

from casa.adapters.base import AccountField, Adapter, AdapterError, Candidate, DeviceUnreachable, Driver, Found
from casa.adapters.caps import ac_caps
from casa.model import Capability, DeviceRecord

log = logging.getLogger(__name__)

Mode = AirConditioner.OperationalMode
Fan = AirConditioner.FanSpeed

MODES: dict[Any, str] = {Mode.COOL: "cool", Mode.HEAT: "heat", Mode.FAN_ONLY: "fan", Mode.DRY: "dry", Mode.AUTO: "auto"}
FANS: dict[Any, str] = {
    Fan.AUTO: "auto", Fan.SILENT: "silent", Fan.LOW: "low", Fan.MEDIUM: "medium", Fan.HIGH: "high", Fan.MAX: "max",
}
TEMP_STEP = 1.0


class MideaAdapter(Adapter):
    vendor = "midea"
    label = "Midea"
    description = "Ar-condicionado"
    transient_fields = (
        AccountField("account", "E-mail da conta Midea", required=False,
                     help="Usamos só uma vez; a senha não fica salva."),
        AccountField("password", "Senha", secret=True, required=False),
    )
    device_secrets = ("token", "key")

    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        devices = await self._discover(timeout=min(timeout, 8), **_creds(credentials))
        for dev in devices:
            found(self._candidate(dev))

    async def manual_candidate(self, ip: str, device_id: str | None, secret: str | None) -> Candidate:
        devices = await self._discover(target=ip, timeout=5)
        if not devices:
            raise AdapterError("sem_resposta", "Nenhum ar Midea respondeu nesse IP.")
        return self._candidate(devices[0])

    @staticmethod
    async def _discover(**kwargs: Any) -> list[Any]:
        try:
            return await Discover.discover(**kwargs)
        except CloudError as exc:
            log.warning("nuvem Midea falhou: %s", exc)
            raise AdapterError(
                "midea_nuvem",
                "Não consegui pegar a chave do ar na nuvem da Midea. Tente com o e-mail e a senha do app.",
            ) from None

    def _candidate(self, dev: Any) -> Candidate:
        candidate = Candidate(
            key=str(dev.id), vendor=self.vendor, name=dev.name or "Ar-condicionado Midea",
            model=dev.sn, ip=dev.ip, kind="ac" if dev.type == DeviceType.AIR_CONDITIONER else "other",
            config={"device_id": dev.id, "port": dev.port, "version": dev.version},
            secrets={"token": dev.token, "key": dev.key} if dev.token and dev.key else {},
        )
        if dev.type != DeviceType.AIR_CONDITIONER:
            candidate.problem = "Só o ar-condicionado Midea é suportado por enquanto."
        elif dev.version == 3 and not candidate.secrets:
            candidate.problem = "Não consegui autenticar com a nuvem Midea. Tente com o e-mail e a senha do app."
        return candidate

    def driver(self, record: DeviceRecord) -> Driver:
        return MideaDriver(record, self.vault)


def _creds(credentials: dict[str, str]) -> dict[str, Any]:
    account, password = credentials.get("account"), credentials.get("password")
    if bool(account) != bool(password):
        raise AdapterError("campos_faltando", "Preencha o e-mail e a senha, ou deixe os dois vazios.")
    return {"account": account, "password": password} if account else {}


class MideaDriver(Driver):
    poll_interval = 15.0

    def __init__(self, record: DeviceRecord, vault: Any) -> None:
        super().__init__(record, vault)
        self._dev: AirConditioner | None = None
        self._caps_loaded = False

    async def _client(self) -> AirConditioner:
        if self._dev is None:
            cfg = self.record.config
            dev = AirConditioner(
                ip=cfg["ip"], device_id=int(cfg["device_id"]), port=int(cfg.get("port") or 6444),
                version=cfg.get("version"),
            )
            if int(cfg.get("version") or 3) == 3:
                token, key = self.secret("token"), self.secret("key")
                if not (token and key):
                    raise DeviceUnreachable("sem token/key no cofre")
                await dev.authenticate(token, key)
            self._dev = dev
        if not self._caps_loaded:
            await self._dev.get_capabilities()
            self._caps_loaded = True
        return self._dev

    def capabilities(self) -> list[Capability]:
        dev = self._dev
        if dev is None or not self._caps_loaded:
            return ac_caps(16, 30, TEMP_STEP, MODES.values(), ["auto", "low", "medium", "high"])
        modes = [MODES[m] for m in dev.supported_operation_modes if m in MODES]
        fans = [FANS[f] for f in dev.supported_fan_speeds if f in FANS]
        return ac_caps(dev.min_target_temperature, dev.max_target_temperature, TEMP_STEP, modes, fans)

    async def refresh(self) -> dict[str, Any]:
        try:
            dev = await self._client()
            await dev.refresh()
        except DeviceUnreachable:
            self._dev = None
            raise
        except Exception as exc:
            self._dev = None
            raise DeviceUnreachable(repr(exc)) from exc
        if not dev.online:
            self._dev = None
            raise DeviceUnreachable("sem resposta")
        return self._read(dev)

    @staticmethod
    def _read(dev: AirConditioner) -> dict[str, Any]:
        state: dict[str, Any] = {"power": bool(dev.power_state)}
        if dev.target_temperature is not None:
            state["target_temp"] = float(dev.target_temperature)
        if dev.indoor_temperature is not None:
            state["current_temp"] = float(dev.indoor_temperature)
        if dev.operational_mode in MODES:
            state["ac_mode"] = MODES[dev.operational_mode]
        if dev.fan_speed in FANS:
            state["fan_speed"] = FANS[dev.fan_speed]
        return state

    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        dev = await self._client()
        if capability == "power":
            dev.power_state = bool(value)
        elif capability == "target_temp":
            dev.target_temperature = float(value)
            dev.power_state = True  # arrastar a temperatura no card a partir de desligado liga o ar
        elif capability == "ac_mode":
            dev.operational_mode = next(m for m, v in MODES.items() if v == value)
        elif capability == "fan_speed":
            dev.fan_speed = next(f for f, v in FANS.items() if v == value)
        else:
            raise AdapterError("nao_suportado", "O ar não aceita esse comando.")
        try:
            await dev.apply()
        except Exception as exc:
            self._dev = None
            raise DeviceUnreachable(repr(exc)) from exc
        return self._read(dev)
