import type {
  CardPrefs,
  AccessDevice,
  Automation,
  Candidate,
  Dashboard,
  DashView,
  Device,
  DiscoveryJob,
  GroupPreview,
  Kind,
  Routine,
  RunResult,
  Session,
  UpdateStatus,
  Vendor,
  VirtualObject,
} from "./types";

/** Erro da central com a mensagem pronta para mostrar (pt-BR). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }

  get unauthorized() {
    return this.status === 401;
  }
}

/** Códigos que a central devolve em `detail` (middleware e rotas só do PC) e o texto pra mostrar. */
const DETAIL_MESSAGES: Record<string, string> = {
  so_no_pc: "Só dá para fazer isso no PC da casa.",
  corpo_grande_demais: "O pedido é grande demais.",
  origem_recusada: "Pedido recusado: a página não veio da colmeia.",
  origem_de_rede_recusada: "Pedido recusado: fora da rede da casa.",
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = typeof data.detail === "string" ? data.detail : "";
    const detail = DETAIL_MESSAGES[raw] ?? (raw || "Algo deu errado. Tente de novo.");
    throw new ApiError(res.status, detail, data.code, data.data);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T = void>(path: string) => request<T>("DELETE", path);

/** Clima de agora na casa (Open-Meteo pela colmeia). Sem local salvo ou sem internet: available=false. */
export type Weather =
  | { available: false; reason: "sem_local" | "indisponivel" }
  | {
      available: true;
      temp_c: number;
      humidity: number;
      wind_kmh: number;
      visibility_km: number | null;
      condition: string;
      /** nome do ícone lucide (sun, moon, cloud, cloud-sun, cloud-moon, cloud-rain…) */
      icon: string;
      is_day: boolean;
      time: string | null;
    };

export interface HomeLocation {
  lat: number | null;
  lon: number | null;
  radius_m: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export const api = {
  session: () => get<Session>("/session"),
  version: () => get<{ version: string }>("/version"),
  home: {
    get: () => get<HomeLocation>("/home"),
    set: (body: { lat: number; lon: number; radius_m: number }) => put<HomeLocation>("/home", body),
  },
  weather: () => get<Weather>("/weather"),
  androidApp: () => get<{ available: boolean; version: string | null; url: string }>("/app"),
  update: {
    status: () => get<UpdateStatus>("/update"),
    check: () => post<UpdateStatus>("/update/check"),
    setToken: (token: string) => put<UpdateStatus>("/update/token", { token }),
    clearToken: () => del<UpdateStatus>("/update/token"),
  },

  devices: {
    command: (id: string, capability: string, value?: unknown) =>
      post<Device>(`/devices/${id}/command`, { capability, value }),
    update: (id: string, body: { name?: string; room?: string; clear_room?: boolean; pinned?: boolean; kind?: Kind; labels?: Record<string, string>; card?: CardPrefs; clear_card?: boolean }) =>
      patch<Device>(`/devices/${id}`, body),
    remove: (id: string) => del(`/devices/${id}`),
    remote: (id: string, key: string) => post<void>(`/devices/${id}/remote`, { key }),
    timer: (id: string, minutes: number | null) => put<Device>(`/devices/${id}/timer`, { minutes }),
    test: (id: string) => post<void>(`/devices/${id}/test`),
  },
  rooms: {
    add: (name: string) => post<string[]>("/rooms", { name }),
  },
  // Grupos de aparelhos. Renomear, mudar de cômodo, fixar e desfazer usam `devices` (PATCH/DELETE).
  groups: {
    create: (body: { name: string; room?: string | null; members: string[] }) => post<Device>("/groups", body),
    preview: (members: string[]) => post<GroupPreview>("/groups/preview", { members }),
    setMembers: (id: string, members: string[]) => put<Device>(`/groups/${id}/members`, { members }),
  },
  // Painel da Início. `expected_rev` = a versão em que a edição começou (409 se outro aparelho salvou antes).
  dashboard: {
    get: () => get<Dashboard>("/dashboard"),
    save: (views: DashView[], expected_rev: number) => put<Dashboard>("/dashboard", { views, expected_rev }),
    reset: () => del<Dashboard>("/dashboard"),
  },

  vendors: {
    list: () => get<Vendor[]>("/vendors"),
    saveAccount: (vendor: string, values: Record<string, string>) => put<void>(`/vendors/${vendor}/account`, { values }),
    clearAccount: (vendor: string) => del(`/vendors/${vendor}/account`),
    discover: (vendor: string, credentials: Record<string, string> = {}) =>
      post<DiscoveryJob>(`/vendors/${vendor}/discover`, { credentials }),
    manual: (vendor: string, body: { ip: string; device_id?: string; secret?: string }) =>
      post<{ job: string; candidate: Candidate }>(`/vendors/${vendor}/manual`, body),
  },
  discovery: {
    get: (job: string) => get<DiscoveryJob>(`/discovery/${job}`),
    pair: (job: string, key: string) =>
      post<Candidate>(`/discovery/${job}/candidates/${encodeURIComponent(key)}/pair`),
    add: (job: string, key: string, body: { name: string; room: string | null; kind: Kind }) =>
      post<Device>(`/discovery/${job}/candidates/${encodeURIComponent(key)}/add`, body),
  },

  routines: {
    create: (body: Omit<Routine, "id" | "last_run" | "incomplete">) => post<Routine>("/routines", body),
    update: (id: string, body: Omit<Routine, "id" | "last_run" | "incomplete">) => put<Routine>(`/routines/${id}`, body),
    pin: (id: string, pinned: boolean) => patch<Routine>(`/routines/${id}`, { pinned }),
    remove: (id: string) => del(`/routines/${id}`),
    run: (id: string) => post<RunResult>(`/routines/${id}/run`),
  },
  automations: {
    create: (body: Omit<Automation, "id" | "last_run" | "incomplete">) => post<Automation>("/automations", body),
    update: (id: string, body: Omit<Automation, "id" | "last_run" | "incomplete">) =>
      put<Automation>(`/automations/${id}`, body),
    enable: (id: string, enabled: boolean) => patch<Automation>(`/automations/${id}`, { enabled }),
    remove: (id: string) => del(`/automations/${id}`),
  },
  actions: {
    test: (actions: Routine["actions"]) => post<RunResult>("/actions/test", { actions }),
  },
  runs: {
    undo: (id: string) => post<RunResult>(`/runs/${id}/undo`),
  },
  virtuals: {
    create: (body: { name: string; pinned?: boolean }) => post<VirtualObject>("/virtuals", body),
    update: (id: string, body: { name?: string; pinned?: boolean }) => put<VirtualObject>(`/virtuals/${id}`, body),
    set: (id: string, value: boolean) => post<VirtualObject>(`/virtuals/${id}/value`, { value }),
    remove: (id: string) => del(`/virtuals/${id}`),
  },

  access: {
    devices: () => get<AccessDevice[]>("/access/devices"),
    rename: (id: string, name: string) => patch<AccessDevice>(`/access/devices/${id}`, { name }),
    revoke: (id: string) => del(`/access/devices/${id}`),
    startPairing: () =>
      post<{ code: string; expires_at: number; urls: { tailnet: string | null; lan: string | null } }>(
        "/access/pairing",
      ),
    pairingStatus: () =>
      get<{ state: "none" | "waiting" | "expired" | "paired"; device?: string; expires_at?: number }>(
        "/access/pairing",
      ),
    cancelPairing: () => del("/access/pairing"),
    pair: (code: string, name?: string) => post<{ device: AccessDevice }>("/access/pair", { code, name }),
  },
};
