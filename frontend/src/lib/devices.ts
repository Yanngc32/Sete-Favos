// O que as telas precisam saber de um aparelho: ícone do tipo, frase de estado, nível arrastável.
// O tipo nunca tem cor (DS Latão): só ícone + texto. Ligado = latão.
import { AirVent, CircuitBoard, Lightbulb, Plug, RobotVacuum, Smartphone, ToggleRight, Tv, type LucideIcon } from "lucide-react";
import type { Capability, Device, Kind } from "./types";
import { dec, int } from "./format";

const ICONS: Record<Kind, LucideIcon> = {
  light: Lightbulb,
  plug: Plug,
  switch: ToggleRight,
  ac: AirVent,
  tv: Tv,
  vacuum: RobotVacuum,
  phone: Smartphone,
  other: CircuitBoard,
};

export function kindIcon(kind: Kind) {
  return ICONS[kind] ?? CircuitBoard;
}

export const KIND_LABEL: Record<Kind, string> = {
  light: "Luz",
  plug: "Tomada",
  switch: "Interruptor",
  ac: "Ar",
  tv: "TV",
  vacuum: "Robô",
  phone: "Celular",
  other: "Outro",
};

/** Teclas do interruptor (switch_1..switch_6), na ordem. */
export function switchKeys(device: Device): Capability[] {
  return device.capabilities.filter((c) => /^switch_\d$/.test(c.id));
}

export function cap(device: Device, id: string): Capability | undefined {
  return device.capabilities.find((c) => c.id === id);
}

export function has(device: Device, id: string): boolean {
  return device.capabilities.some((c) => c.id === id);
}

export function optionLabel(device: Device, capId: string, value: unknown): string | null {
  const o = cap(device, capId)?.options?.find((x) => x.value === value);
  return o?.label ?? (value == null ? null : String(value));
}

/** Robô ativo (limpando/voltando) conta como "ligado" para o latão. */
export function isOn(device: Device): boolean {
  if (device.kind === "vacuum") return ["cleaning", "returning"].includes(String(device.state.vacuum_status));
  return device.state.power === true;
}

export function isOffline(device: Device): boolean {
  return device.online === false;
}

const VACUUM_STATUS: Record<string, string> = {
  docked: "Na base",
  cleaning: "Limpando",
  returning: "Voltando",
  paused: "Pausado",
  error: "Erro",
  idle: "Parado",
  charging: "Carregando",
};

export function vacuumStatus(device: Device): string {
  const raw = String(device.state.vacuum_status ?? "");
  return optionLabel(device, "vacuum_status", raw) ?? VACUUM_STATUS[raw] ?? "Sem status";
}

const warmCold = (pct: number) => (pct <= 33 ? "quente" : pct >= 67 ? "fria" : "neutra");

/**
 * Frase curta do estado, como nos cards: "Ligada · 70% · quente", "Desligado",
 * "Frio · 22 °C (ambiente 26 °C)", "Ligada · Netflix · vol 18", "Na base · 100% bateria".
 */
export function stateText(device: Device): string {
  const s = device.state;
  const fem = device.kind === "light" || device.kind === "plug" || device.kind === "tv";
  const off = fem ? "Desligada" : "Desligado";
  const on = fem ? "Ligada" : "Ligado";
  switch (device.kind) {
    case "light": {
      if (!s.power) return off;
      const parts = [on];
      if (typeof s.brightness === "number") parts.push(`${s.brightness}%`);
      if (typeof s.color_temp === "number") parts.push(warmCold(s.color_temp));
      return parts.join(" · ");
    }
    case "plug":
      if (!s.power) return off;
      return typeof s.power_w === "number" && s.power_w > 0 ? `${on} · ${int.format(s.power_w)} W` : on;
    case "switch": {
      if (!s.power) return off;
      const keys = switchKeys(device);
      const lit = keys.filter((k) => s[k.id] === true);
      if (!keys.length) return on;
      return lit.length === 1 ? `${on} · ${lit[0].label}` : `${on} · ${lit.length} de ${keys.length} teclas`;
    }
    case "ac": {
      if (!s.power) return off;
      const mode = optionLabel(device, "ac_mode", s.ac_mode);
      const target = typeof s.target_temp === "number" ? `${int.format(s.target_temp)} °C` : null;
      const room = typeof s.current_temp === "number" ? ` (ambiente ${int.format(s.current_temp)} °C)` : "";
      return [mode, target].filter(Boolean).join(" · ") + room;
    }
    case "tv": {
      if (!s.power) return off;
      const src = optionLabel(device, "source", s.source);
      const vol = s.muted ? "mudo" : typeof s.volume === "number" ? `vol ${s.volume}` : null;
      return [on, src, vol].filter(Boolean).join(" · ");
    }
    case "phone": {
      // "Em casa · 80% · carregando" / "A 2,3 km · 41%"
      const parts: string[] = [];
      if (s.at_home === true) parts.push("Em casa");
      else if (typeof s.distance_km === "number") parts.push(`A ${dec.format(s.distance_km)} km`);
      if (typeof s.battery === "number") parts.push(`${s.battery}%`);
      if (s.charging === true) parts.push("carregando");
      return parts.join(" · ");
    }
    case "vacuum": {
      const parts = [vacuumStatus(device)];
      if (typeof s.battery === "number") parts.push(`${s.battery}% bateria`);
      return parts.join(" · ");
    }
    default:
      return s.power === undefined ? "" : s.power ? on : off;
  }
}

/** Nível arrastável no card (estilo Google Home): luz = brilho, TV = volume, ar = temperatura. */
export interface Level {
  capability: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** "70%", "vol 18", "23 °C" */
  format: (v: number) => string;
  /** Leitor de tela: "70 por cento" */
  valueText: (v: number) => string;
}

export function levelOf(device: Device): Level | null {
  const pick = (id: string) => {
    const c = cap(device, id);
    const v = device.state[id];
    if (!c || c.readonly || typeof v !== "number") return null;
    return { c, v };
  };
  if (device.kind === "light") {
    const p = pick("brightness");
    if (!p) return null;
    return { capability: "brightness", value: p.v, min: p.c.min ?? 1, max: p.c.max ?? 100, step: p.c.step ?? 1,
      format: (v) => `${Math.round(v)}%`, valueText: (v) => `${Math.round(v)} por cento` };
  }
  if (device.kind === "tv") {
    const p = pick("volume");
    if (!p) return null;
    return { capability: "volume", value: p.v, min: p.c.min ?? 0, max: p.c.max ?? 100, step: p.c.step ?? 1,
      format: (v) => `vol ${Math.round(v)}`, valueText: (v) => `volume ${Math.round(v)}` };
  }
  if (device.kind === "ac") {
    const p = pick("target_temp");
    if (!p) return null;
    return { capability: "target_temp", value: p.v, min: p.c.min ?? 16, max: p.c.max ?? 30, step: p.c.step ?? 1,
      format: (v) => `${int.format(v)} °C`, valueText: (v) => `${int.format(v)} graus` };
  }
  return null;
}

/** Posição 0–100% do nível no card. */
export function levelPct(level: Level, value = level.value): number {
  return ((value - level.min) / (level.max - level.min)) * 100;
}

/**
 * Automações e rotinas que citam o aparelho (gatilho, condições ou ações).
 * Usado no "Automações que usam este aparelho (N)" e na confirmação de remover.
 */
export function usedBy(
  deviceId: string,
  automations: import("./types").Automation[],
  routines: import("./types").Routine[],
): { automations: import("./types").Automation[]; routines: import("./types").Routine[]; total: number } {
  const inActions = (actions: import("./types").Action[]) =>
    actions.some((a) => a.type === "device" && a.device_id === deviceId);
  const autos = automations.filter(
    (a) =>
      (a.trigger.type === "device" && a.trigger.device_id === deviceId) ||
      a.conditions.some((c) => c.type === "device_is" && c.device_id === deviceId) ||
      inActions(a.actions),
  );
  const rots = routines.filter((r) => inActions(r.actions));
  return { automations: autos, routines: rots, total: autos.length + rots.length };
}

/* ---------------- grupos ---------------- */

/** Grupo é um aparelho com vendor "grupo" (members = ids dos aparelhos que o formam). */
export const isGroup = (device: Device): boolean => device.vendor === "grupo";

/** Quantos aparelhos o grupo tem, quantos ligados e quantos sem resposta (a central calcula; cai no members). */
export function groupCounts(device: Device): { total: number; on: number; offline: number } {
  const s = device.state;
  return {
    total: Number(s.group_total ?? device.members?.length ?? 0),
    on: Number(s.group_on ?? 0),
    offline: Number(s.group_offline ?? 0),
  };
}

export const NO_ROOM = "Sem cômodo";

/** Aparelhos por cômodo (A–Z, "Sem cômodo" por último), cada lista em ordem alfabética. */
export function devicesByRoom(devices: Device[]): [string, Device[]][] {
  const rooms = new Map<string, Device[]>();
  for (const d of devices) {
    const room = d.room ?? NO_ROOM;
    rooms.set(room, [...(rooms.get(room) ?? []), d]);
  }
  for (const list of rooms.values()) list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return [...rooms.entries()].sort(([a], [b]) => (a === NO_ROOM ? 1 : b === NO_ROOM ? -1 : a.localeCompare(b, "pt-BR")));
}
