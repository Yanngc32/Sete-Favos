// "Horários" do aparelho: automações com gatilho de hora (ou de sol) que mexem nele, no formato de/até do mock.
// O "até" sai das ações: liga às 18:30, espera 4 h 30, desliga → "das 18:30 até 23:00".
import { expandActions, REMOTE_KEY, remoteLabel } from "@/lib/actions";
import type { Action, Automation, Device } from "@/lib/types";
import { describe } from "./useControl";

const DAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Todos os dias", "Seg a sex", "Sáb e dom", "Seg, qua e sex" (dias 0 = segunda). */
export function daysText(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7 || d.length === 0) return "Todos os dias";
  const is = (xs: number[]) => d.length === xs.length && d.every((x, i) => x === xs[i]);
  if (is([0, 1, 2, 3, 4])) return "Seg a sex";
  if (is([5, 6])) return "Sáb e dom";
  if (d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return cap1(`${DAY_SHORT[d[0]]} a ${DAY_SHORT[d[d.length - 1]]}`);
  const names = d.map((x) => DAY_SHORT[x]);
  return cap1(names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);
}

/** "06:50" → "6:50" */
export const clock = (at: string) => {
  const [h, m] = at.split(":");
  return `${Number(h)}:${m}`;
};

function addMinutes(at: string, minutes: number): string {
  const [h, m] = at.split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const span = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m} min`);

export interface Slot {
  /** Rótulo pequeno de cima ("das", "do", "às"). */
  label: string;
  /** Valor grande ("18:30") ou palavra ("pôr do sol"). */
  value: string;
  word?: boolean;
}

export interface Schedule {
  automation: Automation;
  days: string;
  from: Slot;
  to: Slot;
}

/** O que a ação faz no aparelho, curto: "liga", "desliga", "22 °C". */
function verb(device: Device, a: Extract<Action, { type: "device" }>): string {
  const id = a.capability ?? "";
  if (id === "power") return a.value ? "liga" : "desliga";
  if (id === REMOTE_KEY) return `aperta ${remoteLabel(String(a.value ?? ""))}`;
  const c = device.capabilities.find((x) => x.id === id);
  if (a.value == null || c?.type === "action") return (c?.label ?? id).toLowerCase();
  return describe(device, id, a.value);
}

export function schedulesOf(device: Device, automations: Automation[]): Schedule[] {
  const out: Schedule[] = [];
  for (const auto of automations) {
    const t = auto.trigger;
    if (t.type !== "time" && t.type !== "sun") continue;
    // Minuto (desde o gatilho) de cada ação que mexe neste aparelho.
    let wait = 0;
    const mine: { at: number; a: Extract<Action, { type: "device" }> }[] = [];
    // Cada ajuste conta (liga + 23 °C na mesma ação = mesmo minuto).
    for (const a of expandActions(auto.actions, [device])) {
      if (a.type === "delay") wait += a.minutes;
      else if (a.type === "device" && a.device_id === device.id) mine.push({ at: wait, a });
    }
    if (!mine.length) continue;
    const first = mine[0];
    const last = mine[mine.length - 1];
    const ranged = mine.length > 1 && last.at > first.at;

    const from: Slot =
      t.type === "sun"
        ? { label: ranged ? "do" : "no", value: `${t.event === "sunset" ? "pôr do sol" : "nascer do sol"}${offsetText(t.offset + first.at)}`, word: true }
        : { label: ranged ? "das" : "às", value: addMinutes(t.at, first.at) };
    const to: Slot = ranged
      ? t.type === "time"
        ? { label: "até", value: addMinutes(t.at, last.at) }
        : { label: "até", value: `${span(last.at - first.at)} depois`, word: true }
      : { label: "faz", value: verb(device, first.a), word: true };
    out.push({ automation: auto, days: daysText(t.days), from, to });
  }
  // Ordem do dia: hora primeiro, sol no fim.
  return out.sort((a, b) => key(a) - key(b));
}

function offsetText(m: number): string {
  if (!m) return "";
  return ` ${m < 0 ? "−" : "+"}${span(Math.abs(m))}`;
}

function key(s: Schedule): number {
  const t = s.automation.trigger;
  if (t.type !== "time") return 2000;
  const [h, m] = t.at.split(":").map(Number);
  return h * 60 + m;
}
