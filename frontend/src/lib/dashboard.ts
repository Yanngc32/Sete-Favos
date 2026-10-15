// Operações sobre o painel personalizável. Tudo puro e imutável: o modo editar trabalha numa cópia
// e só vira PUT quando a pessoa toca em Concluir. Limites iguais aos do backend (casa/dashboard.py).
import type { DashCard, DashSection, DashView, Device, Routine, VirtualObject } from "@/lib/types";

export const MAX_VIEWS = 10;
export const MAX_SECTIONS = 20;
export const MAX_CARDS_PER_SECTION = 60;
export const MAX_GLANCE = 12;
export const MAX_CARDS = 400;

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type Views = readonly DashView[];

/** Onde um card está: aba, seção e posição na seção. */
export interface Slot {
  viewId: string;
  sectionId: string;
  index: number;
}

export function locate(views: Views, cardId: string): Slot | null {
  for (const v of views) {
    for (const s of v.sections) {
      const index = s.cards.findIndex((c) => c.id === cardId);
      if (index >= 0) return { viewId: v.id, sectionId: s.id, index };
    }
  }
  return null;
}

export function findCard(views: Views, cardId: string): DashCard | null {
  const at = locate(views, cardId);
  if (!at) return null;
  return views.find((v) => v.id === at.viewId)!.sections.find((s) => s.id === at.sectionId)!.cards[at.index];
}

const mapSection = (views: Views, sectionId: string, fn: (s: DashSection) => DashSection): DashView[] =>
  views.map((v) => ({ ...v, sections: v.sections.map((s) => (s.id === sectionId ? fn(s) : s)) }));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Cards ------------------------------------------------------------------------

export function addCard(views: Views, sectionId: string, card: Omit<DashCard, "id"> & { id?: string }, index?: number): DashView[] {
  return mapSection(views, sectionId, (s) => {
    if (s.cards.length >= MAX_CARDS_PER_SECTION) return s;
    const at = clamp(index ?? s.cards.length, 0, s.cards.length);
    const next = [...s.cards];
    next.splice(at, 0, { ...card, id: card.id ?? newId() } as DashCard);
    return { ...s, cards: next };
  });
}

export function updateCard(views: Views, cardId: string, patch: Partial<Omit<DashCard, "id">>): DashView[] {
  return views.map((v) => ({
    ...v,
    sections: v.sections.map((s) => ({ ...s, cards: s.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) })),
  }));
}

export function removeCard(views: Views, cardId: string): DashView[] {
  return views.map((v) => ({
    ...v,
    sections: v.sections.map((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== cardId) })),
  }));
}

/** Move o card pra `to` (a posição é a que vale DEPOIS de tirar o card de onde estava). */
export function moveCard(views: Views, cardId: string, to: Slot): DashView[] {
  const card = findCard(views, cardId);
  if (!card) return [...views];
  const target = views.find((v) => v.id === to.viewId)?.sections.find((s) => s.id === to.sectionId);
  const from = locate(views, cardId);
  if (!target || !from) return [...views];
  if (from.sectionId !== to.sectionId && target.cards.length >= MAX_CARDS_PER_SECTION) return [...views];
  return addCard(removeCard(views, cardId), to.sectionId, card, to.index);
}

/** Um passo de teclado: -1/+1 na seção; ao passar da ponta, vai pro fim/início da seção vizinha (e da aba vizinha). */
export function stepCard(views: Views, cardId: string, delta: -1 | 1): { views: DashView[]; slot: Slot } | null {
  const at = locate(views, cardId);
  if (!at) return null;
  const view = views.find((v) => v.id === at.viewId)!;
  const si = view.sections.findIndex((s) => s.id === at.sectionId);
  const section = view.sections[si];
  const inside = at.index + delta;
  let slot: Slot;
  if (inside >= 0 && inside < section.cards.length) {
    slot = { ...at, index: inside };
  } else {
    const next = view.sections[si + delta];
    if (!next) return null;
    slot = { viewId: view.id, sectionId: next.id, index: delta === 1 ? 0 : next.cards.length };
  }
  return { views: moveCard(views, cardId, slot), slot };
}

/** Move o card pro fim da última seção da aba (cria uma seção se a aba não tem nenhuma). Usado no "Mover para a aba…". */
export function moveCardToView(views: Views, cardId: string, viewId: string): DashView[] {
  const card = findCard(views, cardId);
  const from = locate(views, cardId);
  const target = views.find((v) => v.id === viewId);
  if (!card || !from || !target || from.viewId === viewId) return [...views];
  let next = removeCard(views, cardId);
  if (!next.find((v) => v.id === viewId)!.sections.length) next = addSection(next, viewId);
  const last = next.find((v) => v.id === viewId)!.sections.at(-1)!;
  if (last.cards.length >= MAX_CARDS_PER_SECTION) return [...views];
  return addCard(next, last.id, card);
}

export function totalCards(views: Views): number {
  return views.reduce((n, v) => n + countCards(v), 0);
}

/** Cabe mais um card nesta seção (60 por seção, 400 no painel)? */
export function canAddCard(views: Views, sectionId: string): boolean {
  const section = views.flatMap((v) => v.sections).find((s) => s.id === sectionId);
  return !!section && section.cards.length < MAX_CARDS_PER_SECTION && totalCards(views) < MAX_CARDS;
}

/** Posição do card na seção, pro anúncio do leitor de tela: "posição 2 de 5 na seção Sala". */
export function describeSlot(views: Views, cardId: string): { position: number; total: number; section: string | null; view: string } | null {
  const at = locate(views, cardId);
  if (!at) return null;
  const view = views.find((v) => v.id === at.viewId)!;
  const section = view.sections.find((s) => s.id === at.sectionId)!;
  return { position: at.index + 1, total: section.cards.length, section: section.title?.trim() || null, view: view.name };
}

// Seções ------------------------------------------------------------------------

export function addSection(views: Views, viewId: string, section?: Partial<DashSection>, index?: number): DashView[] {
  return views.map((v) => {
    if (v.id !== viewId || v.sections.length >= MAX_SECTIONS) return v;
    const at = clamp(index ?? v.sections.length, 0, v.sections.length);
    const next = [...v.sections];
    next.splice(at, 0, { id: newId(), title: null, cards: [], ...section });
    return { ...v, sections: next };
  });
}

export function renameSection(views: Views, sectionId: string, title: string): DashView[] {
  return mapSection(views, sectionId, (s) => ({ ...s, title: title.trim() || null }));
}

export function removeSection(views: Views, sectionId: string): DashView[] {
  return views.map((v) => ({ ...v, sections: v.sections.filter((s) => s.id !== sectionId) }));
}

export function moveSection(views: Views, sectionId: string, delta: -1 | 1): DashView[] {
  return views.map((v) => {
    const i = v.sections.findIndex((s) => s.id === sectionId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= v.sections.length) return v;
    const next = [...v.sections];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...v, sections: next };
  });
}

/** Põe a seção na posição `index` da aba (a posição vale DEPOIS de tirar a seção de onde estava). */
export function moveSectionTo(views: Views, sectionId: string, index: number): DashView[] {
  return views.map((v) => {
    const i = v.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) return v;
    const next = [...v.sections];
    const [section] = next.splice(i, 1);
    next.splice(clamp(index, 0, next.length), 0, section);
    return { ...v, sections: next };
  });
}

// Abas ---------------------------------------------------------------------------

export function addView(views: Views, name: string): DashView[] {
  if (views.length >= MAX_VIEWS) return [...views];
  return [...views, { id: newId(), name: name.trim() || `Aba ${views.length + 1}`, sections: [] }];
}

export function renameView(views: Views, viewId: string, name: string): DashView[] {
  const clean = name.trim();
  return views.map((v) => (v.id === viewId && clean ? { ...v, name: clean } : v));
}

export function removeView(views: Views, viewId: string): DashView[] {
  return views.length > 1 ? views.filter((v) => v.id !== viewId) : [...views];
}

export function moveView(views: Views, viewId: string, delta: -1 | 1): DashView[] {
  const i = views.findIndex((v) => v.id === viewId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= views.length) return [...views];
  const next = [...views];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function countCards(view: DashView): number {
  return view.sections.reduce((n, s) => n + s.cards.length, 0);
}

// Painel automático → painel próprio ("Personalizar") --------------------------

/** Colunas padrão de um card novo: ar e robô pedem 2 (herói/largo), o resto 1. */
export function defaultCols(d: Pick<Device, "kind" | "vendor">): 1 | 2 {
  return d.vendor !== "grupo" && (d.kind === "ac" || d.kind === "vacuum") ? 2 : 1;
}

const deviceCard = (d: Device): DashCard => ({ id: newId(), type: "device", cols: defaultCols(d), device_id: d.id });

/**
 * O que o painel automático mostra hoje, escrito como painel próprio: topo (resumo, rotinas e objetos
 * fixados), "Fixados" e um bloco por cômodo (os que têm mais aparelhos primeiro).
 */
export function fromAuto(devices: Device[], rooms: string[], routines: Routine[], virtuals: VirtualObject[]): DashView[] {
  const top: DashCard[] = [{ id: newId(), type: "summary", cols: 4 }];
  for (const r of routines.filter((x) => x.pinned).slice(0, 6)) {
    top.push({ id: newId(), type: "routine", cols: 1, routine_id: r.id });
  }
  for (const v of virtuals.filter((x) => x.pinned)) {
    top.push({ id: newId(), type: "virtual", cols: 1, virtual_id: v.id });
  }
  const sections: DashSection[] = [{ id: newId(), title: null, cards: top }];

  const pinned = devices.filter((d) => d.pinned);
  if (pinned.length) sections.push({ id: newId(), title: "Fixados", cards: pinned.map(deviceCard) });

  const rest = devices.filter((d) => !d.pinned);
  const count = (r: string) => rest.filter((d) => d.room === r).length;
  const ordered = [...rooms].sort((a, b) => count(b) - count(a) || a.localeCompare(b, "pt-BR"));
  for (const room of ordered) {
    const inRoom = rest.filter((d) => d.room === room);
    if (inRoom.length) sections.push({ id: newId(), title: room, cards: inRoom.map(deviceCard) });
  }
  const loose = rest.filter((d) => !d.room || !rooms.includes(d.room));
  if (loose.length) sections.push({ id: newId(), title: "Sem cômodo", cards: loose.map(deviceCard) });
  return [{ id: newId(), name: "Casa", sections }];
}

/** Um card por aparelho do cômodo (atalho "Todos de um cômodo" do seletor de cards). */
export function roomCards(devices: Device[], room: string): DashCard[] {
  return devices.filter((d) => d.room === room).map(deviceCard);
}

/** Referências do painel que não existem mais (aparelho, rotina ou objeto removido). */
export function isBroken(card: DashCard, devices: Device[], routines: Routine[], virtuals: VirtualObject[]): boolean {
  switch (card.type) {
    case "device":
      return !devices.some((d) => d.id === card.device_id);
    case "glance":
      return !(card.device_ids ?? []).some((id) => devices.some((d) => d.id === id));
    case "routine":
      return !routines.some((r) => r.id === card.routine_id);
    case "virtual":
      return !virtuals.some((v) => v.id === card.virtual_id);
    default:
      return false;
  }
}

// Configuração de um card -------------------------------------------------------

/** Card ainda sem o que mostrar (acabou de ser adicionado e a pessoa não escolheu nada). Mesma regra do backend. */
export function isComplete(card: DashCard): boolean {
  switch (card.type) {
    case "device":
      return !!card.device_id;
    case "glance":
      return (card.device_ids ?? []).length > 0;
    case "routine":
      return !!card.routine_id;
    case "virtual":
      return !!card.virtual_id;
    default:
      return true;
  }
}

/** Menor largura que o card aguenta: a lista compacta e o robô (card largo, em linha) pedem 2 colunas. */
export function minCols(card: Pick<DashCard, "type">, device?: Pick<Device, "kind" | "vendor"> | null): 1 | 2 {
  if (card.type === "glance") return 2;
  if (card.type === "device" && device && device.vendor !== "grupo" && device.kind === "vacuum") return 2;
  return 1;
}

/** Card novo de cada tipo, sem o que mostrar (device_id etc.). */
export function blankCard(type: DashCard["type"]): Omit<DashCard, "id"> {
  switch (type) {
    case "glance":
      return { type, cols: 2, device_ids: [] };
    case "summary":
      return { type, cols: 4 };
    default:
      return { type, cols: 1 };
  }
}

export function sameViews(a: Views, b: Views): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
