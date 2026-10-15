from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from casa.dashboard import DashboardConflict, Dashboards, DashView, validate_views
from casa.events import EventBus
from casa.store import Store


def view(name: str = "Casa", cards: list[dict] | None = None) -> dict:
    return {
        "id": f"v-{name}", "name": name,
        "sections": [{"id": f"s-{name}", "title": "Sala", "cards": cards or [
            {"id": f"c-{name}-1", "type": "device", "device_id": "luz", "cols": 2},
            {"id": f"c-{name}-2", "type": "summary", "cols": 4},
        ]}],
    }


def parse(*views: dict) -> list[DashView]:
    return [DashView.model_validate(v) for v in views]


def test_starts_automatic_and_saves_with_rev() -> None:
    store, bus = Store(":memory:"), EventBus()
    sub = bus.subscribe()
    d = Dashboards(store, bus)
    assert d.get() == {"auto": True, "rev": 0, "views": []}
    saved = d.save(parse(view()), 0)
    assert saved["auto"] is False and saved["rev"] == 1 and saved["views"][0]["sections"][0]["cards"][0]["cols"] == 2
    assert sub.queue.get_nowait() == {"t": "dashboard", "rev": 1, "auto": False}


def test_conflict_and_reset_keep_the_version_growing() -> None:
    d = Dashboards(Store(":memory:"), EventBus())
    d.save(parse(view()), 0)
    with pytest.raises(DashboardConflict) as err:
        d.save(parse(view("Outra")), 0)  # quem começou a editar antes do primeiro save
    assert err.value.data == {"rev": 1} and err.value.code == "conflito"
    assert d.reset() == {"auto": True, "rev": 2, "views": []}
    with pytest.raises(DashboardConflict):  # quem editava a versão 1 não sobrescreve o reset sem saber
        d.save(parse(view()), 1)
    assert d.save(parse(view()), 2)["rev"] == 3


def test_persists_across_restarts(tmp_path) -> None:
    path = tmp_path / "d.db"
    d = Dashboards(Store(path), EventBus())
    d.save(parse(view("Casa"), view("Noite")), 0)
    again = Dashboards(Store(path), EventBus()).get()
    assert [v["name"] for v in again["views"]] == ["Casa", "Noite"] and again["rev"] == 1 and not again["auto"]
    reset = Dashboards(Store(path), EventBus())
    reset.reset()
    assert Dashboards(Store(path), EventBus()).get()["auto"] is True


def test_card_shapes_are_validated() -> None:
    with pytest.raises(ValueError, match="Falta escolher"):
        parse(view(cards=[{"type": "device"}]))
    with pytest.raises(ValueError, match="Falta escolher"):
        parse(view(cards=[{"type": "glance", "device_ids": []}]))
    with pytest.raises(ValueError):
        parse(view(cards=[{"type": "device", "device_id": "x", "cols": 5}]))
    with pytest.raises(ValueError):
        parse(view(cards=[{"type": "tabela"}]))
    ok = parse(view(cards=[{"type": "glance", "device_ids": ["a", "b"], "name": "  Luzes  "}]))
    assert ok[0].sections[0].cards[0].name == "Luzes"


def test_document_limits() -> None:
    with pytest.raises(ValueError, match="pelo menos uma aba"):
        validate_views([])
    with pytest.raises(ValueError, match="No máximo 10 abas"):
        validate_views(parse(*(view(f"v{i}") for i in range(11))))
    with pytest.raises(ValueError, match="mesmo id"):
        validate_views(parse(view("A"), view("A")))
    dup = view("B", cards=[{"id": "x", "type": "summary"}, {"id": "x", "type": "summary"}])
    with pytest.raises(ValueError, match="Cards com o mesmo id"):
        validate_views(parse(dup))
    big = [view(f"w{i}", cards=[{"id": f"w{i}-{j}", "type": "summary"} for j in range(60)]) for i in range(7)]
    with pytest.raises(ValueError, match="No máximo 400 cards"):
        validate_views(parse(*big))
    with pytest.raises(ValueError, match="Dê um nome"):
        parse({"id": "v", "name": "   ", "sections": []})


def test_dashboard_over_http(pc: TestClient, phone: TestClient) -> None:
    assert pc.get("/api/dashboard").json() == {"auto": True, "rev": 0, "views": []}
    r = pc.put("/api/dashboard", json={"views": [view()], "expected_rev": 0})
    assert r.status_code == 200 and r.json()["rev"] == 1
    stale = pc.put("/api/dashboard", json={"views": [view("Outra")], "expected_rev": 0})
    assert stale.status_code == 409
    assert stale.json() == {"detail": "O painel mudou em outro aparelho.", "code": "conflito", "data": {"rev": 1}}
    bad = pc.put("/api/dashboard", json={"views": [view(cards=[{"type": "device"}])], "expected_rev": 1})
    assert bad.status_code == 422 and bad.json()["detail"] == "Falta escolher o que o card mostra."
    assert pc.put("/api/dashboard", json={"views": [], "expected_rev": 1}).status_code == 400
    assert phone.get("/api/dashboard").status_code == 401  # sem pareamento
    assert pc.delete("/api/dashboard").json() == {"auto": True, "rev": 2, "views": []}


def test_validation_errors_are_plain_text(pc: TestClient) -> None:
    r = pc.post("/api/groups", json={})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and r.json()["code"] == "invalido"
