"""Cofre de segredos: chaves de API, local_keys, tokens e client_keys.

Usa o keyring, que no Windows grava no Gerenciador de Credenciais (protegido
pelo DPAPI da conta que roda o backend). Nunca grava em texto puro e nunca
devolve segredo pela API.
"""

from __future__ import annotations

import keyring
from keyring.backend import KeyringBackend

SERVICE = "casa-integrador"

# Backends que guardam em texto puro ou não guardam nada: recusados.
_REFUSED_MODULES = ("keyring.backends.fail", "keyring.backends.null", "keyrings.alt")


class VaultError(RuntimeError):
    pass


class Vault:
    def __init__(self, backend: KeyringBackend | None = None) -> None:
        self._kr = backend or keyring.get_keyring()
        module = type(self._kr).__module__
        if module.startswith(_REFUSED_MODULES):
            raise VaultError(
                f"Cofre indisponível ({module}). No Windows o backend esperado é o "
                "Gerenciador de Credenciais."
            )

    @property
    def backend_name(self) -> str:
        return f"{type(self._kr).__module__}.{type(self._kr).__name__}"

    def get(self, key: str) -> str | None:
        return self._kr.get_password(SERVICE, key)

    def has(self, key: str) -> bool:
        return self.get(key) is not None

    def set(self, key: str, value: str) -> None:
        if not value:
            raise VaultError(f"segredo vazio: {key}")
        self._kr.set_password(SERVICE, key, value)

    def delete(self, key: str) -> None:
        try:
            self._kr.delete_password(SERVICE, key)
        except keyring.errors.PasswordDeleteError:
            pass


class MemoryKeyring(KeyringBackend):
    """Só para testes e modo simulado."""

    priority = 0  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self._data: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._data.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._data[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self._data.pop((service, username), None) is None:
            raise keyring.errors.PasswordDeleteError(username)
