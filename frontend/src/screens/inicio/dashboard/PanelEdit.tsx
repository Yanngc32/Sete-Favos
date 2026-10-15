// Modo editar do painel: faixa fixa, abas, seções e cards com alça e engrenagem, "Adicionar card" e "Configurar card".
// Tudo vai pro rascunho (editor.patch); o PUT só acontece em Concluir (useEditor.save).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Confirm } from "@/components/Modal";
import { toast } from "@/components/toast";
import {
  MAX_SECTIONS,
  MAX_VIEWS,
  MAX_CARDS,
  addCard,
  addSection,
  addView,
  blankCard,
  canAddCard,
  countCards,
  findCard,
  isComplete,
  moveCardToView,
  moveSection,
  moveView,
  newId,
  removeCard,
  removeSection,
  removeView,
  renameSection,
  renameView,
  roomCards,
  totalCards,
  updateCard,
} from "@/lib/dashboard";
import type { DashCard, DashSection, DashView } from "@/lib/types";
import { useGroupDialog, openGroupDialog } from "@/screens/grupos/groupDialog";
import { AddCard } from "./AddCard";
import { Board } from "./Board";
import { ConfigCard } from "./ConfigCard";
import { EditBar, RemoteBanner } from "./EditBar";
import { cardLabel, EditCtx, useEnv, type Edit } from "./env";
import { useBoardDrag } from "./drag";
import type { Editor } from "./useEditor";
import { plural, useActiveView } from "./util";
import { cn } from "@/lib/utils";

type Confirming = { kind: "view"; view: DashView } | { kind: "section"; section: DashSection; viewId: string } | null;

export function PanelEdit({ editor, desktop, canReset }: { editor: Editor; desktop: boolean; canReset: boolean }) {
  const env = useEnv();
  const views = editor.views ?? [];
  const [activeId, setActive] = useActiveView(views.map((v) => v.id));
  const boardRef = useRef<HTMLDivElement>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirming>(null);
  const [hidden, setHidden] = useState(false);
  const [stuck, setStuck] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const envRef = useRef(env);
  envRef.current = env;
  const patch = editor.patch;

  const drag = useBoardDrag({
    boardRef,
    viewsRef: editor.draftRef,
    commit: patch,
    showView: setActive,
    label: (kind, id) => {
      const vs = editor.draftRef.current;
      if (kind === "card") {
        const c = findCard(vs, id);
        return c ? cardLabel(c, envRef.current) : "card";
      }
      const s = vs.flatMap((v) => v.sections).find((x) => x.id === id);
      return s?.title?.trim() ? `Seção ${s.title.trim()}` : "Seção sem título";
    },
  });

  const configCard = configId ? findCard(views, configId) : null;

  // ---- configurar --------------------------------------------------------------------------------------------------

  const closeConfig = () => {
    // Card novo que ficou sem escolha não vira card (cancela a adição).
    if (configCard && !isComplete(configCard)) patch((v) => removeCard(v, configCard.id));
    setCfgOpen(false);
  };

  // ---- "Novo grupo…": o dialog de grupo é outro modal; a folha sai de cena até ele fechar ---------------------------
  const groupReq = useGroupDialog();
  const waiting = useRef<{ known: Set<string>; until: number } | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (groupReq) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      if (hidden) setHidden(false);
      if (waiting.current) waiting.current.until = Date.now() + 4000;
    }
  }, [groupReq, hidden]);
  // O grupo criado chega pelo WebSocket: se apareceu um novo enquanto se esperava, já fica escolhido no card.
  useEffect(() => {
    const w = waiting.current;
    if (!w) return;
    if (Date.now() > w.until) {
      waiting.current = null;
      return;
    }
    const made = env.devices.find((d) => d.vendor === "grupo" && !w.known.has(d.id));
    if (made && configId) {
      waiting.current = null;
      patch((v) => updateCard(v, configId, { device_id: made.id }));
    }
  }, [env.devices, configId, patch]);

  const newGroup = () => {
    waiting.current = { known: new Set(env.devices.filter((d) => d.vendor === "grupo").map((d) => d.id)), until: Infinity };
    setHidden(true);
    openGroupDialog();
  };

  // ---- ações do rascunho -------------------------------------------------------------------------------------------

  const edit = useMemo<Edit>(
    () => ({
      views,
      dragging: drag.active,
      gripProps: drag.gripProps,
      selectedId: cfgOpen ? configId : null,
      configure: (id) => {
        setConfigId(id);
        setCfgOpen(true);
      },
      removeCard: (id) => {
        patch((v) => removeCard(v, id));
        if (id === configId) setCfgOpen(false);
      },
      addCard: (sectionId) => setAddTo(sectionId),
      renameSection: (id, title) => patch((v) => renameSection(v, id, title)),
      moveSection: (id, d) => patch((v) => moveSection(v, id, d)),
      removeSection: (section, viewId) => (section.cards.length ? setConfirm({ kind: "section", section, viewId }) : patch((v) => removeSection(v, section.id))),
      addSection: (viewId, index) => patch((v) => addSection(v, viewId, undefined, index)),
      canAddSection: (viewId) => (views.find((v) => v.id === viewId)?.sections.length ?? 0) < MAX_SECTIONS,
      canAddCard: (sectionId) => canAddCard(views, sectionId),
      renameView: (id, name) => patch((v) => renameView(v, id, name)),
      moveView: (id, d) => patch((v) => moveView(v, id, d)),
      removeView: (view) => setConfirm({ kind: "view", view }),
      addView: () => {
        if (views.length >= MAX_VIEWS) return null;
        const next = addView(views, "");
        const id = next[next.length - 1].id;
        patch(() => next);
        setActive(id);
        return id;
      },
      canAddView: views.length < MAX_VIEWS,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, drag.active, drag.gripProps, cfgOpen, configId, patch],
  );

  // ---- adicionar ---------------------------------------------------------------------------------------------------

  const rooms = useMemo(
    () =>
      [...new Set(env.devices.map((d) => d.room).filter((r): r is string => !!r))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((name) => ({ name, count: env.devices.filter((d) => d.room === name).length })),
    [env.devices],
  );

  function pickType(type: DashCard["type"]) {
    if (!addTo) return;
    const card: DashCard = { id: newId(), ...blankCard(type) } as DashCard;
    patch((v) => addCard(v, addTo, card));
    setAddTo(null);
    setConfigId(card.id);
    setCfgOpen(true);
  }

  function pickRoom(room: string) {
    if (!addTo) return;
    const section = views.flatMap((v) => v.sections).find((s) => s.id === addTo);
    const cards = roomCards(env.devices, room);
    const left = Math.max(0, Math.min(60 - (section?.cards.length ?? 0), MAX_CARDS - totalCards(views)));
    const take = cards.slice(0, left);
    patch((v) => take.reduce((acc, c) => addCard(acc, addTo, c), v));
    setAddTo(null);
    toast({
      tone: take.length < cards.length ? "error" : "ok",
      message: take.length < cards.length ? `Só coube ${plural(take.length, "card", "cards")} de ${room}` : `${plural(take.length, "card", "cards")} de ${room} adicionados`,
    });
  }

  // ---- apagar aba / seção com confirmação --------------------------------------------------------------------------

  function confirmed() {
    if (!confirm) return;
    if (confirm.kind === "view") {
      const i = views.findIndex((v) => v.id === confirm.view.id);
      const next = views[i + 1] ?? views[i - 1];
      patch((v) => removeView(v, confirm.view.id));
      if (next && activeId === confirm.view.id) setActive(next.id);
    } else {
      patch((v) => removeSection(v, confirm.section.id));
    }
    setConfirm(null);
  }

  const confirmText = (() => {
    if (!confirm) return { title: "", text: "" };
    if (confirm.kind === "view") {
      const n = countCards(confirm.view);
      return {
        title: n ? `Apagar a aba ${confirm.view.name} e ${n === 1 ? "o" : "os"} ${plural(n, "card", "cards")}?` : `Apagar a aba ${confirm.view.name}?`,
        text: "Isso só vale quando você tocar em Concluir.",
      };
    }
    const n = confirm.section.cards.length;
    const name = confirm.section.title?.trim();
    return {
      title: `Apagar a seção${name ? ` ${name}` : ""} e ${n === 1 ? "o" : "os"} ${plural(n, "card", "cards")}?`,
      text: "Isso só vale quando você tocar em Concluir.",
    };
  })();

  const kbd = drag.active?.mode === "keyboard";
  return (
    <EditCtx.Provider value={edit}>
      <EditBar editor={editor} desktop={desktop} canReset={canReset} onStuck={setStuck} />
      <div className="fv-pg">
      <div className={cn("fv-in fv-pg-in fv-enter fv-enter-2 ini ep-pg", !desktop && "ini-m")}>
        {!stuck && <RemoteBanner editor={editor} />}
        <p id="ep-ajuda" className="sr">
          Espaço pega o card, as setas movem entre posições e seções, Espaço solta, Esc cancela.
        </p>
        <Board ref={boardRef} views={views} activeId={activeId} onActive={setActive} columns={desktop ? 4 : 2} guide={drag.guide} />
        <p className="sr" role="status" aria-live="polite">
          {drag.message}
        </p>
      </div>
      </div>

      {drag.active &&
        drag.bubble &&
        createPortal(
          <div className="mk ep ep-live-w" aria-hidden>
            <div className="ep-live">
              <span>{drag.bubble}</span>
              <small>{kbd ? "Setas movem · Espaço solta · Esc cancela" : "Solte no destino · Esc cancela"}</small>
            </div>
          </div>,
          document.body,
        )}

      <AddCard open={addTo !== null} onClose={() => setAddTo(null)} desktop={desktop} rooms={rooms} onPickType={pickType} onPickRoom={pickRoom} />

      <ConfigCard
        card={configCard}
        open={cfgOpen && !hidden}
        desktop={desktop}
        views={views}
        activeViewId={activeId}
        onPatch={(p) => configId && patch((v) => updateCard(v, configId, p))}
        onRemove={() => {
          if (configId) patch((v) => removeCard(v, configId));
          setCfgOpen(false);
        }}
        onClose={closeConfig}
        onMoveToView={(viewId) => {
          if (!configId) return;
          patch((v) => moveCardToView(v, configId, viewId));
          setActive(viewId);
        }}
        onNewGroup={newGroup}
        onClosed={() => setConfigId(null)}
        finalFocus={() => (configId ? document.querySelector<HTMLElement>(`[data-gear="${CSS.escape(configId)}"]`) : null) ?? true}
      />

      <Confirm
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirmText.title}
        description={confirmText.text}
        confirmLabel="Apagar"
        onConfirm={confirmed}
        cancelRef={cancelRef}
      />
    </EditCtx.Provider>
  );
}
