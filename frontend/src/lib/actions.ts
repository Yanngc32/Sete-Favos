// Ação de aparelho com vários ajustes ({ power: true, target_temp: 23, ac_mode: "cool" }).
// O formato antigo (capability + value) ainda pode chegar: tudo passa por actionValues().
// Só importa tipos: roda no `npm test` (node --experimental-strip-types).
import type { Action, Capability, Device } from "./types";

export type DeviceAct = Extract<Action, { type: "device" }>;

/** Chave especial de `values`: tecla do controle remoto (TV). */
export const REMOTE_KEY = "remote";
/** Mesmo limite do backend (MAX_VALUES). */
export const MAX_VALUES = 12;

/** Ajustes da ação, na ordem em que foram escolhidos. */
export function actionValues(a: DeviceAct): Record<string, unknown> {
  if (a.values) return a.values;
  if (a.capability) return { [a.capability]: a.value ?? null };
  return {};
}

/** Ordem em que a central executa: liga, ajustes, tecla, comando (Iniciar), desliga. */
export function orderedValues(values: Record<string, unknown>, device?: Device): [string, unknown][] {
  const rank = ([k, v]: [string, unknown]) => {
    if (k === "power") return v === false ? 4 : 0;
    if (k === REMOTE_KEY) return 2;
    const c = device?.capabilities.find((x) => x.id === k);
    return (c ? c.type === "action" : v == null) ? 3 : 1;
  };
  return Object.entries(values)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map((x) => x.e);
}

/** Cada ajuste vira uma ação de um ajuste só (na ordem de execução): frase, horários e contagens usam isto. */
export function expandActions(actions: Action[], devices: Device[] = []): Action[] {
  const out: Action[] = [];
  for (const a of actions) {
    if (a.type !== "device") {
      out.push(a);
      continue;
    }
    const d = devices.find((x) => x.id === a.device_id);
    const entries = orderedValues(actionValues(a), d);
    if (!entries.length) out.push({ type: "device", device_id: a.device_id, capability: "", value: undefined });
    for (const [capability, value] of entries) out.push({ type: "device", device_id: a.device_id, capability, value });
  }
  return out;
}

/** O que dá pra pôr numa ação: capacidades graváveis (sem texto livre) e a tecla do controle. */
export function writableCaps(d: Device): Capability[] {
  const caps = d.capabilities.filter((c) => !c.readonly && c.type !== "text");
  if (d.remote?.length)
    caps.push({ id: REMOTE_KEY, type: "enum", label: "Tecla do controle", readonly: false, min: null, max: null, step: null, unit: null,
      options: d.remote.map((k) => ({ value: k, label: remoteLabel(k) })) });
  return caps;
}

const REMOTE_LABELS: Record<string, string> = {
  UP: "Cima", DOWN: "Baixo", LEFT: "Esquerda", RIGHT: "Direita", ENTER: "OK", BACK: "Voltar", HOME: "Início",
  MENU: "Menu", EXIT: "Sair", INFO: "Info", PLAY: "Play", PAUSE: "Pausa", VOLUMEUP: "Volume +",
  VOLUMEDOWN: "Volume −", CHANNELUP: "Canal +", CHANNELDOWN: "Canal −", MUTE: "Mudo", POWER: "Liga/desliga",
};
export const remoteLabel = (k: string) => REMOTE_LABELS[k] ?? k;

function clampNum(c: Capability, v: number): number {
  let n = v;
  if (c.min != null) n = Math.max(c.min, n);
  if (c.max != null) n = Math.min(c.max, n);
  return c.type === "int" ? Math.round(n) : n;
}

/** Valor inicial de um ajuste novo: o estado de agora quando faz sentido, senão algo útil. */
export function initialValue(c: Capability, d: Device): unknown {
  const cur = d.state[c.id];
  switch (c.type) {
    case "action":
      return null;
    case "bool":
      return c.id === "power" ? true : typeof cur === "boolean" ? !cur : true;
    case "enum":
      if (c.id === REMOTE_KEY) return c.options?.some((o) => o.value === "HOME") ? "HOME" : (c.options?.[0]?.value ?? null);
      return c.options?.some((o) => o.value === cur) ? cur : (c.options?.[0]?.value ?? null);
    case "int":
    case "float":
      if (typeof cur === "number") return clampNum(c, cur);
      if (c.id === "target_temp") return clampNum(c, 23);
      return clampNum(c, c.max != null && c.min != null ? (c.min + c.max) / 2 : (c.min ?? 0));
    case "color":
      return typeof cur === "string" && /^#[0-9a-f]{6}$/i.test(cur) ? cur.toLowerCase() : "#ffffff";
    default:
      return null;
  }
}

/** Primeiro ajuste de um card novo: liga (se tiver), senão o primeiro comando ("Iniciar"), senão o primeiro. */
export function firstValues(d: Device): Record<string, unknown> {
  const caps = writableCaps(d);
  const c = caps.find((x) => x.id === "power") ?? caps.find((x) => x.type === "action") ?? caps[0];
  return c ? { [c.id]: initialValue(c, d) } : {};
}

/** "Igual a agora": o estado atual do aparelho. Desligado = só desliga (o resto não vale). */
export function valuesFromState(d: Device): Record<string, unknown> {
  const caps = writableCaps(d).filter((c) => c.type !== "action" && c.id !== REMOTE_KEY);
  const out: Record<string, unknown> = {};
  if (caps.some((c) => c.id === "power") && d.state.power === false) return { power: false };
  for (const c of caps) {
    const v = d.state[c.id];
    if (v === undefined || v === null) continue;
    if (c.type === "enum" && !c.options?.some((o) => o.value === v)) continue;
    if ((c.type === "int" || c.type === "float") && typeof v === "number") out[c.id] = clampNum(c, v);
    else if (c.type === "bool" && typeof v === "boolean") out[c.id] = v;
    else if (c.type === "color" && typeof v === "string") out[c.id] = v.toLowerCase();
    else if (c.type === "enum") out[c.id] = v;
  }
  return out;
}

export interface Preset {
  id: string;
  label: string;
  values: Record<string, unknown>;
}

function pickOption(c: Capability | undefined, prefer: string[]): string | undefined {
  if (!c?.options?.length) return undefined;
  for (const p of prefer) if (c.options.some((o) => o.value === p)) return p;
  return undefined;
}

/** Atalhos por tipo. Só entra o que o aparelho tem (e valor que ele aceita). */
export function presetsFor(d: Device): Preset[] {
  const caps = new Map(writableCaps(d).map((c) => [c.id, c]));
  const has = (id: string) => caps.has(id);
  const build = (id: string, label: string, raw: Record<string, unknown | undefined>): Preset | null => {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const c = caps.get(k);
      if (!c || v === undefined) continue;
      values[k] = typeof v === "number" ? clampNum(c, v) : v;
    }
    return Object.keys(values).length ? { id, label, values } : null;
  };
  const out: (Preset | null)[] = [];
  const kind = d.kind;
  if (kind === "light") {
    out.push(build("full", "Acesa 100%", { power: true, brightness: has("brightness") ? 100 : undefined }));
    if (has("brightness")) out.push(build("dim", "Meia-luz quente", { power: true, brightness: 25, color_temp: 0 }));
    if (has("brightness") && has("color_temp")) out.push(build("read", "Leitura", { power: true, brightness: 80, color_temp: 70 }));
  } else if (kind === "ac") {
    const cool = has("ac_mode") ? pickOption(caps.get("ac_mode"), ["cool"]) : undefined;
    out.push(build("cold", "Gelar rápido", { power: true, target_temp: 18, ac_mode: cool, fan_speed: pickOption(caps.get("fan_speed"), ["high", "max"]) }));
    out.push(build("sleep", "Para dormir", { power: true, target_temp: 24, ac_mode: cool, fan_speed: pickOption(caps.get("fan_speed"), ["silent", "low", "auto"]) }));
  } else if (kind === "tv") {
    out.push(build("watch", "Assistir", { power: true, volume: has("volume") ? 20 : undefined, muted: has("muted") ? false : undefined }));
    if (has("muted")) out.push(build("mute", "Silenciar", { muted: true }));
  } else if (kind === "vacuum") {
    const fan = caps.get("fan_power");
    if (has("start")) out.push(build("clean", "Limpar", { start: null }));
    if (has("start") && fan?.options && fan.options.length > 1)
      out.push(build("deep", `Limpar no ${fan.options[fan.options.length - 1].label}`, { fan_power: fan.options[fan.options.length - 1].value, start: null }));
    if (has("dock")) out.push(build("dock", "Voltar à base", { dock: null }));
  } else if (kind === "switch") {
    const keys = [...caps.keys()].filter((k) => /^switch_\d$/.test(k));
    if (keys.length > 1) out.push(build("all", "Todas as teclas", Object.fromEntries(keys.map((k) => [k, true]))));
  }
  if (has("power") && kind !== "vacuum") out.push(build("off", kind === "light" ? "Apagar" : "Desligar", { power: false }));
  return out.filter((p): p is Preset => p !== null);
}

/** Ajustes iguais (para marcar o atalho escolhido). */
export function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && a[k] === b[k]);
}
