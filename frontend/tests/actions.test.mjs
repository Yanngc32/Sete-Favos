import assert from "node:assert/strict";
import test from "node:test";
// Roda com: npm test. actions.ts só importa tipos.
import * as x from "../src/lib/actions.ts";

const c = (id, type, extra = {}) => ({ id, type, label: id, readonly: false, min: null, max: null, step: null, unit: null, options: null, ...extra });
const opts = (...v) => v.map((value) => ({ value, label: value }));
const ar = {
  id: "ar", kind: "ac", name: "Ar do quarto", remote: null,
  state: { power: false, target_temp: 21, ac_mode: "heat", fan_speed: "auto", current_temp: 25 },
  capabilities: [
    c("power", "bool"), c("target_temp", "float", { min: 16, max: 30, step: 1, unit: "°C" }),
    c("current_temp", "float", { readonly: true }), c("ac_mode", "enum", { options: opts("cool", "heat") }),
    c("fan_speed", "enum", { options: opts("auto", "low", "high") }),
  ],
};
const robo = { id: "r", kind: "vacuum", name: "Robô", state: {}, capabilities: [
  c("fan_power", "enum", { options: opts("quiet", "turbo") }), c("start", "action"), c("dock", "action")] };
const tv = { id: "tv", kind: "tv", name: "TV", state: { power: true, volume: 12 }, remote: ["HOME", "BACK"], capabilities: [
  c("power", "bool"), c("volume", "int", { min: 0, max: 100 }), c("muted", "bool")] };

test("formato antigo e novo", () => {
  assert.deepEqual(x.actionValues({ type: "device", device_id: "ar", capability: "power", value: true }), { power: true });
  assert.deepEqual(x.actionValues({ type: "device", device_id: "r", capability: "start" }), { start: null });
  assert.deepEqual(x.actionValues({ type: "device", device_id: "ar", values: { target_temp: 23 } }), { target_temp: 23 });
  assert.deepEqual(x.actionValues({ type: "device", device_id: "ar" }), {});
});

test("ordem: liga primeiro, ajustes, comando, desliga por último", () => {
  const order = x.orderedValues({ ac_mode: "cool", power: true, target_temp: 23 }, ar).map(([k]) => k);
  assert.deepEqual(order, ["power", "ac_mode", "target_temp"]);
  assert.deepEqual(x.orderedValues({ power: false, target_temp: 26 }, ar).map(([k]) => k), ["target_temp", "power"]);
  assert.deepEqual(x.orderedValues({ start: null, fan_power: "turbo" }, robo).map(([k]) => k), ["fan_power", "start"]);
  assert.deepEqual(x.orderedValues({ remote: "HOME", power: true, volume: 3 }, tv).map(([k]) => k), ["power", "volume", "remote"]);
});

test("expande cada ajuste numa ação de um ajuste (frase, horários)", () => {
  const out = x.expandActions([
    { type: "device", device_id: "ar", values: { target_temp: 23, power: true } },
    { type: "delay", minutes: 10 },
    { type: "device", device_id: "ar", capability: "power", value: false },
  ], [ar]);
  assert.deepEqual(out.map((a) => (a.type === "device" ? `${a.capability}=${a.value}` : a.type)),
    ["power=true", "target_temp=23", "delay", "power=false"]);
});

test("o que dá pra ajustar: sem leitura, com tecla do controle", () => {
  assert.deepEqual(x.writableCaps(ar).map((k) => k.id), ["power", "target_temp", "ac_mode", "fan_speed"]);
  const keys = x.writableCaps(tv);
  assert.equal(keys.at(-1).id, x.REMOTE_KEY);
  assert.deepEqual(keys.at(-1).options.map((o) => o.label), ["Início", "Voltar"]);
});

test("igual a agora, primeiro ajuste e atalhos", () => {
  assert.deepEqual(x.valuesFromState(ar), { power: false });
  assert.deepEqual(x.valuesFromState({ ...ar, state: { ...ar.state, power: true } }),
    { power: true, target_temp: 21, ac_mode: "heat", fan_speed: "auto" });
  assert.deepEqual(x.firstValues(ar), { power: true });
  assert.deepEqual(x.firstValues(robo), { start: null });
  const presets = x.presetsFor(ar);
  const cold = presets.find((p) => p.id === "cold");
  assert.deepEqual(cold.values, { power: true, target_temp: 18, ac_mode: "cool", fan_speed: "high" });
  assert.deepEqual(presets.find((p) => p.id === "sleep").values.fan_speed, "low");
  assert.ok(presets.some((p) => p.id === "off"));
  assert.deepEqual(x.presetsFor(robo).find((p) => p.id === "deep").values, { fan_power: "turbo", start: null });
  assert.ok(x.sameValues({ a: 1, b: 2 }, { b: 2, a: 1 }) && !x.sameValues({ a: 1 }, { a: 1, b: 2 }));
});

test("valor inicial de um ajuste novo", () => {
  assert.equal(x.initialValue(ar.capabilities[1], ar), 21);
  assert.equal(x.initialValue(ar.capabilities[3], ar), "heat");
  assert.equal(x.initialValue(c("switch_1", "bool"), { ...ar, state: { switch_1: true } }), false);
});
