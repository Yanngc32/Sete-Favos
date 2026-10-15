"""Modelo de aparelho: registro persistido, capacidades e visão enviada ao front."""

from __future__ import annotations

import math
import re
import time
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

Kind = Literal["light", "plug", "switch", "ac", "tv", "vacuum", "phone", "other"]
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
CapType = Literal["bool", "int", "float", "enum", "color", "text", "action"]

KIND_LABELS: dict[str, str] = {
    "light": "Luz",
    "plug": "Tomada",
    "ac": "Ar",
    "tv": "TV",
    "vacuum": "Robô",
    "phone": "Celular",
    "other": "Outro",
}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Option(BaseModel):
    value: str
    label: str


class Capability(BaseModel):
    """Uma coisa que o aparelho informa ou aceita.

    Ids usados pelo front e pelas automações: power, brightness (1–100),
    color_temp (0 quente – 100 frio), color (#rrggbb), power_w, target_temp,
    current_temp, ac_mode, fan_speed, volume (0–100), muted, source,
    vacuum_status, vacuum_error, battery, fan_power, last_clean,
    e as ações start, pause, dock, locate.
    """

    id: str
    type: CapType
    label: str
    readonly: bool = False
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None
    options: list[Option] | None = None

    def validate_value(self, value: Any) -> Any:
        """Confere e normaliza um valor de comando. Lança ValueError com texto pro usuário."""
        if self.readonly:
            raise ValueError(f"{self.label} só pode ser lido")
        if self.type == "action":
            return None
        if self.type == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{self.label}: esperava ligado/desligado")
            return value
        if self.type in ("int", "float"):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{self.label}: esperava um número")
            if (self.min is not None and value < self.min) or (self.max is not None and value > self.max):
                raise ValueError(f"{self.label}: fora da faixa permitida")
            return int(round(value)) if self.type == "int" else float(value)
        if self.type == "enum":
            allowed = {o.value for o in self.options or []}
            if value not in allowed:
                raise ValueError(f"{self.label}: opção inválida")
            return value
        if self.type == "color":
            if not (isinstance(value, str) and _HEX_COLOR.fullmatch(value)):
                raise ValueError(f"{self.label}: cor inválida")
            return value.lower()
        if not isinstance(value, str):
            raise ValueError(f"{self.label}: esperava texto")
        return value


CardSize = Literal["s", "m", "l"]

# O que o card pode mostrar, por tipo (o front tem o mesmo catálogo em lib/cardLook.ts).
# Comuns: cômodo e linha de estado; `level` é o número principal de cada tipo (brilho, alvo, volume, bateria, W);
# `quick` é legado (chave única de "controles rápidos" de antes): continua aceita pra não quebrar o que já está salvo.
CARD_SHOW_COMMON = frozenset({"room", "status", "level", "quick"})
CARD_SHOW_BY_KIND: dict[str, frozenset[str]] = {
    "light": frozenset({"color", "nudge", "palette"}),
    "tv": frozenset({"source", "power", "mute", "remote"}),
    "ac": frozenset({"current", "mode", "fan", "nudge"}),
    "vacuum": frozenset({"fan_power", "actions", "dock"}),
    "plug": frozenset(),
    "switch": frozenset({"keynames", "all"}),
    "phone": frozenset({"charging", "home"}),
    "other": frozenset(),
}
CARD_SHOW_GROUP = frozenset({"members", "offline"})
CARD_SHOW_ALL = CARD_SHOW_COMMON | CARD_SHOW_GROUP | frozenset().union(*CARD_SHOW_BY_KIND.values())
MAX_SHOW = 24


class CardKeyError(ValueError):
    """Chave de `card.show` que não existe para este tipo de aparelho (vira 422)."""


def card_show_keys(kind: str, group: bool = False) -> frozenset[str]:
    """Chaves aceitas para este tipo. Grupo: as do tipo dos membros + contagem e aviso de sem resposta."""
    keys = CARD_SHOW_COMMON | CARD_SHOW_BY_KIND.get(kind, frozenset())
    return keys | CARD_SHOW_GROUP if group else keys


def _clean_show(value: Any) -> dict[str, bool]:
    """{"chave": bool}; None = padrão (some). Chave fora do catálogo ou valor que não é bool = erro de validação."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("show precisa ser um objeto")
    if len(value) > MAX_SHOW:
        raise ValueError("show com chaves demais")
    out: dict[str, bool] = {}
    for k, v in value.items():
        if k not in CARD_SHOW_ALL:
            raise ValueError(f"Opção do card desconhecida: {k}")
        if v is None:
            continue
        if not isinstance(v, bool):
            raise ValueError(f"{k}: esperava ligado/desligado")
        out[k] = v
    return out


# O que o card do aparelho mostra: {"level": false, "mute": true...}. Ausente = padrão (mostra).
CardShow = Annotated[dict[str, bool], BeforeValidator(_clean_show)]


class CardPrefs(BaseModel):
    """Aparência do card do aparelho na Início, igual em todos os aparelhos de acesso.

    size: s = pílula (ícone, nome e liga/desliga), m = o card normal, l = com controles e número grande.
    show: o que aparece, por tipo (ver CARD_SHOW_BY_KIND).
    """

    model_config = ConfigDict(extra="forbid")

    size: CardSize | None = None
    show: CardShow = Field(default_factory=dict)

    def normalized(self) -> CardPrefs | None:
        """Sem nada escolhido = None (volta ao padrão)."""
        return None if self.size is None and not self.show else self

    def check_kind(self, kind: str, group: bool = False) -> None:
        bad = sorted(set(self.show) - card_show_keys(kind, group))
        if bad:
            raise CardKeyError(f"Este aparelho não tem: {', '.join(bad)}")


class DeviceRecord(BaseModel):
    """O que fica salvo no banco. `config` só tem dado não secreto (IP, id, modelo...)."""

    id: str = Field(default_factory=new_id)
    vendor: str
    kind: Kind
    name: str
    room: str | None = None
    pinned: bool = False
    card: CardPrefs | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)


class DeviceView(BaseModel):
    """O que o front recebe."""

    id: str
    vendor: str
    vendor_label: str
    kind: Kind
    name: str
    room: str | None
    pinned: bool
    online: bool | None  # None = ainda não respondeu desde que a central subiu
    last_seen: float | None
    state: dict[str, Any]
    capabilities: list[Capability]
    notes: list[str] = Field(default_factory=list)
    ip: str | None = None
    model: str | None = None
    # Só em grupo: ids dos aparelhos que o formam.
    members: list[str] | None = None
    # Timer "desligar em...": quando (epoch) a central desliga o aparelho.
    off_at: float | None = None
    # Teclas de controle remoto aceitas (TV); None = sem controle.
    remote: list[str] | None = None
    # Aparência do card (tamanho e o que mostra); None = padrão.
    card: CardPrefs | None = None
    # Só na resposta de um comando em grupo que chegou a parte dos membros: {ok, total, failed: [nomes]}.
    partial: dict[str, Any] | None = None
