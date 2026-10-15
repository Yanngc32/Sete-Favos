// Aparência do card de aparelho: tamanho (pequeno/médio/grande) e o que ele mostra — por tipo de aparelho.
// Salva na colmeia (Device.card, vale em todo aparelho de acesso); o card do painel pode sobrescrever (DashCard.size/show).
// O catálogo de chaves é o mesmo do backend (casa/model.py, CARD_SHOW_BY_KIND): chave fora dele = 422.
// Puro (só tipos): roda nos testes do Node.
import type { CardPrefs, CardShow, CardSize, Device } from "./types";

export type ShowKey = string;
export const SIZES: readonly CardSize[] = ["s", "m", "l"];
export const SIZE_LABEL: Record<CardSize, string> = { s: "Pequeno", m: "Médio", l: "Grande" };
export const SIZE_HINT: Record<CardSize, string> = {
  s: "Ícone, nome, liga/desliga e o número principal",
  m: "O card de sempre",
  l: "Número grande e controles rápidos",
};

type DeviceLike = Pick<Device, "kind" | "vendor" | "capabilities" | "state"> & { remote?: string[] | null; card?: CardPrefs | null };

/** Uma opção do "Personalizar card": o que liga/desliga no card, em que tamanhos aparece e em que seção do sheet. */
export interface ShowOpt {
  key: ShowKey;
  label: string;
  hint: string;
  group: "info" | "quick";
  sizes: readonly CardSize[];
}

/** Todas as chaves conhecidas (o card lê qualquer uma; a que não vale pro tipo fica sempre "à mostra" e não desenha nada). */
export const ALL_KEYS: readonly ShowKey[] = [
  "room", "status", "level", "members", "offline",
  "color", "nudge", "palette",
  "source", "power", "mute", "remote",
  "current", "mode", "fan",
  "fan_power", "actions", "dock",
  "keynames", "all",
  "charging", "home",
];
/** Chave legada da 1ª versão ("controles rápidos" num botão só): vale de padrão pros controles de cada tipo. */
const LEGACY_QUICK = new Set(["nudge", "palette", "mute", "remote", "actions", "dock", "all"]);

const ALL3: readonly CardSize[] = ["s", "m", "l"];
const ML: readonly CardSize[] = ["m", "l"];
const L: readonly CardSize[] = ["l"];

const isGroup = (d: Pick<Device, "vendor">) => d.vendor === "grupo";
const hasKeys = (d: Pick<Device, "kind" | "vendor" | "capabilities">) =>
  d.kind === "switch" && !isGroup(d) && d.capabilities.some((c) => /^switch_\d$/.test(c.id));

/** Opções do card deste aparelho, na ordem do sheet. Só o que o aparelho tem (pelas capabilities e pelo estado). */
export function showOptions(d: DeviceLike): ShowOpt[] {
  const caps = new Set(d.capabilities.map((c) => c.id));
  const st = d.state ?? {};
  const group = isGroup(d);
  const o: ShowOpt[] = [];
  const add = (key: string, label: string, hint: string, group: ShowOpt["group"], sizes: readonly CardSize[]) =>
    o.push({ key, label, hint, group, sizes });
  const room = () =>
    group
      ? add("members", "Membros ligados", "“3 aparelhos · 2 ligados” embaixo do nome", "info", ML)
      : add("room", "Cômodo", "Embaixo do nome", "info", ML);
  const status = (label: string, hint: string) => add("status", label, hint, "info", ML);

  if (hasKeys(d)) {
    add("keynames", "Nome de cada tecla", "Teto, Arandela… em cada tecla", "info", ML);
    status("Teclas ligadas", "“1 de 3 ligada”");
    room();
    add("all", "Ligar/desligar todas", "Botão que vale pra todas as teclas", "quick", ML);
    return o;
  }

  switch (d.kind) {
    case "light":
      if (caps.has("brightness")) add("level", "Brilho", "Em %, como número grande", "info", ALL3);
      if (caps.has("color_temp") || caps.has("color")) add("color", "Cor ou temperatura", "Bolinha com a cor atual", "info", ML);
      status("Ligada ou desligada", "Texto do estado");
      room();
      if (caps.has("brightness")) add("nudge", "−/+ de brilho", "De 10 em 10%", "quick", L);
      if (caps.has("color_temp") || caps.has("color")) add("palette", "Paleta rápida", "Quente, neutra, fria e cores", "quick", L);
      break;
    case "tv":
      if (group) {
        if (caps.has("volume")) add("level", "Volume", "Média dos membros", "info", ALL3);
        status("Ligada ou desligada", "Texto do estado");
        room();
        break;
      }
      if (caps.has("source")) add("source", "App ou entrada", "Netflix, HDMI 1…", "info", ML);
      if (caps.has("volume")) add("level", "Volume", "“vol 18” no rodapé; no grande, −/+", "info", ALL3);
      status("Ligada ou desligada", "Texto do estado");
      room();
      if (caps.has("power")) add("power", "Botão de energia", "Liga e desliga a TV", "quick", ML);
      if (caps.has("muted")) add("mute", "Botão de mudo", "No rodapé do card", "quick", ML);
      if (d.remote?.length) add("remote", "Controle", "Setas, OK e voltar", "quick", L);
      break;
    case "ac":
      if (caps.has("target_temp")) add("level", "Temperatura alvo", "O número grande", "info", ALL3);
      if (caps.has("current_temp") || typeof st.current_temp === "number") add("current", "Temperatura ambiente", "“ambiente 26 °C”", "info", ML);
      if (caps.has("ac_mode")) add("mode", "Modo", "Frio, quente, ventilar…", "info", ML);
      if (caps.has("fan_speed")) add("fan", "Ventilação", "“vent. auto”", "info", ML);
      status("Ligado ou desligado", "Quando o modo está escondido");
      room();
      if (caps.has("target_temp")) add("nudge", "−/+ de temperatura", "De 1 em 1 °C", "quick", ML);
      break;
    case "vacuum":
      if (group) {
        status("Estado", "Texto do estado");
        room();
        break;
      }
      if ("battery" in st || caps.has("battery")) add("level", "Bateria", "Anel com a carga", "info", ALL3);
      status("Estado da limpeza", "Na base, limpando, voltando…");
      if (caps.has("fan_power")) add("fan_power", "Potência", "“potência padrão”", "info", ML);
      room();
      if (caps.has("start")) add("actions", "Iniciar e pausar", "Botão da limpeza", "quick", ML);
      if (caps.has("dock")) add("dock", "Voltar pra base", "Botão “Base”", "quick", L);
      break;
    case "plug":
      if (caps.has("power_w")) add("level", "Consumo agora", "Em watts; no grande, número grande", "info", ALL3);
      status("Ligada ou desligada", "Texto do estado");
      room();
      break;
    case "phone":
      if ("battery" in st || caps.has("battery")) add("level", "Bateria", "Em %, como número grande", "info", ALL3);
      if ("charging" in st || caps.has("charging")) add("charging", "Carregando", "Aviso quando está na tomada", "info", ML);
      if ("at_home" in st || "distance_km" in st) add("home", "Em casa ou distância", "“Em casa” ou “A 2,3 km”", "info", ML);
      room();
      break;
    default:
      status("Ligado ou desligado", "Texto do estado");
      room();
  }
  if (group) add("offline", "Aviso de sem resposta", "“1 sem resposta” quando um membro some", "info", ML);
  return o;
}

export interface Look {
  size: CardSize;
  /** Todas as chaves de ALL_KEYS (true = mostra). */
  show: Record<ShowKey, boolean>;
}

type Override = { size?: CardSize | null; show?: CardShow | null } | null | undefined;

/** Tamanho e o que mostrar: card do painel > padrão do aparelho > médio, tudo à mostra. */
export function resolveLook(device: Pick<Device, "card">, override?: Override): Look {
  const base = device.card ?? null;
  const size = override?.size ?? base?.size ?? "m";
  const legacy = override?.show?.quick ?? base?.show?.quick ?? null;
  const show: Record<ShowKey, boolean> = {};
  for (const k of ALL_KEYS) show[k] = override?.show?.[k] ?? base?.show?.[k] ?? (LEGACY_QUICK.has(k) ? legacy : null) ?? true;
  return { size, show };
}

/** Forma canônica pra comparar e salvar: null = padrão (nada escolhido). */
export function normalizePrefs(p: CardPrefs | null | undefined): CardPrefs | null {
  if (!p) return null;
  const show: CardShow = {};
  for (const [k, v] of Object.entries(p.show ?? {})) if (typeof v === "boolean") show[k] = v;
  const size = p.size ?? null;
  if (!size && !Object.keys(show).length) return null;
  return { size, show };
}

export function samePrefs(a: CardPrefs | null | undefined, b: CardPrefs | null | undefined): boolean {
  const x = normalizePrefs(a);
  const y = normalizePrefs(b);
  if (!x || !y) return x === y;
  const keys = new Set([...Object.keys(x.show ?? {}), ...Object.keys(y.show ?? {})]);
  return x.size === y.size && [...keys].every((k) => (x.show?.[k] ?? null) === (y.show?.[k] ?? null));
}

/** Prefs a partir de um Look: só guarda o que difere do padrão (médio, tudo à mostra) e só chaves deste aparelho. */
export function prefsFromLook(look: Look, device: DeviceLike): CardPrefs | null {
  const show: CardShow = {};
  for (const o of showOptions(device)) if (!look.show[o.key]) show[o.key] = false;
  return normalizePrefs({ size: look.size === "m" ? null : look.size, show });
}

/** Médio de 2 colunas: ar, robô e interruptor de teclas (como sempre foram). */
export function isWideKind(d: Pick<Device, "kind" | "vendor" | "capabilities">): boolean {
  return d.kind === "ac" || (d.kind === "vacuum" && !isGroup(d)) || hasKeys(d);
}

/** Quanto o card ocupa na grade: colunas × linhas de `--density-card-row` (56px: a altura da pílula).
 *  Pequeno 1×1 · médio 1×3 (ar 2×3, robô 2×2 deitado, interruptor 2×4) · grande 2×4 (robô 2×3, interruptor 2×5). */
export function cardSpan(d: Pick<Device, "kind" | "vendor" | "capabilities">, size: CardSize): { cols: 1 | 2; rows: number } {
  if (size === "s") return { cols: 1, rows: 1 };
  const keys = hasKeys(d);
  const robot = d.kind === "vacuum" && !isGroup(d);
  if (size === "l") return { cols: 2, rows: keys ? 5 : robot ? 3 : 4 };
  return { cols: isWideKind(d) ? 2 : 1, rows: keys ? 4 : robot ? 2 : 3 };
}

/** Quantas colunas cabem: mesma conta do `repeat(auto-fill, minmax(min, 1fr))`. */
export function tracksFor(width: number, min: number, gap: number): number {
  if (!(width > 0) || !(min > 0)) return 2;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** Largura (em colunas) de um bloco de cômodo: soma dos cards, cabendo na linha e no card mais largo. */
export function sectionSpan(spans: readonly number[], tracks: number): number {
  const sum = spans.reduce((n, s) => n + s, 0);
  const widest = spans.reduce((n, s) => Math.max(n, s), 1);
  return Math.max(Math.min(widest, tracks), Math.min(sum, tracks));
}
