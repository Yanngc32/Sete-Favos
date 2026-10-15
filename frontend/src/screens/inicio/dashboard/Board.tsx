// Quadro do painel: abas, seções e a grade de cards. Serve o modo normal e o modo editar (o contexto Edit liga os controles).
import { HexTile } from "@/components/favos";
import { ArrowDown, ArrowUp, Ellipsis, LayoutDashboard, Pencil, Plus, Trash2 } from "lucide-react";
import { forwardRef, useState, type CSSProperties } from "react";
import type { DashSection, DashView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionMenu } from "./ActionMenu";
import { Grip, Slot } from "./Cards";
import { useEdit } from "./env";
import type { Guide } from "./drag";
import { Tabs } from "./Tabs";

const PANEL_ID = "ep-painel";

function SectionTitle({ section }: { section: DashSection }) {
  const edit = useEdit()!;
  const [value, setValue] = useState(section.title ?? "");
  const [seen, setSeen] = useState(section.title);
  // Mudou por fora (menu, desfazer, outro aparelho): acompanha. Digitando, o valor só vai pro rascunho ao sair do campo.
  if (seen !== section.title) {
    setSeen(section.title);
    setValue(section.title ?? "");
  }
  const commit = () => edit.renameSection(section.id, value);
  return (
    <input
      className="ep-ti"
      id={`ep-ti-${section.id}`}
      value={value}
      maxLength={60}
      placeholder="Sem título"
      aria-label="Título da seção"
      autoComplete="off"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          setValue(section.title ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Section({ view, section, index, columns, last }: { view: DashView; section: DashSection; index: number; columns: 2 | 4; last: boolean }) {
  const edit = useEdit();
  const title = section.title?.trim() ?? "";
  const names = title || "sem título";
  const cards = section.cards.map((c) => <Slot key={c.id} card={c} columns={columns} />);

  if (!edit) {
    if (!section.cards.length) return null;
    return (
      <section className="ep-sec" data-sec-id={section.id} data-view-id={view.id} aria-label={title || undefined}>
        {title && <h2 className="ep-st">{title}</h2>}
        <div className={cn("ep-g", columns === 2 && "m")}>{cards}</div>
      </section>
    );
  }

  // "Adicionar card" baixinho (56) quando entra ao lado de rotinas/objetos (como no mock: resumo + rotinas + adicionar).
  const lastType = section.cards[section.cards.length - 1]?.type;
  const compactRow = lastType === "routine" || lastType === "virtual";
  const canAdd = edit.canAddCard(section.id);
  const addTile = (
    <button
      type="button"
      className={cn("ep-add", compactRow && "sm")}
      disabled={!canAdd}
      title={canAdd ? undefined : "Limite de cards atingido"}
      onClick={() => edit.addCard(section.id)}
    >
      <Plus className="i" aria-hidden />
      Adicionar card
    </button>
  );

  return (
    <>
      <section className="ep-sec" data-sec-id={section.id} data-view-id={view.id} aria-label={`Seção ${names}`}>
        <div className="ep-sh" data-sec-head>
          <Grip kind="section" id={section.id} label={names} />
          <SectionTitle section={section} />
          <ActionMenu
            label={`Opções da seção ${names}`}
            triggerClassName="ep-h"
            trigger={<Ellipsis className="i" aria-hidden />}
            items={[
              {
                label: "Renomear",
                Icon: Pencil,
                moveFocus: true,
                onSelect: () => requestAnimationFrame(() => document.getElementById(`ep-ti-${section.id}`)?.focus()),
              },
              { label: "Mover para cima", Icon: ArrowUp, disabled: index === 0, onSelect: () => edit.moveSection(section.id, -1) },
              { label: "Mover para baixo", Icon: ArrowDown, disabled: last, onSelect: () => edit.moveSection(section.id, 1) },
              { label: "Apagar", Icon: Trash2, danger: true, divider: true, onSelect: () => edit.removeSection(section, view.id) },
            ]}
          />
        </div>
        {section.cards.length ? (
          <div className={cn("ep-g", columns === 2 && "m")}>
            {cards}
            {addTile}
          </div>
        ) : (
          <div className="ep-es" data-zone>
            <p>Nenhum card aqui</p>
            <button type="button" className="btn btn-sec btn-sm btn-ico" disabled={!canAdd} onClick={() => edit.addCard(section.id)}>
              <Plus className="i i-sm" aria-hidden />
              Adicionar card
            </button>
          </div>
        )}
      </section>
      <div className="ep-nv">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-ico"
          disabled={!edit.canAddSection(view.id)}
          title={edit.canAddSection(view.id) ? undefined : "No máximo 20 seções por aba"}
          onClick={() => edit.addSection(view.id, index + 1)}
        >
          <Plus className="i i-sm" aria-hidden />
          Nova seção
        </button>
      </div>
    </>
  );
}

interface BoardProps {
  views: DashView[];
  activeId: string;
  onActive: (id: string) => void;
  columns: 2 | 4;
  /** Linha-guia do arraste (relativa ao quadro). */
  guide: Guide | null;
}

export const Board = forwardRef<HTMLDivElement, BoardProps>(function Board({ views, activeId, onActive, columns, guide }, ref) {
  const edit = useEdit();
  const view = views.find((v) => v.id === activeId) ?? views[0];
  const style: CSSProperties | undefined = guide ? { left: guide.x, top: guide.y, width: guide.w, height: guide.h } : undefined;
  return (
    <div className="ep ep-board" ref={ref}>
      <Tabs views={views} activeId={view.id} onActive={onActive} compact={columns === 2} panelId={PANEL_ID} />
      <div className="ep-panel" id={PANEL_ID} role={views.length > 1 || edit ? "tabpanel" : undefined} aria-labelledby={views.length > 1 || edit ? `ep-tab-${view.id}` : undefined}>
        {view.sections.length === 0 ? (
          <div className="empty ep-empty" data-zone>
            <HexTile icon={<LayoutDashboard className="i i-lg" aria-hidden />} variant="soft" size="xl" />
            <h3>Esta aba está vazia</h3>
            {edit ? (
              <button type="button" className="btn btn-sec btn-ico" disabled={!edit.canAddSection(view.id)} onClick={() => edit.addSection(view.id, 0)}>
                <Plus className="i" aria-hidden />
                Nova seção
              </button>
            ) : (
              <p>Toque em Editar painel para montar esta aba.</p>
            )}
          </div>
        ) : (
          view.sections.map((s, i) => <Section key={s.id} view={view} section={s} index={i} columns={columns} last={i === view.sections.length - 1} />)
        )}
      </div>
      {guide && <span className="ep-guide" data-kind={guide.kind} style={style} aria-hidden />}
    </div>
  );
});
