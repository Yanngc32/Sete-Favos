// Contas da lista de Automações sem React: próxima execução ("próxima hoje 18:30"), faixa de/até de uma
// automação por horário (liga → espera → desliga) e quem usa um aparelho (filtro ?aparelho=).
// Só importa tipos: roda no `npm test` (node --experimental-strip-types).
import type { Action, Automation, Condition, Routine, Trigger } from "../../lib/types";

export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
}

const DAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Segunda = 0 … domingo = 6 (mesma conta do modelo). */
export const dayIdx = (d: Date) => (d.getDay() + 6) % 7;

/** "06:50" → 410 (minutos do dia). */
export function toMin(at: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 410 → "6:50" (passa da meia-noite volta pro começo do dia). */
export function fromMin(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Minuto do dia em que o gatilho dispara (sol: horário de hoje + folga). Sem horário conhecido: null. */
export function triggerMinute(t: Trigger, sun: SunTimes | null): number | null {
  if (t.type === "time") return toMin(t.at);
  if (t.type === "sun") {
    const base = sun ? toMin((t.event === "sunrise" ? sun.sunrise : sun.sunset) ?? "") : null;
    return base === null ? null : base + t.offset;
  }
  return null;
}

/** Próxima vez que a automação roda sozinha (só horário e sol), olhando 8 dias pra frente. */
export function nextRun(a: Pick<Automation, "trigger">, now: Date, sun: SunTimes | null): Date | null {
  const t = a.trigger;
  if (t.type !== "time" && t.type !== "sun") return null;
  const min = triggerMinute(t, sun);
  if (min === null || !t.days.length) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let d = 0; d <= 7; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (!t.days.includes(dayIdx(day))) continue;
    if (d === 0 && min <= nowMin) continue;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(min / 60), min % 60);
  }
  return null;
}

/** A primeira entre as ativas e completas. */
export function nextOf(list: Automation[], now: Date, sun: SunTimes | null): { a: Automation; at: Date } | null {
  let best: { a: Automation; at: Date } | null = null;
  for (const a of list) {
    if (!a.enabled || a.incomplete) continue;
    const at = nextRun(a, now, sun);
    if (at && (!best || at < best.at)) best = { a, at };
  }
  return best;
}

/** "hoje 18:30" · "amanhã 7:00" · "sex 7:00". */
export function whenLabel(at: Date, now: Date): string {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayA = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const diff = Math.round((dayA - day0) / 86_400_000);
  const hm = fromMin(at.getHours() * 60 + at.getMinutes());
  if (diff === 0) return `hoje ${hm}`;
  if (diff === 1) return `amanhã ${hm}`;
  return `${DAY_SHORT[dayIdx(at)]} ${hm}`;
}

/** Soma das esperas das ações (min). Liga · espera 4 h 30 · desliga = 270. */
export function delayTotal(actions: Action[]): number {
  return actions.reduce((s, a) => s + (a.type === "delay" ? a.minutes : 0), 0);
}

/** Faixa de/até: começa no gatilho e acaba depois das esperas. Sem espera: só o início. */
export function span(t: Trigger, actions: Action[], sun: SunTimes | null): { start: number | null; end: number | null } {
  const start = triggerMinute(t, sun);
  const wait = delayTotal(actions);
  return { start, end: start !== null && wait > 0 ? start + wait : null };
}

const actsUse = (acts: Action[], id: string) => acts.some((a) => a.type === "device" && a.device_id === id);
const condUse = (cs: Condition[], id: string) => cs.some((c) => c.type === "device_is" && c.device_id === id);

/** A automação mexe no aparelho, depende dele ou dispara por ele. */
export function automationUsesDevice(a: Pick<Automation, "trigger" | "conditions" | "actions">, id: string): boolean {
  return (a.trigger.type === "device" && a.trigger.device_id === id) || condUse(a.conditions, id) || actsUse(a.actions, id);
}

export function routineUsesDevice(r: Pick<Routine, "actions">, id: string): boolean {
  return actsUse(r.actions, id);
}
