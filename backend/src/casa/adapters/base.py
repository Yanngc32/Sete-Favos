"""Contrato dos adaptadores de fabricante.

Cada adaptador sabe: validar e guardar a conta/credencial, descobrir aparelhos
na rede, montar um aparelho a partir do IP, parear (quando o fabricante exige)
e criar o driver que controla e informa as capacidades de um aparelho.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, ClassVar

from pydantic import BaseModel, Field

from casa.model import Capability, DeviceRecord, Kind
from casa.vault import Vault


class AdapterError(Exception):
    """Erro com mensagem pronta para mostrar ao usuário (pt-BR)."""

    def __init__(self, code: str, message: str, data: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data or {}


class DeviceUnreachable(Exception):
    """O aparelho não respondeu pela rede local."""


@dataclass(frozen=True)
class AccountField:
    name: str
    label: str
    secret: bool = False
    required: bool = True
    options: tuple[tuple[str, str], ...] | None = None  # (valor, rótulo)
    help: str | None = None
    # Só aparece quando o fabricante pede (ex.: captcha da Xiaomi).
    hidden: bool = False


class Candidate(BaseModel):
    """Aparelho achado na descoberta (ou montado pelo IP), ainda não cadastrado."""

    key: str  # id estável no fabricante (dev_id, device id, MAC...)
    vendor: str
    name: str
    model: str | None = None
    ip: str | None = None
    kind: Kind = "other"
    needs_pairing: bool = False
    already_added: bool = False
    # Achado, mas não dá para cadastrar (ex.: fora da conta, sem chave).
    problem: str | None = None
    # Só no servidor: vai para DeviceRecord.config / cofre ao cadastrar.
    config: dict[str, Any] = Field(default_factory=dict, exclude=True)
    secrets: dict[str, str] = Field(default_factory=dict, exclude=True)


Found = Callable[[Candidate], None]


class Adapter(ABC):
    vendor: ClassVar[str]
    label: ClassVar[str]
    description: ClassVar[str]
    # Conta guardada no cofre (ex.: API key da Tuya).
    account_fields: ClassVar[tuple[AccountField, ...]] = ()
    # Se True, descobrir/adicionar exige conta configurada antes.
    account_required: ClassVar[bool] = False
    # Pedidos só na hora de procurar e descartados depois (ex.: senha Xiaomi).
    transient_fields: ClassVar[tuple[AccountField, ...]] = ()
    # False = não aparece em "Adicionar aparelho" (ex.: celular, criado pelo próprio app).
    listed: ClassVar[bool] = True
    transient_required: ClassVar[bool] = False
    # Segredos por aparelho guardados no cofre (para apagar ao remover).
    device_secrets: ClassVar[tuple[str, ...]] = ()

    def __init__(self, vault: Vault) -> None:
        self.vault = vault

    # Conta / credencial do fabricante ---------------------------------------

    def _account_key(self, name: str) -> str:
        return f"{self.vendor}:account:{name}"

    def account_value(self, name: str) -> str | None:
        return self.vault.get(self._account_key(name))

    def account_configured(self) -> bool:
        if not self.account_fields:
            return False
        return all(self.vault.has(self._account_key(f.name)) for f in self.account_fields if f.required)

    async def save_account(self, values: dict[str, str]) -> None:
        clean = {f.name: (values.get(f.name) or "").strip() for f in self.account_fields}
        missing = [f.label for f in self.account_fields if f.required and not clean[f.name]]
        if missing:
            raise AdapterError("campos_faltando", "Preencha: " + ", ".join(missing) + ".")
        await self.validate_account(clean)
        for f in self.account_fields:
            if clean[f.name]:
                self.vault.set(self._account_key(f.name), clean[f.name])
            else:
                self.vault.delete(self._account_key(f.name))

    async def validate_account(self, values: dict[str, str]) -> None:
        """Testa a credencial. Lança AdapterError com a mensagem certa se falhar."""

    def clear_account(self) -> None:
        for f in self.account_fields:
            self.vault.delete(self._account_key(f.name))

    # Descoberta e cadastro ----------------------------------------------------

    @abstractmethod
    async def discover(self, found: Found, timeout: float, credentials: dict[str, str]) -> None:
        """Procura aparelhos na LAN e chama `found` para cada um, à medida que aparecem.

        `credentials` traz os transient_fields; não guarde nada deles.
        """

    async def manual_candidate(self, ip: str, device_id: str | None, secret: str | None) -> Candidate:
        raise AdapterError("nao_suportado", "Este fabricante não aceita cadastro só pelo IP.")

    async def pair(self, candidate: Candidate) -> Candidate:
        """Passo extra antes de cadastrar (ex.: aceitar na TV). Padrão: nada."""
        return candidate

    @abstractmethod
    def driver(self, record: DeviceRecord) -> Driver: ...


class Driver(ABC):
    """Controla um aparelho cadastrado."""

    # Segundos entre leituras de estado. Drivers com push também usam isso para
    # reconectar e conferir.
    poll_interval: ClassVar[float] = 10.0

    def __init__(self, record: DeviceRecord, vault: Vault) -> None:
        self.record = record
        self.vault = vault
        self._push: Callable[[dict[str, Any]], None] | None = None

    def secret(self, name: str) -> str | None:
        return self.vault.get(device_secret_key(self.record.id, name))

    def on_push(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self._push = callback

    def push(self, state: dict[str, Any]) -> None:
        if self._push is not None:
            self._push(state)

    @abstractmethod
    def capabilities(self) -> list[Capability]: ...

    def notes(self) -> list[str]:
        return []

    @abstractmethod
    async def refresh(self) -> dict[str, Any]:
        """Lê o estado atual. Lança DeviceUnreachable se não responder."""

    @abstractmethod
    async def command(self, capability: str, value: Any) -> dict[str, Any]:
        """Executa e devolve o pedaço do estado que mudou."""

    # Teclas do controle remoto que este aparelho aceita (vazio = sem controle).
    def remote_keys(self) -> tuple[str, ...]:
        return ()

    async def remote(self, key: str) -> None:
        raise AdapterError("nao_suportado", "Este aparelho não tem controle remoto.")

    async def test(self) -> None:
        """Mostra qual aparelho é: liga e desliga, ou bipa o robô."""
        caps = {c.id for c in self.capabilities()}
        if "locate" in caps:
            await self.command("locate", None)
            return
        if "power" in caps:
            await self.command("power", True)
            await asyncio.sleep(1.5)
            await self.command("power", False)
            return
        await self.refresh()

    async def close(self) -> None:
        pass


def device_secret_key(device_id: str, name: str) -> str:
    return f"device:{device_id}:{name}"
