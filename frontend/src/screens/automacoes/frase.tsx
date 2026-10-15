// Frase-resumo legível de automações e rotinas, usada na lista (Automações) e no Editor.
// Monta pedaços (texto, nome em negrito, número tabular, seta "então") que viram texto de verdade:
// o leitor de tela lê a regra inteira.
import { Fragment } from "react";
import { cap, optionLabel } from "@/lib/devices";
import { int } from "@/lib/format";
import { expandActions, REMOTE_KEY, remoteLabel } from "@/lib/actions";
import type { Action, Condition, Device, Routine, Trigger, VirtualObject } from "@/lib/types";
import { colorName } from "@/screens/detalhe/colors";

export interface FraseCtx {
  devices: Device[];
  virtuals: VirtualObject[];
  routines: Routine[];
  /** Texto de `incomplete` ("Incompleta: Ar do quarto foi removido"): dá o nome do aparelho que sumiu. */
  incomplete?: string | null;
}

export type Part =
  | string
  | { t: string; b?: boolean; num?: boolean; s?: boolean; muted?: boolean }
  | { arrow: true };

const NBSP = " ";
const DAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
export const WEEKDAYS = [0, 1, 2, 3, 4];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "06:50" → "6:50" */
export function hhmm(at: string): string {
  const [h, m] = at.split(":");
  return `${Number(h)}:${m}`;
}

function sameDays(a: number[], b: number[]) {
  const s = [...new Set(a)].sort();
  return s.length === b.length && s.every((d, i) => d === b[i]);
}

function joinList(items: string[], last = "e") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

/** "todo dia", "seg a sex", "sáb e dom", "seg, qua e sex" (minúsculo). */
export function daysPhrase(days: number[]): string {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "todo dia";
  if (sameDays(d, WEEKDAYS)) return "seg a sex";
  if (sameDays(d, [5, 6])) return "sáb e dom";
  const run = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run) return `${DAY_SHORT[d[0]]} a ${DAY_SHORT[d[d.length - 1]]}`;
  return joinList(d.map((x) => DAY_SHORT[x]));
}

function removedName(ctx: FraseCtx): string | null {
  const m = ctx.incomplete?.match(/Incompleta:\s*(.+?) foi removid[oa]/);
  return m ? m[1] : null;
}

function devPart(ctx: FraseCtx, id: string): Part {
  const d = ctx.devices.find((x) => x.id === id);
  if (d) return d.name;
  return { t: removedName(ctx) ?? "aparelho removido", s: true };
}

function virtualPart(ctx: FraseCtx, id: string): Part {
  const v = ctx.virtuals.find((x) => x.id === id);
  return v ? { t: v.name, b: true } : { t: "objeto removido", s: true };
}

const fem = (d: Device | undefined) => !!d && (d.kind === "light" || d.kind === "plug" || d.kind === "tv");

function numText(d: Device, capId: string, value: unknown): string {
  const c = cap(d, capId);
  const n = typeof value === "number" ? int.format(value) : String(value ?? "");
  const unit = c?.unit;
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n}${NBSP}${unit}`;
}

const warmCold = (v: number) => (v <= 33 ? "quente" : v >= 67 ? "fria" : "neutra");

const ACTION_VERB: Record<string, string> = {
  start: "inicia",
  pause: "pausa",
  dock: "volta à base",
  locate: "bipa",
  stop: "para",
};

/** Como uma ação muda o aparelho, no tom da frase: "liga", "a 10%", "em 23 °C", "modo Frio". */
export function valueParts(d: Device | undefined, capId: string, value: unknown): Part[] {
  if (!d) return [];
  if (capId === REMOTE_KEY) return [`aperta ${remoteLabel(String(value ?? ""))}`];
  const c = cap(d, capId);
  if (!c) return [capId];
  if (c.type === "action") return [ACTION_VERB[capId] ?? lower1(c.label)];
  if (capId === "power") return [value ? "liga" : "desliga"];
  const label = lower1(c.label);
  switch (c.type) {
    case "bool":
      if (capId === "muted") return [value ? "no mudo" : "com som"];
      return [`${label} ${value ? "ligado" : "desligado"}`];
    case "enum": {
      const opt = optionLabel(d, capId, value) ?? "";
      if (capId === "source") return [`no ${opt}`];
      if (capId === "ac_mode") return [`modo ${opt}`];
      return [`${label} ${lower1(opt)}`];
    }
    case "int":
    case "float": {
      if (typeof value !== "number") return [label];
      if (capId === "color_temp") return [warmCold(value)];
      if (capId === "brightness") return ["a ", { t: numText(d, capId, value), num: true }];
      if (capId === "target_temp") return ["em ", { t: numText(d, capId, value), num: true }];
      return [`${label} `, { t: numText(d, capId, value), num: true }];
    }
    case "color": {
      const name = typeof value === "string" ? colorName(value) : null;
      return [name ? `em ${lower1(name)}` : `cor ${String(value ?? "")}`];
    }
    default:
      return [`${label} “${String(value ?? "")}”`];
  }
}

/** "ligado" / "Frio" / "23 °C" — o valor sozinho (gatilho "vira", condição "está"). */
export function stateValueText(d: Device | undefined, capId: string, value: unknown): string {
  if (!d) return String(value ?? "");
  const c = cap(d, capId);
  if (!c) return String(value ?? "");
  if (c.type === "bool") {
    if (c.readonly && capId !== "power") return value ? "sim" : "não";
    const f = capId === "power" && fem(d);
    return value ? (f ? "ligada" : "ligado") : f ? "desligada" : "desligado";
  }
  if (c.type === "enum") return optionLabel(d, capId, value) ?? "";
  if (capId === "color_temp" && typeof value === "number") return `${value} (${warmCold(value)})`;
  if (c.type === "int" || c.type === "float") return numText(d, capId, value);
  return String(value ?? "");
}

// Celular: "chegar em casa", "começar a carregar"... no lugar de "em casa virar sim".
const PHONE_TRIGGER: Record<string, [string, string]> = {
  at_home: ["chegar em casa", "sair de casa"],
  charging: ["começar a carregar", "sair do carregador"],
};
const PHONE_STATE: Record<string, [string, string]> = {
  at_home: ["estiver em casa", "estiver fora de casa"],
  charging: ["estiver carregando", "estiver fora do carregador"],
};

// Gatilho -------------------------------------------------------------------

/** Folga do gatilho de sol: "15 min antes", "1 h depois", "na hora". */
export function sunOffsetText(m: number): string {
  if (m === 0) return "na hora";
  const a = Math.abs(m);
  const t = a % 60 === 0 ? `${a / 60} h` : a > 60 ? `${Math.floor(a / 60)} h ${a % 60} min` : `${a} min`;
  return `${t} ${m < 0 ? "antes" : "depois"}`;
}


export function triggerParts(t: Trigger, ctx: FraseCtx): Part[] {
  if (t.type === "time") return [`${cap1(daysPhrase(t.days))} às `, { t: hhmm(t.at), num: true }];
  if (t.type === "virtual") return ["Quando ", virtualPart(ctx, t.virtual_id), ` ${t.to ? "ligar" : "desligar"}`];
  if (t.type === "sun") {
    const ev = t.event === "sunset" ? "pôr do sol" : "nascer do sol";
    const when = t.offset === 0 ? `No ${ev}` : `${cap1(sunOffsetText(t.offset))} do ${ev}`;
    return [t.days.length === 7 ? when : `${cap1(daysPhrase(t.days))}, ${lower1(when)}`];
  }
  const d = ctx.devices.find((x) => x.id === t.device_id);
  const c = d && cap(d, t.capability);
  const phone = d?.kind === "phone" && PHONE_TRIGGER[t.capability];
  if (phone) return ["Quando ", devPart(ctx, t.device_id), ` ${phone[t.to ? 0 : 1]}`];
  if (t.capability === "power" && c?.type === "bool")
    return ["Quando ", devPart(ctx, t.device_id), ` ${t.to ? "ligar" : "desligar"}`];
  const what = c ? lower1(c.label) : t.capability;
  return ["Quando ", devPart(ctx, t.device_id), ` ${what} virar `, { t: stateValueText(d, t.capability, t.to), num: true }];
}

// Condições -----------------------------------------------------------------

function weekdayPhrase(days: number[]) {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "qualquer dia";
  if (sameDays(d, WEEKDAYS)) return "dia útil";
  if (sameDays(d, [5, 6])) return "fim de semana";
  return joinList(d.map((x) => DAY_SHORT[x]), "ou");
}

function conditionParts(c: Condition, ctx: FraseCtx, prev: Condition | undefined): Part[] {
  switch (c.type) {
    case "virtual_is":
      return [virtualPart(ctx, c.virtual_id), ` estiver ${c.value ? "ligado" : "desligado"}`];
    case "device_is": {
      const d = ctx.devices.find((x) => x.id === c.device_id);
      const cp = d && cap(d, c.capability);
      const phone = d?.kind === "phone" && PHONE_STATE[c.capability];
      if (phone) return [devPart(ctx, c.device_id), ` ${phone[c.value ? 0 : 1]}`];
      if (cp?.type === "bool" && c.capability === "power")
        return [devPart(ctx, c.device_id), ` estiver ${stateValueText(d, c.capability, c.value)}`];
      const what = cp ? lower1(cp.label) : c.capability;
      return [devPart(ctx, c.device_id), ` com ${what} `, { t: stateValueText(d, c.capability, c.value), num: true }];
    }
    case "weekday":
      return [`for ${weekdayPhrase(c.days)}`];
    case "time_between":
      return [prev?.type === "weekday" ? "entre " : "for entre ", { t: hhmm(c.start), num: true }, " e ", { t: hhmm(c.end), num: true }];
  }
}

function conditionsParts(conditions: Condition[], ctx: FraseCtx): Part[] {
  // "dia útil" + "entre 9:00 e 17:00" viram uma cláusula só.
  const clauses: Part[][] = [];
  conditions.forEach((c, i) => {
    const parts = conditionParts(c, ctx, conditions[i - 1]);
    if (c.type === "time_between" && conditions[i - 1]?.type === "weekday" && clauses.length) {
      clauses[clauses.length - 1].push(" ", ...parts);
    } else clauses.push(parts);
  });
  const out: Part[] = [];
  clauses.forEach((cl, i) => {
    if (i > 0) out.push(i === clauses.length - 1 ? " e " : ", ");
    out.push(...cl);
  });
  return out;
}

// Ações ---------------------------------------------------------------------

function addMinutes(at: string, minutes: number) {
  const [h, m] = at.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Ações numa frase: "Ar do quarto em 23 °C, modo Frio", "Tomada da cafeteira liga; às 7:30 desliga". */
export function actionsParts(raw: Action[], ctx: FraseCtx, startAt?: string): Part[] {
  // Ação com vários ajustes = vários ajustes seguidos do mesmo aparelho ("Ar liga, em 23 °C, modo Frio").
  const actions = expandActions(raw, ctx.devices);
  const out: Part[] = [];
  let lastDevice: string | null = null;
  let afterDelay = false;
  let elapsed = 0;
  let lastCap: string | null = null;

  const sep = (s: string) => {
    if (out.length) out.push(s);
  };

  for (const a of actions) {
    if (a.type === "delay") {
      elapsed += a.minutes;
      sep("; ");
      if (startAt) out.push("às ", { t: addMinutes(startAt, elapsed), num: true });
      else out.push("depois de ", { t: `${a.minutes}${NBSP}min`, num: true });
      afterDelay = true;
      continue;
    }
    if (a.type === "device") {
      if (!a.device_id) continue;
      const d = ctx.devices.find((x) => x.id === a.device_id);
      if (!a.capability) continue;
      const parts = valueParts(d, a.capability, a.value);
      if (lastDevice === a.device_id) {
        if (afterDelay) out.push(" ");
        else out.push(a.capability === "color_temp" && lastCap === "brightness" ? " " : ", ");
        out.push(...parts);
      } else {
        if (afterDelay) out.push(" ");
        else sep(", ");
        out.push(devPart(ctx, a.device_id), " ", ...parts);
      }
      lastDevice = a.device_id;
      lastCap = a.capability;
      afterDelay = false;
      continue;
    }
    if ((a.type === "virtual" && !a.virtual_id) || (a.type === "routine" && !a.routine_id)) continue;
    if (afterDelay) out.push(" ");
    else sep(", ");
    if (a.type === "virtual") {
      out.push(virtualPart(ctx, a.virtual_id), a.value ? " liga" : " desliga");
    } else if (a.type === "routine") {
      const r = ctx.routines.find((x) => x.id === a.routine_id);
      out.push("roda ", r ? { t: r.name, b: true } : { t: "rotina removida", s: true });
    }
    lastDevice = null;
    lastCap = null;
    afterDelay = false;
  }
  return out;
}

/** Frase inteira de uma automação. Pedaços que faltam (editor) viram "…". */
export function automationParts(
  a: { trigger: Trigger | null; conditions: Condition[]; actions: Action[] },
  ctx: FraseCtx,
): Part[] {
  const out: Part[] = [];
  if (a.trigger) out.push(...triggerParts(a.trigger, ctx));
  else out.push({ t: "Quando…", muted: true });
  if (a.conditions.length) {
    out.push(a.trigger?.type === "time" || a.trigger?.type === "sun" ? ", se " : " e ", ...conditionsParts(a.conditions, ctx));
  }
  out.push(" ", { arrow: true }, " ");
  const acts = actionsParts(a.actions, ctx, a.trigger?.type === "time" ? a.trigger.at : undefined);
  if (acts.length) out.push(...acts);
  else out.push({ t: "…", muted: true });
  return out;
}

/** Rodapé do editor de rotina: "Ao executar → Luz da sala desliga, …". */
export function routineSentenceParts(actions: Action[], ctx: FraseCtx): Part[] {
  const acts = actionsParts(actions, ctx);
  return ["Ao executar ", { arrow: true }, " ", ...(acts.length ? acts : [{ t: "…", muted: true }])];
}

/** Resumo curto da rotina na lista: "Desliga 4 aparelhos · Robô H50 Pro inicia". */
export function routineSummaryParts(raw: Action[], ctx: FraseCtx): Part[] {
  const actions = expandActions(raw, ctx.devices);
  const offs = actions.filter((a) => a.type === "device" && a.capability === "power" && a.value === false);
  const ons = actions.filter((a) => a.type === "device" && a.capability === "power" && a.value === true);
  const items: Part[][] = [];
  const grouped = new Set<Action>();
  if (offs.length >= 3) {
    items.push([`Desliga ${offs.length} aparelhos`]);
    offs.forEach((a) => grouped.add(a));
  }
  if (ons.length >= 3) {
    items.push([`Liga ${ons.length} aparelhos`]);
    ons.forEach((a) => grouped.add(a));
  }
  // O resto: uma ação por item, juntando ajustes seguidos do mesmo aparelho.
  let run: Action[] = [];
  const flush = () => {
    if (run.length) items.push(actionsParts(run, ctx));
    run = [];
  };
  for (const a of actions) {
    if (grouped.has(a)) continue;
    const prev = run[run.length - 1];
    if (prev && a.type === "device" && prev.type === "device" && prev.device_id === a.device_id) run.push(a);
    else {
      flush();
      if (a.type === "delay") items.push([`espera ${a.minutes}${NBSP}min`]);
      else run.push(a);
    }
  }
  flush();
  const out: Part[] = [];
  items.forEach((it, i) => {
    if (i) out.push(" · ");
    out.push(...it);
  });
  if (out.length && typeof out[0] === "string") out[0] = cap1(out[0]);
  return out;
}

export function partsText(parts: Part[]): string {
  return parts.map((p) => (typeof p === "string" ? p : "arrow" in p ? "→" : p.t)).join("");
}

/** Renderiza a frase: nomes de objeto em negrito, números tabulares, "→" com "então" para leitor de tela. */
export function Frase({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        if ("arrow" in p)
          return (
            <Fragment key={i}>
              <span aria-hidden="true">→</span>
              <span className="sr">então</span>
            </Fragment>
          );
        if (p.b) return <b key={i}>{p.t}</b>;
        if (p.s) return <s key={i}>{p.t}</s>;
        if (p.muted) return <span key={i} className="muted">{p.t}</span>;
        if (p.num) return <span key={i} className="num">{p.t}</span>;
        return <Fragment key={i}>{p.t}</Fragment>;
      })}
    </>
  );
}
