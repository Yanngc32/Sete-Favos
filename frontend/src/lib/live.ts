// Estado ao vivo da casa via WebSocket (/api/ws): retrato inicial + eventos.
// Reconecta sozinho; enquanto estiver fora, a UI mostra o último valor conhecido.

import { useSyncExternalStore } from "react";
import type { Candidate, DiscoveryJob, LiveEvent, Snapshot } from "./types";

export type Connection = "connecting" | "online" | "offline" | "unauthorized";

export interface LiveState extends Snapshot {
  connection: Connection;
  /** Quando a conexão caiu (para "há X min"). */
  offlineSince: number | null;
  loaded: boolean;
}

type Listener = () => void;
type EventListener = (event: LiveEvent) => void;

const EMPTY: LiveState = {
  devices: [],
  rooms: [],
  virtuals: [],
  routines: [],
  automations: [],
  connection: "connecting",
  offlineSince: null,
  loaded: false,
};

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function reduce(state: LiveState, e: LiveEvent): LiveState {
  switch (e.t) {
    case "snapshot":
      return { ...state, devices: e.devices, rooms: e.rooms, virtuals: e.virtuals, routines: e.routines,
        automations: e.automations, loaded: true };
    case "device": {
      const devices = upsert(state.devices, e.device);
      const rooms = e.device.room && !state.rooms.includes(e.device.room)
        ? [...state.rooms, e.device.room].sort((a, b) => a.localeCompare(b, "pt-BR"))
        : state.rooms;
      return { ...state, devices, rooms };
    }
    case "device_removed":
      return { ...state, devices: state.devices.filter((d) => d.id !== e.id) };
    case "virtual":
      return { ...state, virtuals: upsert(state.virtuals, e.virtual) };
    case "virtual_removed":
      return { ...state, virtuals: state.virtuals.filter((v) => v.id !== e.id) };
    case "routine":
      return { ...state, routines: upsert(state.routines, e.routine) };
    case "routine_removed":
      return { ...state, routines: state.routines.filter((r) => r.id !== e.id) };
    case "automation":
      return { ...state, automations: upsert(state.automations, e.automation) };
    case "automation_removed":
      return { ...state, automations: state.automations.filter((a) => a.id !== e.id) };
    default:
      return state;
  }
}

class LiveStore {
  private state: LiveState = EMPTY;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  get = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Eventos crus (descoberta, pareamento...). */
  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private set(next: LiveState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/api/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ ...this.state, connection: "online", offlineSince: null });
    };
    ws.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as LiveEvent;
      if (event.t === "ping") return;
      this.set(reduce(this.state, event));
      for (const l of this.eventListeners) l(event);
    };
    ws.onclose = (ev) => {
      this.ws = null;
      // 4401 = não autorizado / revogado: não insiste.
      if (ev.code === 4401) {
        this.set({ ...this.state, connection: "unauthorized" });
        return;
      }
      this.set({
        ...this.state,
        connection: "offline",
        offlineSince: this.state.offlineSince ?? Date.now(),
      });
      const delay = Math.min(15000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  reconnectNow() {
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    if (!this.ws) this.connect();
  }
}

export const live = new LiveStore();

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.get);
}

export function waitDiscovery(jobId: string, onCandidate: (c: Candidate) => void, onDone: (j: DiscoveryJob) => void) {
  return live.onEvent((e) => {
    if (e.t === "discovery" && e.job === jobId) onCandidate(e.candidate);
    if (e.t === "discovery_done" && e.job === jobId) onDone(e);
  });
}
