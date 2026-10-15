import assert from "node:assert/strict";
import test from "node:test";
// Roda com: npm test. proxima.ts só importa tipos.
import * as p from "../src/screens/automacoes/proxima.ts";

const time = (at, days = [0, 1, 2, 3, 4, 5, 6]) => ({ type: "time", at, days });
const auto = (trigger, extra = {}) => ({ id: "a", name: "A", enabled: true, trigger, conditions: [], actions: [], incomplete: null, ...extra });
// quarta-feira, 14/10/2026, 17:00 (dayIdx = 2)
const now = new Date(2026, 9, 14, 17, 0);

test("dayIdx: segunda = 0, domingo = 6", () => {
  assert.equal(p.dayIdx(now), 2);
  assert.equal(p.dayIdx(new Date(2026, 9, 18)), 6);
});

test("nextRun: hoje mais tarde, amanhã, ou o próximo dia marcado", () => {
  assert.deepEqual(p.nextRun(auto(time("18:30")), now, null), new Date(2026, 9, 14, 18, 30));
  assert.deepEqual(p.nextRun(auto(time("07:00")), now, null), new Date(2026, 9, 15, 7, 0));
  // só sexta (4)
  assert.deepEqual(p.nextRun(auto(time("07:00", [4])), now, null), new Date(2026, 9, 16, 7, 0));
  // só quarta, já passou: semana que vem
  assert.deepEqual(p.nextRun(auto(time("08:00", [2])), now, null), new Date(2026, 9, 21, 8, 0));
  assert.equal(p.nextRun(auto(time("08:00", [])), now, null), null);
  assert.equal(p.nextRun(auto({ type: "virtual", virtual_id: "v", to: true }), now, null), null);
});

test("nextRun: sol usa o horário de hoje mais a folga", () => {
  const sun = { sunrise: "05:40", sunset: "18:07" };
  const t = { type: "sun", event: "sunset", offset: -15, days: [0, 1, 2, 3, 4, 5, 6] };
  assert.deepEqual(p.nextRun(auto(t), now, sun), new Date(2026, 9, 14, 17, 52));
  assert.equal(p.nextRun(auto(t), now, null), null);
});

test("nextOf ignora desativada e incompleta", () => {
  const list = [
    auto(time("17:30"), { id: "off", enabled: false }),
    auto(time("17:40"), { id: "inc", incomplete: "Incompleta: x foi removido" }),
    auto(time("18:30"), { id: "ok" }),
    auto(time("19:00"), { id: "late" }),
  ];
  assert.equal(p.nextOf(list, now, null).a.id, "ok");
  assert.equal(p.nextOf([], now, null), null);
});

test("whenLabel: hoje, amanhã, dia da semana", () => {
  assert.equal(p.whenLabel(new Date(2026, 9, 14, 18, 30), now), "hoje 18:30");
  assert.equal(p.whenLabel(new Date(2026, 9, 15, 7, 0), now), "amanhã 7:00");
  assert.equal(p.whenLabel(new Date(2026, 9, 16, 7, 5), now), "sex 7:05");
});

test("span: de/até pelas esperas, passando da meia-noite", () => {
  const acts = [{ type: "device", device_id: "d", capability: "power", value: true }, { type: "delay", minutes: 270 }, { type: "device", device_id: "d", capability: "power", value: false }];
  const s = p.span(time("20:00"), acts, null);
  assert.equal(p.fromMin(s.start), "20:00");
  assert.equal(p.fromMin(s.end), "0:30");
  assert.equal(p.span(time("20:00"), [], null).end, null);
});

test("quem usa o aparelho", () => {
  const a = auto({ type: "device", device_id: "tv", capability: "power", to: true });
  assert.equal(p.automationUsesDevice(a, "tv"), true);
  assert.equal(p.automationUsesDevice(a, "luz"), false);
  assert.equal(p.automationUsesDevice(auto(time("7:00"), { conditions: [{ type: "device_is", device_id: "luz", capability: "power", value: true }] }), "luz"), true);
  assert.equal(p.routineUsesDevice({ actions: [{ type: "device", device_id: "luz", capability: "power" }] }, "luz"), true);
});
