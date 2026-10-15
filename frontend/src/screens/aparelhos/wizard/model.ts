// Estado e textos do assistente "Adicionar aparelho".
import { ApiError } from "@/lib/api";
import type { Candidate, Kind, Vendor } from "@/lib/types";

export type Step = 1 | 2 | 3 | 4;

export const STEP_LABEL: Record<Step, string> = {
  1: "Fabricante",
  2: "Conta",
  3: "Descobrir",
  4: "Nome e cômodo",
};

/** Erro pronto para mostrar: mensagem pt-BR da central + código. */
export interface Err {
  message: string;
  code?: string;
  data?: Record<string, unknown>;
}

export function toErr(e: unknown): Err {
  if (e instanceof ApiError) return { message: e.message, code: e.code, data: e.data };
  return { message: "Não consegui falar com a colmeia. Ela está ligada?", code: "rede" };
}

/** Candidato achado + o job de onde veio (o "Adicionar pelo IP" cria um job próprio). */
export interface Found {
  job: string;
  c: Candidate;
  /** Veio do "Adicionar pelo IP" (sobrevive a "Procurar de novo"). */
  manual?: boolean;
}

export type PairState =
  | { status: "waiting"; startedAt: number; attempt: number }
  | { status: "ok" }
  | { status: "miss"; message: string }
  | { status: "fail"; err: Err };

export const PAIR_SECONDS = 60;

export interface Draft {
  name: string;
  /** "" = sem cômodo; NEW_ROOM = digitar um novo. */
  room: string;
  newRoom: string;
  kind: Kind;
  /** Já cadastrado (pelo Testar): id do aparelho e o que foi gravado. */
  deviceId?: string;
  saved?: { name: string; room: string | null; kind: Kind };
  test?: { status: "busy" } | { status: "ok"; text: string } | { status: "fail"; message: string };
  busy?: boolean;
  err?: Err;
  nameErr?: string;
  roomErr?: string;
}

export const NEW_ROOM = "__novo__";

export const KINDS: Kind[] = ["light", "plug", "switch", "ac", "tv", "vacuum"];

// Fabricante ----------------------------------------------------------------

/** "Tuya / Smart Life" → Tuya + "/ Smart Life"; "LG (TV webOS)" → LG + "TV webOS". */
export function wordmark(label: string): { name: string; small?: string } {
  const paren = label.match(/^(.+?)\s*\((.+)\)$/);
  if (paren) return { name: paren[1], small: paren[2] };
  const slash = label.split(" / ");
  if (slash.length > 1) return { name: slash[0], small: `/ ${slash.slice(1).join(" / ")}` };
  const words = label.split(" ");
  if (words.length > 1) return { name: words[0], small: words.slice(1).join(" ") };
  return { name: label };
}

/** Nome curto do fabricante para a lista ("Tuya", "LG webOS", "Positivo"). */
export function vendorShort(label: string): string {
  const paren = label.match(/^(.+?)\s*\((?:TV\s+)?(.+)\)$/);
  if (paren) return `${paren[1]} ${paren[2]}`;
  return wordmark(label).name;
}

export function hasAccountStep(v: Vendor): boolean {
  return v.account_fields.length > 0 || v.transient_fields.length > 0;
}

export const isTuyaLike = (v: Vendor) => v.vendor === "tuya" || v.vendor === "positivo";

const ACCOUNT_COPY: Record<string, { title: string; sub: string }> = {
  tuya: { title: "Conta Tuya IoT", sub: "Pra buscar a chave local de cada aparelho." },
  positivo: {
    title: "Conta Tuya IoT",
    sub: "A Positivo usa a Tuya por baixo. Pra buscar a chave local de cada aparelho.",
  },
  midea: { title: "Conta do app Midea", sub: "Só pra buscar o token e a key dos ares V3. Ar mais antigo? Deixe em branco." },
  xiaomi: { title: "Conta Mi", sub: "Pra buscar o token do robô." },
};

export function accountCopy(v: Vendor) {
  return ACCOUNT_COPY[v.vendor] ?? { title: `Conta ${wordmark(v.label).name}`, sub: "Pra achar os seus aparelhos." };
}

export function discoverSub(v: Vendor): string {
  if (v.vendor === "lg") return "A TV precisa estar ligada e no mesmo Wi-Fi do PC.";
  if (v.vendor === "xiaomi") return "Buscando os aparelhos da sua conta Mi. O robô precisa estar no mesmo Wi-Fi do PC.";
  return "O aparelho precisa estar ligado e no mesmo Wi-Fi do PC.";
}

/** Linha do card do passo 1. */
export function vendorLine(v: Vendor): string {
  return hasAccountStep(v) || v.account_required ? v.description : `${v.description} · não pede conta`;
}

/** Campos do "Adicionar pelo IP" (só se a central disser que o fabricante aceita: `manual_add`). */
export function manualFields(v: Vendor): { deviceId: boolean; secret: "none" | "optional" | "required"; secretLabel: string } | null {
  if (!v.manual_add) return null;
  switch (v.vendor) {
    case "tuya":
    case "positivo":
      return { deviceId: true, secret: v.account_configured ? "optional" : "required", secretLabel: "local_key" };
    case "xiaomi":
      return { deviceId: false, secret: "required", secretLabel: "Token (32 caracteres)" };
    default:
      return { deviceId: false, secret: "none", secretLabel: "" };
  }
}

// Erros -----------------------------------------------------------------------

/** Erros da descoberta que são da conta: voltam pro passo 2 com o aviso. */
export const ACCOUNT_ERRORS = new Set([
  "verificacao", "captcha", "xiaomi_recusou", "midea_nuvem", "campos_faltando", "sem_conta",
  "tuya_recusou", "tuya_expirado", "tuya_rede", "regiao",
]);

export const isFirewall = (e: Err) => e.code === "sem_resposta" || e.code === "tv_sem_resposta" || /firewall/i.test(e.message);

export const isNotLocal = (e: Err) => !!e.code?.startsWith("xiaomi_sem_");

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
