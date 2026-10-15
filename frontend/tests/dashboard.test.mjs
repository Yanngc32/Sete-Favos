import assert from "node:assert/strict";
import test from "node:test";
// Roda com: npm test (Node 22.6+ tira os tipos sozinho; dashboard.ts só importa tipos).
import * as d from "../src/lib/dashboard.ts";

const card = (id, extra = {}) => ({ id, type: "device", cols: 1, device_id: id, ...extra });
const base = () => [
  { id: "v1", name: "Casa", sections: [
    { id: "s1", title: "Sala", cards: [card("a"), card("b"), card("c")] },
    { id: "s2", title: "Quarto", cards: [card("d")] },
  ]},
  { id: "v2", name: "Noite", sections: [{ id: "s3", title: null, cards: [] }] },
];
const ids = (views, sid) => views.flatMap((v) => v.sections).find((s) => s.id === sid).cards.map((c) => c.id);

test("operações do painel personalizável", () => {
  // imutável
  const b = base(); const frozen = JSON.stringify(b);
  d.moveCard(b, "a", { viewId: "v1", sectionId: "s2", index: 0 }); assert.equal(JSON.stringify(b), frozen);

  // mover na mesma seção: posição vale depois de tirar o card
  assert.deepEqual(ids(d.moveCard(base(), "a", { viewId: "v1", sectionId: "s1", index: 2 }), "s1"), ["b", "c", "a"]);
  assert.deepEqual(ids(d.moveCard(base(), "c", { viewId: "v1", sectionId: "s1", index: 0 }), "s1"), ["c", "a", "b"]);
  // entre seções e entre abas
  const m = d.moveCard(base(), "b", { viewId: "v2", sectionId: "s3", index: 0 });
  assert.deepEqual(ids(m, "s1"), ["a", "c"]); assert.deepEqual(ids(m, "s3"), ["b"]);
  // destino inexistente não perde o card
  assert.deepEqual(ids(d.moveCard(base(), "a", { viewId: "v1", sectionId: "nao", index: 0 }), "s1"), ["a", "b", "c"]);

  // teclado
  let r = d.stepCard(base(), "a", 1); assert.deepEqual(ids(r.views, "s1"), ["b", "a", "c"]); assert.equal(r.slot.index, 1);
  r = d.stepCard(base(), "c", 1); assert.deepEqual(r.slot, { viewId: "v1", sectionId: "s2", index: 0 }); assert.deepEqual(ids(r.views, "s2"), ["c", "d"]);
  r = d.stepCard(base(), "d", -1); assert.deepEqual(r.slot, { viewId: "v1", sectionId: "s1", index: 3 });
  assert.equal(d.stepCard(base(), "a", -1), null);  // início da primeira seção

  // cards
  let v = d.addCard(base(), "s2", { type: "summary", cols: 4 });
  assert.equal(ids(v, "s2").length, 2);
  v = d.updateCard(v, "d", { cols: 3 }); assert.equal(d.findCard(v, "d").cols, 3);
  v = d.removeCard(v, "d"); assert.equal(d.locate(v, "d"), null);
  // limite por seção
  let full = base(); for (let i = 0; i < 70; i++) full = d.addCard(full, "s1", { type: "summary", cols: 1 });
  assert.equal(ids(full, "s1").length, d.MAX_CARDS_PER_SECTION);

  // seções
  v = d.addSection(base(), "v2", { title: "Luzes" }); assert.equal(v[1].sections.length, 2);
  v = d.renameSection(v, "s1", "  Sala de estar "); assert.equal(v[0].sections[0].title, "Sala de estar");
  v = d.renameSection(v, "s1", "   "); assert.equal(v[0].sections[0].title, null);
  v = d.moveSection(base(), "s1", 1); assert.deepEqual(v[0].sections.map((s) => s.id), ["s2", "s1"]);
  assert.deepEqual(d.moveSection(base(), "s1", -1)[0].sections.map((s) => s.id), ["s1", "s2"]);
  v = d.removeSection(base(), "s2"); assert.equal(v[0].sections.length, 1);

  // abas
  v = d.addView(base(), " "); assert.equal(v[2].name, "Aba 3");
  assert.equal(d.removeView(d.removeView(base(), "v1"), "v2").length, 1);  // nunca fica sem aba
  assert.deepEqual(d.moveView(base(), "v1", 1).map((x) => x.id), ["v2", "v1"]);
  assert.equal(d.renameView(base(), "v1", "  ")[0].name, "Casa");
  let many = base(); for (let i = 0; i < 20; i++) many = d.addView(many, "x"); assert.equal(many.length, d.MAX_VIEWS);

  // painel automático → próprio
  const dev = (id, name, kind, room, pinned = false, vendor = "tuya") => ({ id, name, kind, room, pinned, vendor });
  const devices = [dev("l", "Luz", "light", "Sala"), dev("tv", "TV", "tv", "Sala"), dev("ar", "Ar", "ac", "Quarto"), dev("f", "Fita", "light", "Quarto"),
    dev("t", "Tomada", "plug", "Cozinha", true), dev("x", "Solta", "plug", null)];
  const auto = d.fromAuto(devices, ["Cozinha", "Quarto", "Sala"], [{ id: "r1", pinned: true }, { id: "r2", pinned: false }], [{ id: "vo", pinned: true }]);
  assert.equal(auto.length, 1);
  assert.deepEqual(auto[0].sections.map((s) => s.title), [null, "Fixados", "Quarto", "Sala", "Sem cômodo"]);  // empate Quarto/Sala (2): ordem alfabética; Cozinha só tem o fixado
  assert.deepEqual(auto[0].sections[0].cards.map((c) => c.type), ["summary", "routine", "virtual"]);
  assert.equal(auto[0].sections[2].cards[0].cols, 2);  // ar = herói
  const all = auto[0].sections.flatMap((s) => s.cards).map((c) => c.id); assert.equal(new Set(all).size, all.length);

  // referências quebradas
  assert.equal(d.isBroken(card("zzz"), devices, [], []), true);
  assert.equal(d.isBroken(card("l"), devices, [], []), false);
  assert.equal(d.isBroken({ id: "g", type: "glance", cols: 2, device_ids: ["zzz", "l"] }, devices, [], []), false);
  assert.equal(d.isBroken({ id: "r", type: "routine", cols: 1, routine_id: "r9" }, devices, [{ id: "r1" }], []), true);
  assert.equal(d.isBroken({ id: "s", type: "summary", cols: 4 }, [], [], []), false);
});

test("mover entre abas, reordenar seções, limites e configuração", () => {
  // pra aba: fim da última seção; cria seção se a aba está vazia; mesma aba não mexe
  let v = d.moveCardToView(base(), "a", "v2");
  assert.deepEqual(ids(v, "s1"), ["b", "c"]); assert.deepEqual(ids(v, "s3"), ["a"]);
  const noSec = [...base(), { id: "v3", name: "Vazia", sections: [] }];
  v = d.moveCardToView(noSec, "d", "v3");
  assert.equal(v[2].sections.length, 1); assert.deepEqual(v[2].sections[0].cards.map((c) => c.id), ["d"]);
  assert.deepEqual(d.moveCardToView(base(), "a", "v1"), base());
  assert.deepEqual(d.moveCardToView(base(), "zzz", "v2"), base());
  assert.deepEqual(d.moveCardToView(base(), "a", "nao"), base());
  // aba destino cheia: não perde o card
  let cheio = base(); for (let i = 0; i < 70; i++) cheio = d.addCard(cheio, "s3", { type: "summary", cols: 1 });
  assert.equal(d.locate(d.moveCardToView(cheio, "a", "v2"), "a").viewId, "v1");

  // seção pra uma posição (depois de tirar a seção)
  const tres = d.addSection(base(), "v1", { id: "s9", title: "Fim" });
  assert.deepEqual(d.moveSectionTo(tres, "s1", 2)[0].sections.map((s) => s.id), ["s2", "s9", "s1"]);
  assert.deepEqual(d.moveSectionTo(tres, "s9", 0)[0].sections.map((s) => s.id), ["s9", "s1", "s2"]);
  assert.deepEqual(d.moveSectionTo(tres, "s1", 99)[0].sections.map((s) => s.id), ["s2", "s9", "s1"]);
  assert.deepEqual(d.moveSectionTo(tres, "x", 0), tres);

  // limites
  assert.equal(d.canAddCard(base(), "s1"), true);
  assert.equal(d.canAddCard(cheio, "s3"), false);
  assert.equal(d.canAddCard(base(), "nao"), false);
  assert.equal(d.totalCards(base()), 4);

  // anúncio do teclado
  assert.deepEqual(d.describeSlot(base(), "b"), { position: 2, total: 3, section: "Sala", view: "Casa" });
  assert.equal(d.describeSlot(base(), "zzz"), null);
  assert.equal(d.describeSlot(d.renameSection(base(), "s2", ""), "d").section, null);

  // card incompleto, largura mínima, card em branco
  assert.equal(d.isComplete({ id: "x", type: "device", cols: 1, device_id: null }), false);
  assert.equal(d.isComplete({ id: "x", type: "glance", cols: 2, device_ids: [] }), false);
  assert.equal(d.isComplete({ id: "x", type: "glance", cols: 2, device_ids: ["a"] }), true);
  assert.equal(d.isComplete({ id: "x", type: "routine", cols: 1, routine_id: "r" }), true);
  assert.equal(d.isComplete({ id: "x", type: "summary", cols: 4 }), true);
  assert.equal(d.minCols({ type: "glance" }), 2);
  assert.equal(d.minCols({ type: "device" }, { kind: "vacuum", vendor: "xiaomi" }), 2);
  assert.equal(d.minCols({ type: "device" }, { kind: "vacuum", vendor: "grupo" }), 1);
  assert.equal(d.minCols({ type: "device" }, { kind: "ac", vendor: "midea" }), 1);
  assert.deepEqual(d.blankCard("glance"), { type: "glance", cols: 2, device_ids: [] });
  assert.equal(d.blankCard("summary").cols, 4);
  assert.equal(d.blankCard("routine").cols, 1);
  assert.equal(d.sameViews(base(), base()), true);
  assert.equal(d.sameViews(base(), d.removeCard(base(), "a")), false);
});

