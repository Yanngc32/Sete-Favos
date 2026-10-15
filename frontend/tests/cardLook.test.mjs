import assert from "node:assert/strict";
import test from "node:test";
// Roda com: npm test (cardLook.ts só importa tipos).
import * as l from "../src/lib/cardLook.ts";

const dev = (kind, extra = {}) => ({ id: kind, vendor: "sim", kind, capabilities: [], state: {}, card: null, remote: null, ...extra });
const caps = (...ids) => ids.map((id) => ({ id, type: "bool", label: id }));

test("aparência: padrão, aparelho e painel", () => {
  const look = l.resolveLook(dev("light"));
  assert.equal(look.size, "m");
  assert.ok(l.ALL_KEYS.every((k) => look.show[k] === true));
  const d = dev("light", { card: { size: "s", show: { room: false } } });
  assert.equal(l.resolveLook(d).size, "s");
  assert.equal(l.resolveLook(d).show.room, false);
  // painel sobrescreve, o que ele não diz vem do aparelho
  const o = l.resolveLook(d, { size: "l", show: { nudge: false } });
  assert.equal(o.size, "l"); assert.equal(o.show.nudge, false); assert.equal(o.show.room, false);
  assert.equal(l.resolveLook(d, { size: null, show: null }).size, "s");
  // legado: "quick: false" vale de padrão pros controles de cada tipo, mas não pro resto
  const old = l.resolveLook(dev("tv", { card: { show: { quick: false, mute: true } } }));
  assert.equal(old.show.remote, false); assert.equal(old.show.mute, true); assert.equal(old.show.source, true);
});

test("normalizar e comparar prefs", () => {
  assert.equal(l.normalizePrefs(null), null);
  assert.equal(l.normalizePrefs({ size: null, show: { room: null } }), null);
  assert.deepEqual(l.normalizePrefs({ size: "l", show: { room: false, x: 1 } }), { size: "l", show: { room: false } });
  assert.ok(l.samePrefs({ size: "s" }, { size: "s", show: {} }));
  assert.ok(!l.samePrefs({ size: "s" }, { size: "m" }));
  assert.ok(!l.samePrefs({ show: { mute: false } }, { show: {} }));
  assert.ok(l.samePrefs(null, { show: {} }));
  // do Look: só o que difere do padrão e só chaves do tipo
  const tv = dev("tv", { capabilities: caps("power", "muted", "volume", "source") });
  const look = l.resolveLook(tv);
  assert.equal(l.prefsFromLook(look, tv), null);
  look.show.mute = false; look.show.palette = false; // paleta não é de TV: não vai
  assert.deepEqual(l.prefsFromLook({ ...look, size: "s" }, tv), { size: "s", show: { mute: false } });
});

test("opções por tipo: só o que o aparelho tem", () => {
  const keys = (d) => l.showOptions(d).map((o) => o.key);
  const light = dev("light", { capabilities: caps("power", "brightness", "color_temp") });
  assert.deepEqual(keys(light), ["level", "color", "status", "room", "nudge", "palette"]);
  assert.deepEqual(keys(dev("light", { capabilities: caps("power") })), ["status", "room"]);
  const tv = dev("tv", { capabilities: caps("power", "volume", "muted", "source"), remote: ["UP", "ENTER"] });
  assert.deepEqual(keys(tv), ["source", "level", "status", "room", "power", "mute", "remote"]);
  assert.ok(!keys(dev("tv", { capabilities: caps("power", "volume") })).includes("remote"));
  const ac = dev("ac", { capabilities: caps("power", "target_temp", "ac_mode", "fan_speed"), state: { current_temp: 26 } });
  assert.deepEqual(keys(ac), ["level", "current", "mode", "fan", "status", "room", "nudge"]);
  const robo = dev("vacuum", { capabilities: caps("start", "pause", "dock", "fan_power"), state: { battery: 90 } });
  assert.deepEqual(keys(robo), ["level", "status", "fan_power", "room", "actions", "dock"]);
  assert.deepEqual(keys(dev("plug", { capabilities: caps("power", "power_w") })), ["level", "status", "room"]);
  const sw = dev("switch", { capabilities: caps("power", "switch_1", "switch_2") });
  assert.deepEqual(keys(sw), ["keynames", "status", "room", "all"]);
  assert.deepEqual(keys(dev("phone", { state: { battery: 80, charging: true, at_home: true } })), ["level", "charging", "home", "room"]);
  const grp = dev("light", { vendor: "grupo", capabilities: caps("power", "brightness") });
  assert.deepEqual(keys(grp), ["level", "status", "members", "nudge", "offline"]);
  // seções e tamanhos
  assert.deepEqual(l.showOptions(tv).find((o) => o.key === "remote").sizes, ["l"]);
  assert.equal(l.showOptions(tv).find((o) => o.key === "mute").group, "quick");
  // tudo que o front oferece existe no catálogo
  for (const d of [light, tv, ac, robo, sw, grp]) for (const k of keys(d)) assert.ok(l.ALL_KEYS.includes(k), k);
});

test("espaço na grade", () => {
  assert.deepEqual(l.cardSpan(dev("light"), "s"), { cols: 1, rows: 1 });
  assert.deepEqual(l.cardSpan(dev("light"), "m"), { cols: 1, rows: 3 });
  assert.deepEqual(l.cardSpan(dev("light"), "l"), { cols: 2, rows: 4 });
  // ar e robô continuam 2 colunas no médio (robô deitado, mais baixo); grupo de robôs não
  assert.deepEqual(l.cardSpan(dev("ac"), "m"), { cols: 2, rows: 3 });
  assert.deepEqual(l.cardSpan(dev("vacuum"), "m"), { cols: 2, rows: 2 });
  assert.deepEqual(l.cardSpan(dev("vacuum", { vendor: "grupo" }), "m").cols, 1);
  // interruptor de teclas: mais alto
  const sw = dev("switch", { capabilities: caps("power", "switch_1", "switch_2") });
  assert.deepEqual(l.cardSpan(sw, "m"), { cols: 2, rows: 4 });
  assert.deepEqual(l.cardSpan(sw, "l"), { cols: 2, rows: 5 });
  assert.deepEqual(l.cardSpan(sw, "s"), { cols: 1, rows: 1 });
});

test("colunas que cabem e largura dos blocos", () => {
  // 1660 px de tela ≈ 1350 px de painel: 7 colunas de 168 + 12
  assert.equal(l.tracksFor(1350, 168, 12), 7);
  assert.equal(l.tracksFor(1000, 168, 12), 5);
  assert.equal(l.tracksFor(1000, 148, 8), 6); // compacta: cabe mais
  assert.equal(l.tracksFor(0, 168, 12), 2);
  assert.equal(l.sectionSpan([1, 1], 7), 2);
  assert.equal(l.sectionSpan([2, 1, 1, 1, 1, 1, 1], 7), 7);
  assert.equal(l.sectionSpan([1], 7), 1);
  assert.equal(l.sectionSpan([2], 7), 2);
});
