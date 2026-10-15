"""Painel personalizável da Início (modelo "sections" do Home Assistant).

Um painel só, salvo na central e igual em todos os aparelhos: abas (views) → seções → cards.
Sem personalização o painel é "automático" (um bloco por cômodo, montado pelo front).
Referências a aparelhos/rotinas que sumiram são aceitas: o front mostra "Removido".
O documento é versionado (`rev`): salvar com versão velha = conflito, porque outro aparelho salvou antes.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from casa.events import EventBus
from casa.model import CardShow, CardSize, new_id
from casa.store import Store

MAX_VIEWS = 10
MAX_SECTIONS = 20
MAX_CARDS_PER_SECTION = 60
MAX_CARDS = 400
MAX_GLANCE = 12

Ref = Annotated[str, StringConstraints(min_length=1, max_length=64)]
CardType = Literal["device", "glance", "routine", "virtual", "summary"]


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


class DashCard(BaseModel):
    id: Ref = Field(default_factory=new_id)
    type: CardType
    cols: int = Field(default=1, ge=1, le=4)
    name: str | None = Field(default=None, max_length=60)  # nome exibido (opcional)
    device_id: Ref | None = None  # device: aparelho ou grupo
    device_ids: list[Ref] = Field(default_factory=list, max_length=MAX_GLANCE)  # glance
    routine_id: Ref | None = None
    virtual_id: Ref | None = None
    # Só card de aparelho: sobrescreve o tamanho / o que mostra do padrão do aparelho (None = herda).
    size: CardSize | None = None
    show: CardShow | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v)

    @model_validator(mode="after")
    def _shape(self) -> DashCard:
        needs = {
            "device": bool(self.device_id),
            "glance": bool(self.device_ids),
            "routine": bool(self.routine_id),
            "virtual": bool(self.virtual_id),
            "summary": True,
        }
        if not needs[self.type]:
            raise ValueError("Falta escolher o que o card mostra.")
        if self.type != "device":
            self.size = None
            self.show = None
        elif self.show is not None and not self.show:
            self.show = None
        if len(set(self.device_ids)) != len(self.device_ids):
            raise ValueError("Um aparelho só entra uma vez na lista.")
        return self


class DashSection(BaseModel):
    id: Ref = Field(default_factory=new_id)
    title: str | None = Field(default=None, max_length=60)
    cards: list[DashCard] = Field(default_factory=list, max_length=MAX_CARDS_PER_SECTION)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str | None) -> str | None:
        return _clean(v)


class DashView(BaseModel):
    id: Ref = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=40)
    sections: list[DashSection] = Field(default_factory=list, max_length=MAX_SECTIONS)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Dê um nome à aba.")
        return v


class DashboardConflict(Exception):
    """Outro aparelho salvou o painel depois que este começou a editar."""

    code = "conflito"

    def __init__(self, rev: int) -> None:
        super().__init__("O painel mudou em outro aparelho.")
        self.message = "O painel mudou em outro aparelho."
        self.data = {"rev": rev}


def validate_views(views: list[DashView]) -> list[DashView]:
    if not views:
        raise ValueError("O painel precisa de pelo menos uma aba.")
    if len(views) > MAX_VIEWS:
        raise ValueError(f"No máximo {MAX_VIEWS} abas.")
    section_ids = [s.id for v in views for s in v.sections]
    card_ids = [c.id for v in views for s in v.sections for c in s.cards]
    if len({v.id for v in views}) != len(views) or len(set(section_ids)) != len(section_ids):
        raise ValueError("Abas ou seções com o mesmo id.")
    if len(set(card_ids)) != len(card_ids):
        raise ValueError("Cards com o mesmo id.")
    if len(card_ids) > MAX_CARDS:
        raise ValueError(f"No máximo {MAX_CARDS} cards no painel.")
    return views


class Dashboards:
    def __init__(self, store: Store, bus: EventBus) -> None:
        self.store = store
        self.bus = bus
        doc = store.get("dashboard", "main") or {"rev": 0, "views": None}
        self._rev: int = int(doc.get("rev", 0))
        self._views: list[DashView] | None = (
            [DashView.model_validate(v) for v in doc["views"]] if doc.get("views") else None
        )

    def get(self) -> dict[str, Any]:
        return {
            "auto": self._views is None,
            "rev": self._rev,
            "views": [v.model_dump(mode="json") for v in self._views or []],
        }

    def save(self, views: list[DashView], expected_rev: int) -> dict[str, Any]:
        if expected_rev != self._rev:
            raise DashboardConflict(self._rev)
        self._views = validate_views(views)
        return self._commit()

    def reset(self) -> dict[str, Any]:
        """Volta ao painel automático. A versão continua subindo, pra quem editava a antiga entrar em conflito."""
        self._views = None
        return self._commit()

    def _commit(self) -> dict[str, Any]:
        self._rev += 1
        self.store.put("dashboard", "main", {
            "rev": self._rev, "views": [v.model_dump(mode="json") for v in self._views] if self._views else None,
        })
        self.bus.publish({"t": "dashboard", "rev": self._rev, "auto": self._views is None})
        return self.get()
