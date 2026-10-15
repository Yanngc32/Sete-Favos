// Painel da Início como a central o tem: uma cópia só, compartilhada pelas telas.
// Carrega no primeiro uso e se atualiza sozinha: o evento `dashboard` do WebSocket (outro aparelho salvou, ou voltou ao
// automático) busca de novo; ao reconectar também busca, porque pode ter perdido eventos enquanto estava fora.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { live } from "./live";
import type { Dashboard } from "./types";

export interface DashState {
  status: "loading" | "ready" | "error";
  data: Dashboard | null;
}

type Listener = () => void;

class DashStore {
  private state: DashState = { status: "loading", data: null };
  private listeners = new Set<Listener>();
  private started = false;
  private fetching: Promise<void> | null = null;
  /** Pedido de busca que chegou enquanto outra ainda corria: refaz no fim, senão a resposta velha vence. */
  private again = false;

  get = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(next: DashState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.load();
    live.onEvent((e) => {
      // O próprio PUT/DELETE já guardou a versão nova (`apply`): o eco do evento não precisa buscar de novo.
      if (e.t === "dashboard" && !(this.state.data && this.state.data.rev >= e.rev)) void this.load();
    });
    let online = live.get().connection === "online";
    live.subscribe(() => {
      const now = live.get().connection === "online";
      if (now && !online) void this.load();
      online = now;
    });
  }

  /** Busca o painel na central. Falhar não derruba a Início: segue valendo o que já se tinha (ou o automático). */
  load(): Promise<void> {
    if (this.fetching) {
      this.again = true;
      return this.fetching;
    }
    this.fetching = (async () => {
      try {
        do {
          this.again = false;
          const data = await api.dashboard.get();
          this.set({ status: "ready", data });
        } while (this.again);
      } catch {
        this.set({ status: this.state.data ? "ready" : "error", data: this.state.data });
      } finally {
        this.fetching = null;
      }
    })();
    return this.fetching;
  }

  /** Guarda a resposta de um PUT/DELETE desta tela (a versão mais nova que a central tem). */
  apply(data: Dashboard) {
    if (this.state.data && data.rev < this.state.data.rev) return;
    this.set({ status: "ready", data });
  }
}

export const dashboardStore = new DashStore();

export function useDashboard(): DashState {
  useEffect(() => dashboardStore.start(), []);
  return useSyncExternalStore(dashboardStore.subscribe, dashboardStore.get);
}
