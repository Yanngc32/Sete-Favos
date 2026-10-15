"""Modelo mínimo de rotinas, automações e objetos virtuais.

Automação = 1 gatilho (horário, nascer/pôr do sol, aparelho muda ou objeto virtual muda)
+ até 3 condições "E" + ações em ordem. Rotina = só ações, disparada à mão.
Objeto virtual = liga/desliga que serve de estado e gatilho.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from casa.model import new_id

MAX_ACTIONS = 50
# Ajustes numa ação de aparelho ("Ar: liga, 23 °C, frio, ventilação baixa" = 4).
MAX_VALUES = 12
# Chave especial de `values`: tecla do controle remoto (TV), fora das capacidades.
REMOTE_KEY = "remote"

Hhmm = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
# 0 = segunda ... 6 = domingo (datetime.weekday()).
Day = Annotated[int, Field(ge=0, le=6)]
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def _days(v: list[int]) -> list[int]:
    if not v:
        raise ValueError("Escolha pelo menos um dia.")
    return sorted(set(v))


# Gatilhos -------------------------------------------------------------------


class TimeTrigger(BaseModel):
    type: Literal["time"] = "time"
    at: Hhmm
    days: list[Day] = Field(default_factory=lambda: list(ALL_DAYS))

    _check_days = field_validator("days")(_days)


class DeviceTrigger(BaseModel):
    type: Literal["device"] = "device"
    device_id: str
    capability: str
    to: Any


class VirtualTrigger(BaseModel):
    type: Literal["virtual"] = "virtual"
    virtual_id: str
    to: bool


class SunTrigger(BaseModel):
    """Nascer/pôr do sol na localização da casa, com folga (ex.: -15 = 15 min antes)."""

    type: Literal["sun"] = "sun"
    event: Literal["sunrise", "sunset"]
    offset: int = Field(default=0, ge=-240, le=240)
    days: list[Day] = Field(default_factory=lambda: list(ALL_DAYS))

    _check_days = field_validator("days")(_days)


Trigger = Annotated[TimeTrigger | DeviceTrigger | VirtualTrigger | SunTrigger, Field(discriminator="type")]


# Condições ------------------------------------------------------------------


class TimeBetween(BaseModel):
    type: Literal["time_between"] = "time_between"
    start: Hhmm
    end: Hhmm


class WeekdayIs(BaseModel):
    type: Literal["weekday"] = "weekday"
    days: list[Day]

    _check_days = field_validator("days")(_days)


class DeviceIs(BaseModel):
    type: Literal["device_is"] = "device_is"
    device_id: str
    capability: str
    value: Any


class VirtualIs(BaseModel):
    type: Literal["virtual_is"] = "virtual_is"
    virtual_id: str
    value: bool


Condition = Annotated[TimeBetween | WeekdayIs | DeviceIs | VirtualIs, Field(discriminator="type")]


# Ações ----------------------------------------------------------------------


class DeviceAction(BaseModel):
    """Ajusta uma ou mais capacidades de um aparelho: {"power": true, "target_temp": 23, "ac_mode": "cool"}.

    O formato antigo (`capability` + `value`, um ajuste por ação) continua aceito e vira `values`.
    Comando sem valor ("start") vale None. A chave `remote` é uma tecla do controle (TV).
    """

    type: Literal["device"] = "device"
    device_id: str
    values: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _legacy(cls, data: Any) -> Any:
        if isinstance(data, dict) and "capability" in data:
            rest = {k: v for k, v in data.items() if k not in ("capability", "value")}
            if not rest.get("values") and data["capability"]:
                rest["values"] = {data["capability"]: data.get("value")}
            return rest
        return data

    @field_validator("values")
    @classmethod
    def _max(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > MAX_VALUES:
            raise ValueError(f"Uma ação ajusta no máximo {MAX_VALUES} coisas do aparelho.")
        if any(not isinstance(k, str) or not k or len(k) > 40 for k in v):
            raise ValueError("Ajuste inválido.")
        return v

    def ordered(self) -> list[tuple[str, Any]]:
        """Ordem de execução: liga primeiro, depois ajustes, tecla, comandos; desliga por último."""
        items = list(self.values.items())

        def rank(item: tuple[str, Any]) -> int:
            k, v = item
            if k == "power":
                return 0 if v is not False else 4
            if k == REMOTE_KEY:
                return 2
            return 3 if v is None else 1

        return sorted(items, key=rank)


class VirtualAction(BaseModel):
    type: Literal["virtual"] = "virtual"
    virtual_id: str
    value: bool


class DelayAction(BaseModel):
    type: Literal["delay"] = "delay"
    minutes: int = Field(ge=1, le=120)


class RoutineAction(BaseModel):
    type: Literal["routine"] = "routine"
    routine_id: str


Action = Annotated[DeviceAction | VirtualAction | DelayAction | RoutineAction, Field(discriminator="type")]


# Resultado de execução ------------------------------------------------------


class StepResult(BaseModel):
    label: str
    ok: bool
    error: str | None = None


class RunResult(BaseModel):
    id: str = Field(default_factory=new_id)
    at: float
    total: int = 0
    succeeded: int = 0
    errors: list[str] = Field(default_factory=list)
    steps: list[StepResult] = Field(default_factory=list)
    # Ainda rodando (parou numa espera); o resultado final chega por evento.
    pending: bool = False
    skipped: str | None = None

    @property
    def ok(self) -> bool:
        return not self.errors and self.skipped is None


# Entidades ------------------------------------------------------------------


class _Named(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Dê um nome.")
        return v


class Routine(_Named):
    actions: list[Action] = Field(min_length=1, max_length=MAX_ACTIONS)
    pinned: bool = False
    last_run: RunResult | None = None
    incomplete: str | None = None


class Automation(_Named):
    enabled: bool = True
    trigger: Trigger
    conditions: list[Condition] = Field(default_factory=list, max_length=3)
    actions: list[Action] = Field(min_length=1, max_length=MAX_ACTIONS)
    last_run: RunResult | None = None
    incomplete: str | None = None


class VirtualObject(_Named):
    kind: Literal["switch"] = "switch"
    value: bool = False
    pinned: bool = False
