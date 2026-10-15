// O que os cards e as seções do painel precisam saber, passado por contexto (evita carregar 12 props em cada nível).
import { createContext, useContext, type HTMLAttributes } from "react";
import type { DashCard, DashSection, DashView, Device, Routine, VirtualObject } from "@/lib/types";
import type { CardMenuAction } from "../DeviceCard";
import type { DragKind } from "./drag";

/** Dados vivos da casa + como desenhar (o que a Início automática já usava). */
export interface Env {
  devices: Device[];
  routines: Routine[];
  virtuals: VirtualObject[];
  rooms: string[];
  /** Central fora: controles desabilitados, último valor + "há X min". */
  stale: string | null;
  /** Central no ar (rotinas e objetos só rodam assim). */
  online: boolean;
  /** Celular: grade de 2 colunas e frases curtas. */
  compact: boolean;
  now: number;
  onLocal: (id: string) => void;
  onMenu: (device: Device, action: CardMenuAction) => void;
  /** Modo normal: apaga um card de referência quebrada direto no painel salvo. */
  dropCard: (cardId: string) => void;
}

export const EnvCtx = createContext<Env | null>(null);

export function useEnv(): Env {
  const env = useContext(EnvCtx);
  if (!env) throw new Error("EnvCtx ausente");
  return env;
}

/** Só existe no modo editar. */
export interface Edit {
  /** Rascunho inteiro (abas, seções e cards). */
  views: DashView[];
  /** Arrastando (mouse/toque) ou com a alça pega (teclado). */
  dragging: { kind: DragKind; id: string; mode: "pointer" | "keyboard" } | null;
  gripProps: (kind: DragKind, id: string) => HTMLAttributes<HTMLElement> & { "data-grip": string };
  /** Card aberto no "Configurar card". */
  selectedId: string | null;
  configure: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  addCard: (sectionId: string) => void;
  renameSection: (sectionId: string, title: string) => void;
  moveSection: (sectionId: string, delta: -1 | 1) => void;
  removeSection: (section: DashSection, viewId: string) => void;
  addSection: (viewId: string, index: number) => void;
  /** Alças e botões que mexem em quantidade respeitam os limites. */
  canAddSection: (viewId: string) => boolean;
  canAddCard: (sectionId: string) => boolean;
  // abas
  renameView: (viewId: string, name: string) => void;
  moveView: (viewId: string, delta: -1 | 1) => void;
  removeView: (view: DashView) => void;
  /** Cria uma aba, mostra ela e devolve o id (a barra de abas já abre o renomear). */
  addView: () => string | null;
  canAddView: boolean;
}

export const EditCtx = createContext<Edit | null>(null);

export function useEdit(): Edit | null {
  return useContext(EditCtx);
}

/** Nome falado de um card (alça, engrenagem, anúncios). */
export function cardLabel(card: DashCard, env: Pick<Env, "devices" | "routines" | "virtuals">): string {
  if (card.name) return card.name;
  switch (card.type) {
    case "device":
      return env.devices.find((d) => d.id === card.device_id)?.name ?? "card removido";
    case "routine":
      return env.routines.find((r) => r.id === card.routine_id)?.name ?? "card removido";
    case "virtual":
      return env.virtuals.find((v) => v.id === card.virtual_id)?.name ?? "card removido";
    case "glance":
      return "Lista compacta";
    case "summary":
      return "Resumo da casa";
  }
}
