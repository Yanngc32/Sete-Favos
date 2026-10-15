// Regras da Início que não são visuais: saudação, resumo, ordem dos cômodos, tamanho de cada card.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Armchair,
  Bath,
  Bed,
  BedDouble,
  Briefcase,
  Car,
  Clapperboard,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  CookingPot,
  DoorOpen,
  Flower2,
  Gamepad2,
  House,
  Moon,
  Plane,
  Shirt,
  Sofa,
  Sun,
  ToggleRight,
  Users,
  Utensils,
  WashingMachine,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { isOffline, isOn, optionLabel, vacuumStatus } from "@/lib/devices";
import { int } from "@/lib/format";
import type { Device, Routine } from "@/lib/types";

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

export interface SummaryPart {
  text: string;
  /** trecho em destaque (número) */
  strong?: string;
  after?: string;
}

/** "3 ligados · Ar do quarto 22 °C · Robô na base" */
export function summary(devices: Device[]): SummaryPart[] {
  const live = devices.filter((d) => d.online !== false);
  const on = live.filter((d) => d.kind !== "vacuum" && isOn(d)).length;
  const parts: SummaryPart[] = [
    on === 0 ? { text: "Tudo desligado" } : { text: "", strong: String(on), after: on === 1 ? " ligado" : " ligados" },
  ];
  const ac = live.find((d) => d.kind === "ac" && isOn(d) && typeof d.state.target_temp === "number");
  if (ac) parts.push({ text: `${ac.name} `, strong: `${int.format(ac.state.target_temp as number)} °C` });
  const robot = live.find((d) => d.kind === "vacuum");
  if (robot) parts.push({ text: `Robô ${vacuumStatus(robot).toLowerCase()}` });
  return parts;
}

/** Contagens do card "Resumo da casa": ligados (robô não conta), sem resposta e rotinas. */
export function houseCounts(devices: Device[], routines: Routine[]) {
  return {
    on: devices.filter((d) => d.online !== false && d.kind !== "vacuum" && isOn(d)).length,
    offline: devices.filter(isOffline).length,
    routines: routines.length,
  };
}

export function summaryText(parts: SummaryPart[]): string {
  return parts.map((p) => `${p.text}${p.strong ?? ""}${p.after ?? ""}`).join(" · ");
}

/** Colunas que o card ocupa na grade: ar = herói (2), robô = largo (2), resto 1. */
export function spanOf(d: Device): 1 | 2 {
  return d.kind === "ac" || d.kind === "vacuum" ? 2 : 1;
}

export interface RoomGroup {
  name: string;
  devices: Device[];
}

/** Cômodos com mais aparelhos primeiro (Sala · Quarto · Cozinha · Escritório na casa de exemplo). */
export function orderRooms(rooms: string[], devices: Device[]): string[] {
  const count = (r: string) => devices.filter((d) => d.room === r).length;
  return [...rooms].sort((a, b) => count(b) - count(a) || a.localeCompare(b, "pt-BR"));
}

export function groupByRoom(rooms: string[], devices: Device[]): RoomGroup[] {
  const groups: RoomGroup[] = rooms
    .map((name) => ({ name, devices: devices.filter((d) => d.room === name) }))
    .filter((g) => g.devices.length > 0);
  const loose = devices.filter((d) => !d.room || !rooms.includes(d.room));
  if (loose.length) groups.push({ name: "Sem cômodo", devices: loose });
  return groups;
}

/** Frase do card. No celular a frase encurta ("Ligada · 70%", "Netflix · vol 18"). */
export function cardText(d: Device, base: string, compact: boolean): string {
  if (!compact) return base;
  if (d.kind === "vacuum") return base.split(" · ")[0];
  if (!isOn(d)) return base;
  const parts = base.split(" · ");
  if (d.kind === "light") return parts.slice(0, 2).join(" · ");
  if (d.kind === "tv" && parts.length > 1) return parts.slice(1).join(" · ");
  return base;
}

/** Herói do ar: "Frio · ambiente 26 °C" (a temperatura alvo já está no número grande). */
export function acLine(d: Device): string {
  const s = d.state;
  const head = s.power ? (optionLabel(d, "ac_mode", s.ac_mode) ?? "Ligado") : "Desligado";
  const room = typeof s.current_temp === "number" ? `ambiente ${int.format(s.current_temp)} °C` : null;
  return [head, room].filter(Boolean).join(" · ");
}

const ROUTINE_ICONS: [RegExp, LucideIcon][] = [
  [/sair|saída|fora/i, DoorOpen],
  [/dormir|noite|sono/i, Moon],
  [/cinema|filme|tv/i, Clapperboard],
  [/acordar|manhã|bom dia/i, Sun],
  [/jantar|almo|cozinha|caf/i, Utensils],
];

/** A rotina não tem ícone na central: escolhe pelo nome. */
export function routineIcon(name: string): LucideIcon {
  return ROUTINE_ICONS.find(([re]) => re.test(name))?.[1] ?? Zap;
}

const VIRTUAL_ICONS: [RegExp, LucideIcon][] = [
  [/visita|convidad/i, Users],
  [/dorm|sono/i, Bed],
  [/f[ée]rias|viagem/i, Plane],
];

export function virtualIcon(name: string): LucideIcon {
  return VIRTUAL_ICONS.find(([re]) => re.test(name))?.[1] ?? ToggleRight;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Re-renderiza a cada `ms` (para "há X min" e a saudação). */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const ROOM_ICONS: [RegExp, LucideIcon][] = [
  [/sala|estar|living/i, Sofa],
  [/su[ií]te|quarto|dormit/i, BedDouble],
  [/cozinha|copa/i, CookingPot],
  [/banh|lavabo|wc/i, Bath],
  [/escrit|office|estudo|home office/i, Briefcase],
  [/lavand|servi[çc]o/i, WashingMachine],
  [/garagem/i, Car],
  [/varanda|jardim|quintal|[áa]rea externa|sacada/i, Flower2],
  [/closet/i, Shirt],
  [/jogos|game/i, Gamepad2],
  [/jantar/i, Utensils],
  [/leitura|recep/i, Armchair],
];

/** O cômodo não tem ícone na central: escolhe pelo nome (Sala = sofá, Quarto = cama…). */
export function roomIcon(name: string): LucideIcon {
  return ROOM_ICONS.find(([re]) => re.test(name))?.[1] ?? House;
}

/** Aparelho que conta como "ligado" no resumo (robô e sem resposta não contam). */
export function countsOn(d: Device): boolean {
  return d.online !== false && d.kind !== "vacuum" && isOn(d);
}

export interface RoomStat {
  name: string;
  total: number;
  on: number;
  /** Temperatura que vale mostrar no favo: alvo do ar ligado, senão a do ambiente. */
  temp: number | null;
}

export function roomStats(rooms: string[], devices: Device[]): RoomStat[] {
  return rooms
    .map((name) => {
      const ds = devices.filter((d) => d.room === name);
      const acOn = ds.find((d) => d.kind === "ac" && countsOn(d) && typeof d.state.target_temp === "number");
      const amb = ds.find((d) => d.online !== false && typeof d.state.current_temp === "number");
      const temp = acOn ? (acOn.state.target_temp as number) : amb ? (amb.state.current_temp as number) : null;
      return { name, total: ds.length, on: ds.filter(countsOn).length, temp };
    })
    .filter((r) => r.total > 0);
}

const WEATHER_ICONS: Record<string, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  "cloud-sun": CloudSun,
  "cloud-moon": CloudMoon,
  "cloud-fog": CloudFog,
  "cloud-drizzle": CloudDrizzle,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-lightning": CloudLightning,
};

export function weatherIcon(name: string): LucideIcon {
  return WEATHER_ICONS[name] ?? Cloud;
}

/**
 * Separa os "Ligados" do resto sem fazer card pular debaixo do dedo: cada aparelho fica no grupo em que apareceu
 * até a pessoa trocar de cômodo, voltar pra aba/janela ou a lista de aparelhos mudar (entrou/saiu um).
 */
export function useStickyOn(devices: Device[], resetKey: string): Set<string> {
  const memo = useRef<{ key: string; ids: string; on: Set<string> } | null>(null);
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setVisits((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const ids = devices
    .map((d) => d.id)
    .sort()
    .join(",");
  const key = `${resetKey}|${visits}`;
  if (!memo.current || memo.current.key !== key || memo.current.ids !== ids) {
    memo.current = { key, ids, on: new Set(devices.filter((d) => !d.pinned && countsOn(d)).map((d) => d.id)) };
  }
  return memo.current.on;
}
