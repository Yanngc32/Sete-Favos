"""Capacidades padrão por tipo de aparelho, com os rótulos que o front mostra."""

from __future__ import annotations

from collections.abc import Iterable

from casa.model import Capability, Option

AC_MODE_LABELS = {"cool": "Frio", "heat": "Quente", "fan": "Ventilar", "dry": "Desumidificar", "auto": "Auto"}
FAN_SPEED_LABELS = {
    "auto": "Auto", "silent": "Silenciosa", "low": "Baixa", "medium": "Média", "high": "Alta", "max": "Máxima",
}
VACUUM_STATUS_LABELS = {
    "docked": "Na base", "cleaning": "Limpando", "returning": "Voltando",
    "paused": "Pausado", "idle": "Parado", "error": "Erro",
}


def _options(values: Iterable[str], labels: dict[str, str]) -> list[Option]:
    return [Option(value=v, label=labels.get(v, v)) for v in values]


def power() -> Capability:
    return Capability(id="power", type="bool", label="Ligado")


def light_caps(*, brightness: bool, color_temp: bool, color: bool) -> list[Capability]:
    caps = [power()]
    if brightness:
        caps.append(Capability(id="brightness", type="int", label="Brilho", min=1, max=100, step=1, unit="%"))
    if color_temp:
        caps.append(Capability(id="color_temp", type="int", label="Temperatura de cor", min=0, max=100, step=1))
    if color:
        caps.append(Capability(id="color", type="color", label="Cor"))
    return caps


def plug_caps(*, power_w: bool) -> list[Capability]:
    caps = [power()]
    if power_w:
        caps.append(Capability(id="power_w", type="float", label="Consumo", readonly=True, unit="W"))
    return caps


def switch_caps(gangs: list[tuple[str, str]]) -> list[Capability]:
    """Interruptor de várias teclas: `power` liga/desliga todas; cada tecla é um bool próprio."""
    return [power(), *(Capability(id=code, type="bool", label=label) for code, label in gangs)]


# Teclas do controle (nomes do webOS; o painel desenha o direcional, OK, voltar, início...).
REMOTE_KEYS = (
    "UP", "DOWN", "LEFT", "RIGHT", "ENTER", "BACK", "HOME", "MENU", "EXIT", "INFO",
    "PLAY", "PAUSE", "VOLUMEUP", "VOLUMEDOWN", "CHANNELUP", "CHANNELDOWN",
)


def ac_caps(
    min_temp: float, max_temp: float, step: float, modes: Iterable[str], fans: Iterable[str]
) -> list[Capability]:
    return [
        power(),
        Capability(
            id="target_temp", type="float", label="Temperatura", min=min_temp, max=max_temp, step=step, unit="°C"
        ),
        Capability(id="current_temp", type="float", label="Ambiente", readonly=True, unit="°C"),
        Capability(id="ac_mode", type="enum", label="Modo", options=_options(modes, AC_MODE_LABELS)),
        Capability(id="fan_speed", type="enum", label="Ventilação", options=_options(fans, FAN_SPEED_LABELS)),
    ]


def tv_caps(sources: Iterable[tuple[str, str]]) -> list[Capability]:
    return [
        power(),
        Capability(id="volume", type="int", label="Volume", min=0, max=100, step=1),
        Capability(id="muted", type="bool", label="Mudo"),
        Capability(id="source", type="enum", label="Entrada",
                   options=[Option(value=v, label=label) for v, label in sources]),
    ]


def vacuum_caps(fan_power: Iterable[tuple[str, str]]) -> list[Capability]:
    caps = [
        Capability(id="vacuum_status", type="enum", label="Status", readonly=True,
                   options=_options(VACUUM_STATUS_LABELS, VACUUM_STATUS_LABELS)),
        Capability(id="vacuum_error", type="text", label="Erro", readonly=True),
        Capability(id="battery", type="int", label="Bateria", readonly=True, min=0, max=100, unit="%"),
    ]
    fan_options = [Option(value=v, label=label) for v, label in fan_power]
    if fan_options:
        caps.append(Capability(id="fan_power", type="enum", label="Potência", options=fan_options))
    caps += [
        Capability(id="start", type="action", label="Iniciar"),
        Capability(id="pause", type="action", label="Pausar"),
        Capability(id="dock", type="action", label="Voltar à base"),
        Capability(id="locate", type="action", label="Bipar"),
    ]
    return caps
