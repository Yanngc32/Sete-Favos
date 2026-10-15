// Espelho dos modelos da central (backend/src/casa/model.py, automation.py, access.py).

export type Kind = "light" | "plug" | "switch" | "ac" | "tv" | "vacuum" | "phone" | "other";
export type CapType = "bool" | "int" | "float" | "enum" | "color" | "text" | "action";

export interface Option {
  value: string;
  label: string;
}

export interface Capability {
  id: string;
  type: CapType;
  label: string;
  readonly: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  options: Option[] | null;
}

export interface Device {
  id: string;
  vendor: string;
  vendor_label: string;
  kind: Kind;
  name: string;
  room: string | null;
  pinned: boolean;
  /** null = ainda não respondeu desde que a central subiu */
  online: boolean | null;
  last_seen: number | null;
  state: Record<string, unknown>;
  capabilities: Capability[];
  notes: string[];
  /** IP e modelo vindos do cadastro (null em aparelho antigo). */
  ip?: string | null;
  model?: string | null;
  /** Só em grupo (vendor "grupo"): ids dos aparelhos que o formam. */
  members?: string[] | null;
  /** Timer "desligar em...": quando (epoch s) a central desliga. */
  off_at?: number | null;
  /** Teclas do controle remoto (TV). */
  remote?: string[] | null;
  /** Só na resposta de um comando em grupo em que parte dos membros não respondeu. */
  partial?: { ok: number; total: number; failed: string[] } | null;
  /** Aparência do card na Início (salva na colmeia, vale em todos os aparelhos). null = padrão. */
  card?: CardPrefs | null;
}

/** s = pílula (favo, nome, liga/desliga) · m = card normal · l = grande, com controles e número herói. */
export type CardSize = "s" | "m" | "l";
/** O que o card mostra, por tipo (lib/cardLook showOptions): {"level": false, "mute": true}. Ausente = padrão (mostra). */
export type CardShow = Record<string, boolean | null | undefined>;
export interface CardPrefs {
  size?: CardSize | null;
  show?: CardShow | null;
}

/** Painel personalizável da Início: abas → seções → cards (modelo "sections" do Home Assistant). */
export type DashCardType = "device" | "glance" | "routine" | "virtual" | "summary";

export interface DashCard {
  id: string;
  type: DashCardType;
  /** Largura em colunas da seção (1 a 4). */
  cols: 1 | 2 | 3 | 4;
  /** Nome exibido no lugar do nome do aparelho/rotina. */
  name?: string | null;
  device_id?: string | null;
  device_ids?: string[];
  routine_id?: string | null;
  virtual_id?: string | null;
  /** Só card de aparelho: sobrescreve o padrão do aparelho (null = herda). */
  size?: CardSize | null;
  show?: CardShow | null;
}

export interface DashSection {
  id: string;
  title?: string | null;
  cards: DashCard[];
}

export interface DashView {
  id: string;
  name: string;
  sections: DashSection[];
}

export interface Dashboard {
  /** true = ninguém personalizou: vale o painel automático (um bloco por cômodo). */
  auto: boolean;
  rev: number;
  views: DashView[];
}

export interface GroupPreview {
  capabilities: Capability[];
  kind: Kind;
}

export type Trigger =
  | { type: "time"; at: string; days: number[] }
  | { type: "device"; device_id: string; capability: string; to: unknown }
  | { type: "virtual"; virtual_id: string; to: boolean }
  | { type: "sun"; event: "sunrise" | "sunset"; offset: number; days: number[] };

export type Condition =
  | { type: "time_between"; start: string; end: string }
  | { type: "weekday"; days: number[] }
  | { type: "device_is"; device_id: string; capability: string; value: unknown }
  | { type: "virtual_is"; virtual_id: string; value: boolean };

export type Action =
  | {
      type: "device";
      device_id: string;
      /** Ajustes da ação: { power: true, target_temp: 23, ac_mode: "cool" } (a central sempre devolve assim). */
      values?: Record<string, unknown>;
      /** Formato antigo (um ajuste por ação): a central aceita e converte. Use lib/actions.ts::actionValues. */
      capability?: string;
      value?: unknown;
    }
  | { type: "virtual"; virtual_id: string; value: boolean }
  | { type: "delay"; minutes: number }
  | { type: "routine"; routine_id: string };

export interface StepResult {
  label: string;
  ok: boolean;
  error: string | null;
}

export interface RunResult {
  id: string;
  at: number;
  total: number;
  succeeded: number;
  errors: string[];
  steps: StepResult[];
  pending: boolean;
  skipped: string | null;
}

export interface Routine {
  id: string;
  name: string;
  actions: Action[];
  pinned: boolean;
  last_run: RunResult | null;
  incomplete: string | null;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  last_run: RunResult | null;
  incomplete: string | null;
}

export interface VirtualObject {
  id: string;
  name: string;
  kind: "switch";
  value: boolean;
  pinned: boolean;
  used_by: number;
}

export interface Field {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  help: string | null;
  options: Option[] | null;
  /** Só aparece quando o fabricante pede (ex.: captcha da Xiaomi). */
  hidden?: boolean;
}

export interface Vendor {
  vendor: string;
  label: string;
  description: string;
  account_required: boolean;
  account_configured: boolean;
  account_fields: Field[];
  transient_fields: Field[];
  transient_required: boolean;
  /** Aceita "Adicionar pelo IP". */
  manual_add?: boolean;
}

export interface Candidate {
  key: string;
  vendor: string;
  name: string;
  model: string | null;
  ip: string | null;
  kind: Kind;
  needs_pairing: boolean;
  already_added: boolean;
  problem: string | null;
}

export interface DiscoveryJob {
  id: string;
  vendor: string;
  done: boolean;
  error: string | null;
  error_code: string | null;
  error_data: Record<string, unknown>;
  candidates: Candidate[];
}

export interface AccessDevice {
  id: string;
  name: string;
  created_at: number;
  last_seen: number | null;
  last_via: "lan" | "tailscale" | null;
}

export interface UpdateStatus {
  state: "ok" | "verificando" | "baixando" | "instalando" | "disponivel" | "erro";
  current: string;
  latest: string | null;
  checked_at: number | null;
  message: string | null;
  /** Só o central.exe instalado aplica; rodando do código, só avisa. */
  can_apply: boolean;
  /** Token do GitHub no cofre; sem ele a consulta é anônima. */
  has_token: boolean;
}

export type Session =
  | { access: "pc" }
  | { access: "device"; device: AccessDevice }
  | { access: "none" };

export interface Snapshot {
  devices: Device[];
  rooms: string[];
  virtuals: VirtualObject[];
  routines: Routine[];
  automations: Automation[];
}

export type LiveEvent =
  | ({ t: "snapshot" } & Snapshot)
  | { t: "device"; device: Device }
  | { t: "device_removed"; id: string; name: string }
  | { t: "virtual"; virtual: VirtualObject }
  | { t: "virtual_removed"; id: string }
  | { t: "routine"; routine: Routine }
  | { t: "routine_removed"; id: string }
  | { t: "automation"; automation: Automation }
  | { t: "automation_removed"; id: string }
  | { t: "discovery"; job: string; candidate: Candidate }
  | ({ t: "discovery_done"; job: string } & DiscoveryJob)
  | { t: "access_paired"; device: AccessDevice }
  | { t: "access_revoked"; id: string }
  /** O painel da Início mudou (salvo, voltou ao automático). Quem não foi o autor busca de novo. */
  | { t: "dashboard"; rev: number; auto: boolean }
  | { t: "ping" };
