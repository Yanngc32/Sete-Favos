// Arrastar no modo editar: mouse, toque (segura ~200 ms; a rolagem da página continua valendo até lá) e teclado.
//
// Modelo: o card (ou a seção) fica no lugar como "fantasma" e uma cópia flutua junto do ponteiro. O destino é
// mostrado por uma linha-guia latão; só ao soltar o rascunho muda (moveCard / moveSectionTo). Por isso o layout não
// se mexe durante o arraste e a conta do destino é só geometria (nada de reordenar ao vivo).
//
// Teclado: alça focada, Espaço pega, setas movem (stepCard / moveSection), Espaço solta, Esc cancela.
// Sem dependência: o destino é "o card mais perto do ponteiro", que nenhum sortable de grade faz com larguras
// diferentes; só os sensores (ponteiro com atraso, auto-rolagem, teclado) dariam algo, e são ~150 linhas.
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { describeSlot, locate, moveCard, moveCardToView, moveSection, moveSectionTo, stepCard, type Slot } from "@/lib/dashboard";
import type { DashView } from "@/lib/types";

export type DragKind = "card" | "section";

/** Linha-guia: "v" vertical (entre cards da mesma linha), "h" horizontal, "box" contorno (seção vazia). Em px, relativo ao quadro. */
export interface Guide {
  kind: "v" | "h" | "box";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CardDrop {
  viewId: string;
  sectionId: string;
  index: number;
  guide: Guide;
}

interface SectionDrop {
  viewId: string;
  index: number;
  guide: Guide | null;
}

const GAP = 12; // --space-sm: espaço entre cards da grade
const LINE = 3;
const HOLD_MS = 200;
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 10;
const EDGE = 72; // faixa de auto-rolagem nas bordas
const DWELL_MS = 520; // parar em cima de uma aba troca de aba

const overlapY = (a: DOMRect, b: DOMRect) => a.top < b.bottom - 4 && a.bottom > b.top + 4;

function distance(r: DOMRect, x: number, y: number) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** Destino de um card: seção do ponteiro, card mais perto (sem contar o arrastado) e se entra antes ou depois dele. */
function findCardDrop(board: HTMLElement, x: number, y: number, dragId: string): CardDrop | null {
  const sections = [...board.querySelectorAll<HTMLElement>("[data-sec-id]")];
  if (!sections.length) return null;
  let sec = sections[0];
  let best = Infinity;
  for (const s of sections) {
    const r = s.getBoundingClientRect();
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < best) {
      best = d;
      sec = s;
    }
  }
  const b = board.getBoundingClientRect();
  const viewId = sec.dataset.viewId ?? "";
  const sectionId = sec.dataset.secId ?? "";
  const all = [...sec.querySelectorAll<HTMLElement>("[data-card-id]")];
  const slots = all.filter((e) => e.dataset.cardId !== dragId);
  if (!slots.length) {
    const r = (sec.querySelector<HTMLElement>("[data-zone]") ?? sec).getBoundingClientRect();
    return { viewId, sectionId, index: 0, guide: { kind: "box", x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height } };
  }
  let near = slots[0];
  let nd = Infinity;
  let nc = Infinity;
  for (const s of slots) {
    const r = s.getBoundingClientRect();
    const d = distance(r, x, y);
    const c = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < nd - 0.5 || (Math.abs(d - nd) <= 0.5 && c < nc)) {
      near = s;
      nd = d;
      nc = c;
    }
  }
  const r = near.getBoundingClientRect();
  const i = slots.indexOf(near);
  // O layout não muda durante o arraste: o lugar vazio do próprio card conta como vizinho de linha
  // (senão, na grade de 2 colunas, "Luz | TV" vira pilha e soltar à direita da TV não muda nada).
  const sameRow = all.some((s) => s !== near && overlapY(s.getBoundingClientRect(), r));
  if (sameRow) {
    const after = x > r.left + r.width / 2;
    const gx = (after ? r.right + GAP / 2 : r.left - GAP / 2) - LINE / 2;
    return { viewId, sectionId, index: i + (after ? 1 : 0), guide: { kind: "v", x: gx - b.left, y: r.top - b.top, w: LINE, h: r.height } };
  }
  const after = y > r.top + r.height / 2;
  const gy = (after ? r.bottom + GAP / 2 : r.top - GAP / 2) - LINE / 2;
  return { viewId, sectionId, index: i + (after ? 1 : 0), guide: { kind: "h", x: r.left - b.left, y: gy - b.top, w: r.width, h: LINE } };
}

/** Destino de uma seção: antes da primeira seção cujo meio está abaixo do ponteiro. */
function findSectionDrop(board: HTMLElement, y: number, dragId: string): SectionDrop | null {
  const all = [...board.querySelectorAll<HTMLElement>("[data-sec-id]")];
  const secs = all.filter((s) => s.dataset.secId !== dragId);
  const viewId = all[0]?.dataset.viewId;
  if (!viewId) return null;
  if (!secs.length) return { viewId, index: 0, guide: null };
  const b = board.getBoundingClientRect();
  let index = secs.length;
  for (let i = 0; i < secs.length; i++) {
    const r = secs[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      index = i;
      break;
    }
  }
  const ref = index < secs.length ? secs[index].getBoundingClientRect() : secs[secs.length - 1].getBoundingClientRect();
  const gy = (index < secs.length ? ref.top - GAP : ref.bottom + GAP) - LINE / 2;
  return { viewId, index, guide: { kind: "h", x: 0, y: gy - b.top, w: b.width, h: LINE } };
}

const sameGuide = (a: Guide | null, b: Guide | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

function insetTop(): number {
  return document.querySelector<HTMLElement>("[data-edit-top]")?.getBoundingClientRect().bottom ?? 0;
}

function insetBottom(): number {
  const tabbar = document.querySelector<HTMLElement>(".tabbar");
  if (!tabbar || getComputedStyle(tabbar).display === "none") return 0;
  return tabbar.getBoundingClientRect().height;
}

interface Active {
  kind: DragKind;
  id: string;
  mode: "pointer" | "keyboard";
}

interface Run {
  kind: DragKind;
  id: string;
  pointerId: number;
  type: string;
  grip: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
  float?: HTMLElement;
  grabX: number;
  grabY: number;
  card: CardDrop | null;
  section: SectionDrop | null;
  dirty: boolean;
  raf: number;
  dwellId: string | null;
  dwellTimer?: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export interface BoardDragOptions {
  boardRef: RefObject<HTMLElement | null>;
  /** Rascunho mais recente (lido na hora de soltar e a cada passo de teclado). */
  viewsRef: RefObject<DashView[]>;
  /** Aplica uma mudança no rascunho. */
  commit: (fn: (views: DashView[]) => DashView[]) => void;
  /** Troca a aba mostrada (ao parar em cima de uma aba durante o arraste, ou quando o teclado leva o card pra outra). */
  showView: (viewId: string) => void;
  /** Nome falado do card ou da seção. */
  label: (kind: DragKind, id: string) => string;
}

export function useBoardDrag({ boardRef, viewsRef, commit, showView, label }: BoardDragOptions) {
  const [active, setActive] = useState<Active | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [message, setMessage] = useState("");
  /** Texto do balão: segue o destino durante o arraste. */
  const [bubble, setBubble] = useState("");
  const run = useRef<Run | null>(null);
  const kbd = useRef<{ kind: DragKind; id: string; snapshot: DashView[] } | null>(null);
  const opts = useRef({ commit, showView, label });
  opts.current = { commit, showView, label };

  const speak = useCallback((text: string) => setMessage(text), []);

  function slotText(views: DashView[], id: string): string {
    const d = describeSlot(views, id);
    if (!d) return "";
    return `${opts.current.label("card", id)}, posição ${d.position} de ${d.total} na seção ${d.section ?? "sem título"}`;
  }

  function sectionText(views: DashView[], id: string): string {
    const view = views.find((v) => v.sections.some((s) => s.id === id));
    if (!view) return "";
    const i = view.sections.findIndex((s) => s.id === id);
    return `${opts.current.label("section", id)}, posição ${i + 1} de ${view.sections.length}`;
  }

  // ---- ponteiro ------------------------------------------------------------------------------------------------

  function place(r: Run) {
    const board = boardRef.current;
    if (!board || !r.float) return;
    const b = board.getBoundingClientRect();
    const lift = r.type === "touch" ? -14 : 0;
    r.float.style.transform = `translate3d(${r.x - r.grabX - b.left}px, ${r.y - r.grabY - b.top + lift}px, 0) scale(1.02)`;
  }

  function retarget(r: Run) {
    const board = boardRef.current;
    if (!board) return;
    if (r.kind === "card") {
      const drop = findCardDrop(board, r.x, r.y, r.id);
      r.card = drop;
      setGuide((g) => (sameGuide(g, drop?.guide ?? null) ? g : (drop?.guide ?? null)));
      if (drop) {
        const probe = viewsRef.current;
        // O texto usa a posição que o card terá DEPOIS de soltar ("posição 2 de 3").
        const view = probe.find((v) => v.id === drop.viewId);
        const section = view?.sections.find((s) => s.id === drop.sectionId);
        if (view && section) {
          const own = section.cards.some((c) => c.id === r.id);
          const total = section.cards.length + (own ? 0 : 1);
          setBubble(`${opts.current.label("card", r.id)}, posição ${drop.index + 1} de ${total} na seção ${section.title?.trim() || "sem título"}`);
        }
      }
    } else {
      const drop = findSectionDrop(board, r.y, r.id);
      r.section = drop;
      setGuide((g) => (sameGuide(g, drop?.guide ?? null) ? g : (drop?.guide ?? null)));
      if (drop) {
        const total = viewsRef.current.find((v) => v.id === drop.viewId)?.sections.length ?? 0;
        setBubble(`${opts.current.label("section", r.id)}, posição ${drop.index + 1} de ${total}`);
      }
    }
  }

  function dwell(r: Run) {
    const el = document.elementFromPoint(r.x, r.y)?.closest<HTMLElement>("[data-tab-id]") ?? null;
    const id = el?.dataset.tabId ?? null;
    if (id === r.dwellId) return;
    clearTimeout(r.dwellTimer);
    r.dwellId = id;
    if (id) {
      r.dwellTimer = setTimeout(() => {
        opts.current.showView(id);
        setTimeout(() => (r.dirty = true), 80); // a aba nova ainda vai ser desenhada: refaz o destino depois
      }, DWELL_MS);
    }
  }

  function tick(r: Run) {
    if (run.current !== r) return;
    const top = insetTop() + EDGE / 2;
    const bottom = window.innerHeight - insetBottom() - EDGE / 2;
    let dy = 0;
    if (r.y < top) dy = -Math.min(1, (top - r.y) / EDGE) * 18;
    else if (r.y > bottom) dy = Math.min(1, (r.y - bottom) / EDGE) * 18;
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) r.dirty = true;
    }
    if (r.dirty) {
      r.dirty = false;
      place(r);
      retarget(r);
      dwell(r);
    }
    r.raf = requestAnimationFrame(() => tick(r));
  }

  function makeFloat(r: Run): HTMLElement | undefined {
    const board = boardRef.current;
    if (!board) return;
    const source = board.querySelector<HTMLElement>(r.kind === "card" ? `[data-card-id="${CSS.escape(r.id)}"]` : `[data-sec-id="${CSS.escape(r.id)}"] [data-sec-head]`);
    if (!source) return;
    const rect = source.getBoundingClientRect();
    const clone = source.cloneNode(true) as HTMLElement;
    for (const el of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
      el.removeAttribute("id");
      el.removeAttribute("data-card-id");
      el.removeAttribute("data-sec-id");
      el.removeAttribute("data-grip");
      el.removeAttribute("data-ghost");
      el.removeAttribute("tabindex");
    }
    clone.classList.add("ep-float");
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    // Input clonado não leva o valor digitado: copia o que a pessoa vê.
    const src = source.querySelectorAll<HTMLInputElement>("input");
    clone.querySelectorAll<HTMLInputElement>("input").forEach((el, i) => (el.value = src[i]?.value ?? ""));
    board.appendChild(clone);
    r.grabX = r.startX - rect.left;
    r.grabY = r.startY - rect.top;
    return clone;
  }

  function begin(r: Run) {
    if (r.started || run.current !== r) return;
    r.started = true;
    r.float = makeFloat(r);
    if (!r.float) return end(r, false);
    try {
      boardRef.current?.setPointerCapture(r.pointerId);
    } catch {
      /* ponteiro já soltou */
    }
    document.body.style.userSelect = "none";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    boardRef.current?.setAttribute("data-dragging", "");
    setActive({ kind: r.kind, id: r.id, mode: "pointer" });
    place(r);
    r.dirty = true;
    r.raf = requestAnimationFrame(() => tick(r));
    window.getSelection()?.removeAllRanges();
    setMessage(`${opts.current.label(r.kind, r.id)} pego`);
  }

  function end(r: Run, drop: boolean) {
    if (run.current !== r) return;
    run.current = null;
    clearTimeout(r.timer);
    clearTimeout(r.dwellTimer);
    cancelAnimationFrame(r.raf);
    r.cleanup();
    r.float?.remove();
    document.body.style.userSelect = "";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "";
    boardRef.current?.removeAttribute("data-dragging");
    try {
      boardRef.current?.releasePointerCapture(r.pointerId);
    } catch {
      /* já solto */
    }
    setActive(null);
    setGuide(null);
    setBubble("");
    if (!r.started) return;
    if (!drop) return setMessage("Movimento cancelado");
    // Soltou em cima de uma aba: o card vai pro fim dela.
    const tab = r.kind === "card" ? document.elementFromPoint(r.x, r.y)?.closest<HTMLElement>("[data-tab-id]") : null;
    if (tab?.dataset.tabId) {
      const to = tab.dataset.tabId;
      const from = locate(viewsRef.current, r.id);
      if (from && from.viewId !== to) {
        const next = moveCardToView(viewsRef.current, r.id, to);
        opts.current.commit(() => next);
        opts.current.showView(to);
        setMessage(`${slotText(next, r.id)}, solto na aba ${next.find((v) => v.id === to)?.name ?? ""}`);
        focusGrip("card", r.id, true);
      }
      return;
    }
    if (r.kind === "card" && r.card) {
      const slot: Slot = { viewId: r.card.viewId, sectionId: r.card.sectionId, index: r.card.index };
      const next = moveCard(viewsRef.current, r.id, slot);
      opts.current.commit(() => next);
      setMessage(`${slotText(next, r.id)}, solto`);
      focusGrip("card", r.id, false);
    } else if (r.kind === "section" && r.section) {
      const next = moveSectionTo(viewsRef.current, r.id, r.section.index);
      opts.current.commit(() => next);
      setMessage(`${sectionText(next, r.id)}, solta`);
      focusGrip("section", r.id, false);
    }
  }

  function onPointerDown(kind: DragKind, id: string, e: RPointerEvent<HTMLElement>) {
    if (run.current || kbd.current || (e.pointerType === "mouse" && e.button !== 0) || !e.isPrimary) return;
    const grip = e.currentTarget;
    const r: Run = {
      kind,
      id,
      pointerId: e.pointerId,
      type: e.pointerType,
      grip,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      started: false,
      grabX: 0,
      grabY: 0,
      card: null,
      section: null,
      dirty: false,
      raf: 0,
      dwellId: null,
      cleanup: () => {},
    };
    const touch = e.pointerType !== "mouse" && e.pointerType !== "pen";
    const slop = touch ? TOUCH_SLOP : MOUSE_SLOP;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== r.pointerId) return;
      r.x = ev.clientX;
      r.y = ev.clientY;
      if (!r.started) {
        if (Math.hypot(r.x - r.startX, r.y - r.startY) > slop) {
          if (touch) end(r, false); // mexeu antes dos 200 ms: é rolagem, não arraste
          else begin(r);
        }
        return;
      }
      r.dirty = true;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === r.pointerId) end(r, ev.type === "pointerup");
    };
    // Depois de pegar, o dedo não rola a página. O ouvinte tem que ser não-passivo e já estar no lugar quando o dedo
    // anda (também na alça: se a aba trocar no meio do arraste, o toque continua indo pra ela).
    const onTouchMove = (ev: TouchEvent) => {
      if (r.started && ev.cancelable) ev.preventDefault();
    };
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        end(r, false);
      }
    };
    const onBlur = () => end(r, false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    grip.addEventListener("touchmove", onTouchMove, { passive: false });
    r.cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("touchmove", onTouchMove);
      grip.removeEventListener("touchmove", onTouchMove);
    };
    run.current = r;
    if (touch) r.timer = setTimeout(() => begin(r), HOLD_MS);
    else e.preventDefault(); // mouse: sem seleção de texto nem arraste nativo
  }

  // ---- teclado -------------------------------------------------------------------------------------------------

  function focusGrip(kind: DragKind, id: string, scroll: boolean) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = boardRef.current?.querySelector<HTMLElement>(`[data-grip="${kind}:${CSS.escape(id)}"]`);
        el?.focus({ preventScroll: true });
        if (scroll) el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }),
    );
  }

  function drop(announce: boolean) {
    const k = kbd.current;
    if (!k) return;
    kbd.current = null;
    setActive(null);
    setBubble("");
    if (announce) setMessage(`${k.kind === "card" ? slotText(viewsRef.current, k.id) : sectionText(viewsRef.current, k.id)}, ${k.kind === "card" ? "solto" : "solta"}`);
  }

  function onKeyDown(kind: DragKind, id: string, e: KeyboardEvent<HTMLElement>) {
    const k = kbd.current;
    const isThis = k?.kind === kind && k.id === id;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isThis) return drop(true);
      if (k || run.current) return;
      kbd.current = { kind, id, snapshot: viewsRef.current };
      setActive({ kind, id, mode: "keyboard" });
      const where = kind === "card" ? slotText(viewsRef.current, id) : sectionText(viewsRef.current, id);
      setBubble(where);
      setMessage(`${where}. ${kind === "card" ? "Pego" : "Pega"}. Setas movem, Espaço solta, Esc cancela`);
      return;
    }
    if (!isThis) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      const snapshot = k!.snapshot;
      opts.current.commit(() => snapshot);
      drop(false);
      setMessage("Movimento cancelado");
      focusGrip(kind, id, true);
      return;
    }
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) {
      if (e.key === "Tab") drop(true);
      return;
    }
    e.preventDefault();
    const views = viewsRef.current;
    if (kind === "card") {
      const r = stepCard(views, id, delta);
      if (!r) return setMessage(`${slotText(views, id)}. ${delta === 1 ? "Já é o último" : "Já é o primeiro"}`);
      viewsRef.current = r.views;
      opts.current.commit(() => r.views);
      const text = slotText(r.views, id);
      setBubble(text);
      setMessage(text);
    } else {
      const next = moveSection(views, id, delta);
      if (next.every((v, i) => v === views[i])) {
        return setMessage(`${sectionText(views, id)}. ${delta === 1 ? "Já é a última" : "Já é a primeira"}`);
      }
      viewsRef.current = next;
      opts.current.commit(() => next);
      const text = sectionText(next, id);
      setBubble(text);
      setMessage(text);
    }
    focusGrip(kind, id, true);
  }

  // O foco foi pra outro lugar de verdade (clique, Tab): solta onde está. Sem relatedTarget é só a alça sendo
  // remontada em outra seção (o foco volta pra ela em seguida).
  useEffect(() => {
    if (!active || active.mode !== "keyboard") return;
    const onOut = (e: FocusEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (to && !to.closest("[data-grip]")) drop(true);
    };
    document.addEventListener("focusout", onOut);
    return () => document.removeEventListener("focusout", onOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(
    () => () => {
      const r = run.current;
      if (r) end(r, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const gripProps = useCallback(
    (kind: DragKind, id: string): HTMLAttributes<HTMLElement> & { "data-grip": string } => ({
      "data-grip": `${kind}:${id}`,
      onPointerDown: (e) => onPointerDown(kind, id, e),
      onKeyDown: (e) => onKeyDown(kind, id, e),
      onKeyUp: (e) => {
        if (e.key === " " || e.key === "Enter") e.preventDefault(); // o clique do Espaço não conta
      },
      onClick: (e) => e.preventDefault(),
      onContextMenu: (e) => e.preventDefault(),
      onDragStart: (e) => e.preventDefault(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { active, guide, message, bubble, gripProps, speak, hold: active?.mode === "keyboard" };
}
