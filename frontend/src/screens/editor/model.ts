// Rascunho do editor: o que está sendo montado, opções vindas das capacidades e validação no campo.
import { actionValues, MAX_VALUES, REMOTE_KEY, writableCaps } from "@/lib/actions";
import { kindIcon } from "@/lib/devices";
import type { Action, Automation, Capability, Condition, Device, Routine, Trigger, VirtualObject } from "@/lib/types";
import { stateValueText } from "@/screens/automacoes/frase";
import { virtualIcon } from "@/screens/automacoes/icons";
import type { PickOpt } from "./Picker";

export type ItemKind = "routine" | "automation";

/** Itens de lista ganham uma chave estável (_k) para reordenar e animar. */
export type DAction = Action & { _k: string };
export type DCondition = Condition & { _k: string };

export interface Draft {
  kind: ItemKind;
  name: string;
  trigger: Trigger | null;
  conditions: DCondition[];
  actions: DAction[];
  enabled: boolean;
  pinned: boolean;
}

let seq = 0;
export const key = () => `k${++seq}`;
const withKey = <T extends object>(x: T) => ({ ...structuredClone(x), _k: key() });

export function fromRoutine(r: Routine): Draft {
  return { kind: "routine", name: r.name, trigger: null, conditions: [], actions: r.actions.map(withKey), enabled: true, pinned: r.pinned };
}

export function fromAutomation(a: Automation): Draft {
  return {
    kind: "automation",
    name: a.name,
    trigger: structuredClone(a.trigger),
    conditions: a.conditions.map(withKey),
    actions: a.actions.map(withKey),
    enabled: a.enabled,
    pinned: false,
  };
}

export function blank(kind: ItemKind): Draft {
  return { kind, name: "", trigger: null, conditions: [], actions: [], enabled: true, pinned: false };
}

const strip = <T extends { _k: string }>({ _k, ...rest }: T) => rest;

export function routineBody(d: Draft) {
  return { name: d.name.trim(), actions: d.actions.map(strip) as Action[], pinned: d.pinned };
}

export function automationBody(d: Draft) {
  return {
    name: d.name.trim(),
    enabled: d.enabled,
    trigger: d.trigger as Trigger,
    conditions: d.conditions.map(strip) as Condition[],
    actions: d.actions.map(strip) as Action[],
  };
}

export function snapshot(d: Draft): string {
  return JSON.stringify(d.kind === "routine" ? routineBody(d) : { ...automationBody(d), trigger: d.trigger });
}

/** O que mudou, para o "Descartar alterações?": "a hora e uma ação". */
export function changesText(d: Draft, base: Draft): string {
  const parts: string[] = [];
  if (d.name.trim() !== base.name.trim()) parts.push("o nome");
  if (JSON.stringify(d.trigger) !== JSON.stringify(base.trigger)) {
    const a = d.trigger;
    const b = base.trigger;
    if (a?.type === "time" && b?.type === "time") {
      if (a.at !== b.at) parts.push("a hora");
      if (JSON.stringify(a.days) !== JSON.stringify(b.days)) parts.push("os dias");
    } else parts.push("o gatilho");
  }
  const cs = (x: Draft) => JSON.stringify(x.conditions.map(strip));
  if (cs(d) !== cs(base)) parts.push("as condições");
  const da = d.actions.map((x) => JSON.stringify(strip(x)));
  const ba = base.actions.map((x) => JSON.stringify(strip(x)));
  if (da.join() !== ba.join()) {
    const sameSet = da.length === ba.length && [...da].sort().join() === [...ba].sort().join();
    if (sameSet) parts.push("a ordem das ações");
    else {
      const n = Math.max(da.length, ba.length);
      let changed = 0;
      for (let i = 0; i < n; i++) if (da[i] !== ba[i]) changed++;
      parts.push(changed === 1 ? "uma ação" : "as ações");
    }
  }
  if (!parts.length) return "Você fez mudanças. Se sair agora, elas se perdem.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
  return `Você mudou ${list}. Se sair agora, isso se perde.`;
}

// Capacidades → opções ----------------------------------------------------------

export interface Lookup {
  devices: Device[];
  virtuals: VirtualObject[];
  routines: Routine[];
}

const byRoomName = (a: Device, b: Device) =>
  (a.room ?? "~").localeCompare(b.room ?? "~", "pt-BR") || a.name.localeCompare(b.name, "pt-BR");

export function deviceOptions(devices: Device[], filter?: (d: Device) => boolean): PickOpt[] {
  return [...devices]
    .filter((d) => !filter || filter(d))
    .sort(byRoomName)
    .map((d) => {
      const off = d.online === false;
      const room = d.room ?? "Sem cômodo";
      return {
        value: `d:${d.id}`,
        label: off ? `${d.name} (sem resposta)` : d.name,
        short: d.name,
        sub: off ? `${room} · dá pra escolher mesmo assim` : room,
        Icon: kindIcon(d.kind),
        off,
        group: "Aparelhos",
      };
    });
}

export function virtualOptions(virtuals: VirtualObject[]): PickOpt[] {
  return virtuals.map((v) => ({
    value: `v:${v.id}`,
    label: v.name,
    sub: "Objeto virtual",
    Icon: virtualIcon(v.name),
    group: "Objetos virtuais",
  }));
}

/** Opção do aparelho/objeto que sumiu: aparece riscada para o erro ficar no campo. */
export function missingOption(value: string, name: string): PickOpt {
  return { value, label: `${name} (removido)`, sub: "Escolha outro", off: true };
}

/** Capacidades que dá pra observar (gatilho "muda", condição "está"). */
export function stateCaps(d: Device): Capability[] {
  return d.capabilities.filter((c) => c.type === "bool" || c.type === "enum" || c.type === "int" || c.type === "float");
}

/** Capacidades que servem de condição (sem números: igualdade exata não faz sentido). */
export function conditionCaps(d: Device): Capability[] {
  return d.capabilities.filter((c) => c.type === "bool" || c.type === "enum");
}

export function defaultValue(c: Capability, d?: Device): unknown {
  switch (c.type) {
    case "bool":
      return true;
    case "enum":
      return c.options?.[0]?.value ?? null;
    case "int":
    case "float": {
      const cur = d?.state[c.id];
      if (typeof cur === "number") return cur;
      return c.min ?? 0;
    }
    case "color":
      return "#ffffff";
    case "action":
      return null;
    default:
      return "";
  }
}

export function boolOptions(fem = false): PickOpt[] {
  return [
    { value: "true", label: fem ? "ligada" : "ligado" },
    { value: "false", label: fem ? "desligada" : "desligado" },
  ];
}

export function enumOptions(c: Capability): PickOpt[] {
  return (c.options ?? []).map((o) => ({ value: o.value, label: o.label }));
}

/** Estados de condição de um aparelho: "está ligado", "Modo: Frio". */
export function conditionStateOptions(d: Device): PickOpt[] {
  const out: PickOpt[] = [];
  for (const c of conditionCaps(d)) {
    if (c.type === "bool") {
      for (const v of [true, false]) {
        const txt = stateValueText(d, c.id, v);
        out.push({ value: `${c.id}|${v}`, label: c.id === "power" ? `está ${txt}` : `${c.label}: ${txt}` });
      }
    } else {
      for (const o of c.options ?? []) out.push({ value: `${c.id}|${JSON.stringify(o.value)}`, label: `${c.label}: ${o.label}` });
    }
  }
  return out;
}

export function decodeState(v: string): { capability: string; value: unknown } {
  const i = v.indexOf("|");
  const capability = v.slice(0, i);
  const raw = v.slice(i + 1);
  return { capability, value: raw === "true" ? true : raw === "false" ? false : JSON.parse(raw) };
}

export const encodeState = (capability: string, value: unknown) =>
  capability ? `${capability}|${typeof value === "boolean" ? String(value) : JSON.stringify(value)}` : "";

// Validação ---------------------------------------------------------------------

export interface Errors {
  name?: string;
  trigger?: string;
  conditions: Record<string, string>;
  actions: Record<string, string>;
  noActions?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkNumber(c: Capability, v: unknown): string | null {
  if (typeof v !== "number" || Number.isNaN(v)) return "Escolha o valor";
  if ((c.min != null && v < c.min) || (c.max != null && v > c.max)) return `Use de ${c.min ?? "…"} a ${c.max ?? "…"}`;
  return null;
}

function checkValue(c: Capability, v: unknown): string | null {
  if (c.type === "int" || c.type === "float") return checkNumber(c, v);
  if (c.type === "bool") return typeof v === "boolean" ? null : "Escolha o valor";
  if (c.type === "enum") return (c.options ?? []).some((o) => o.value === v) ? null : "Escolha o valor";
  if (c.type === "color") return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? null : "Escolha uma cor";
  return null;
}

export function validate(d: Draft, look: Lookup, selfId: string | null): Errors {
  const e: Errors = { conditions: {}, actions: {} };
  const dev = (id: string) => look.devices.find((x) => x.id === id);
  const vir = (id: string) => look.virtuals.find((x) => x.id === id);
  if (!d.name.trim()) e.name = "Dê um nome";

  if (d.kind === "automation") {
    const t = d.trigger;
    if (!t) e.trigger = "Escolha quando roda";
    else if (t.type === "time") {
      if (!HHMM.test(t.at)) e.trigger = "Escolha a hora";
      else if (!t.days.length) e.trigger = "Escolha pelo menos um dia";
    } else if (t.type === "virtual") {
      if (!vir(t.virtual_id)) e.trigger = "Escolha o objeto virtual";
    } else if (t.type === "sun") {
      if (!t.days.length) e.trigger = "Escolha pelo menos um dia";
    } else {
      const x = dev(t.device_id);
      const c = x?.capabilities.find((c) => c.id === t.capability);
      if (!x) e.trigger = t.device_id ? "Esse aparelho foi removido. Escolha outro" : "Escolha o aparelho";
      else if (!c) e.trigger = "Escolha o que muda";
      else e.trigger = checkValue(c, t.to) ?? undefined;
    }

    for (const c of d.conditions) {
      let msg: string | null = null;
      if (c.type === "time_between") {
        if (!HHMM.test(c.start) || !HHMM.test(c.end)) msg = "Escolha os dois horários";
        else if (c.start === c.end) msg = "Os horários precisam ser diferentes";
      } else if (c.type === "weekday") {
        if (!c.days.length) msg = "Escolha pelo menos um dia";
      } else if (c.type === "virtual_is") {
        if (!c.virtual_id) msg = "Escolha o objeto ou aparelho";
        else if (!vir(c.virtual_id)) msg = "Esse objeto foi removido. Escolha outro";
      } else {
        const x = dev(c.device_id);
        if (!c.device_id) msg = "Escolha o objeto ou aparelho";
        else if (!x) msg = "Esse aparelho foi removido. Escolha outro";
        else if (!x.capabilities.some((k) => k.id === c.capability)) msg = "Escolha o estado";
      }
      if (msg) e.conditions[c._k] = msg;
    }
  }

  if (!d.actions.length) e.noActions = "Adicione pelo menos uma ação";
  for (const a of d.actions) {
    let msg: string | null = null;
    if (a.type === "device") {
      const x = dev(a.device_id);
      if (!a.device_id) msg = "Escolha o aparelho";
      else if (!x) msg = "Esse aparelho foi removido. Escolha outro";
      else msg = checkDeviceValues(x, actionValues(a));
    } else if (a.type === "virtual") {
      if (!a.virtual_id) msg = "Escolha o objeto";
      else if (!vir(a.virtual_id)) msg = "Esse objeto foi removido. Escolha outro";
    } else if (a.type === "delay") {
      if (!Number.isInteger(a.minutes) || a.minutes < 1 || a.minutes > 120) msg = "Use de 1 a 120 minutos";
    } else {
      if (!a.routine_id) msg = "Escolha a rotina";
      else if (!look.routines.some((r) => r.id === a.routine_id)) msg = "Essa rotina foi removida. Escolha outra";
      else if (d.kind === "routine" && a.routine_id === selfId) msg = "Uma rotina não pode chamar ela mesma";
    }
    if (msg) e.actions[a._k] = msg;
  }
  return e;
}

/** Ajustes de uma ação de aparelho: cada um tem que existir e ter valor aceito. */
export function checkDeviceValues(d: Device, values: Record<string, unknown>): string | null {
  const keys = Object.keys(values);
  if (!keys.length) return "Escolha pelo menos um ajuste";
  if (keys.length > MAX_VALUES) return `No máximo ${MAX_VALUES} ajustes por ação`;
  const caps = writableCaps(d);
  let commands = 0;
  for (const k of keys) {
    const c = caps.find((x) => x.id === k);
    if (!c) {
      const lost = d.capabilities.find((x) => x.id === k)?.label ?? (k === REMOTE_KEY ? "controle remoto" : k);
      return `${d.name} não tem mais ${lost.toLowerCase()}. Remova esse ajuste`;
    }
    if (c.type === "action") commands++;
    else {
      const err = checkValue(c, values[k]);
      if (err) return `${c.label}: ${err.charAt(0).toLowerCase()}${err.slice(1)}`;
    }
  }
  if (commands > 1) return "Escolha um comando só por ação (ex.: Iniciar)";
  if (REMOTE_KEY in values && values.power === false) return "A tecla do controle não funciona desligando a TV";
  return null;
}

export function hasErrors(e: Errors) {
  return !!(e.name || e.trigger || e.noActions || Object.keys(e.conditions).length || Object.keys(e.actions).length);
}

/** Primeira coisa que falta, para o motivo ao lado do Salvar. */
export function firstError(e: Errors): string | null {
  return e.trigger ?? e.noActions ?? Object.values(e.conditions)[0] ?? Object.values(e.actions)[0] ?? e.name ?? null;
}
