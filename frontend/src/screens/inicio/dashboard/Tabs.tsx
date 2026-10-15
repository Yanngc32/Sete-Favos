// Abas do painel (views). Modo normal: chips; modo editar: renomear inline (toque no nome da aba ativa), ⋯ e "+ Nova aba".
import { ArrowLeft, ArrowRight, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DashView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionMenu } from "./ActionMenu";
import { useEdit } from "./env";

interface Props {
  views: DashView[];
  activeId: string;
  onActive: (id: string) => void;
  compact: boolean;
  /** id do painel de abas (aria-controls). */
  panelId: string;
}

function RenameInput({ view, onDone }: { view: DashView; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(view.name);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(save ? value : null);
  };
  return (
    <div className="ep-tab on ren" data-tab-id={view.id}>
      <input
        ref={ref}
        value={value}
        maxLength={40}
        aria-label="Nome da aba"
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
      />
    </div>
  );
}

export function Tabs({ views, activeId, onActive, compact, panelId }: Props) {
  const edit = useEdit();
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // A aba ativa sempre aparece inteira (as abas rolam na horizontal no celular).
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const i = tabs.findIndex((t) => t === document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    onActive(views[next].id);
  }

  if (views.length < 2 && !edit) return null;
  return (
    <div className={cn("ep-tabs", compact && "m")} role="tablist" aria-label="Abas do painel" ref={list} onKeyDown={onKeyDown}>
      {views.map((v, i) => {
        const on = v.id === activeId;
        if (edit && renaming === v.id) {
          return (
            <RenameInput
              key={v.id}
              view={v}
              onDone={(name) => {
                setRenaming(null);
                if (name !== null) edit.renameView(v.id, name);
                requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(v.id)}"] [role="tab"]`)?.focus());
              }}
            />
          );
        }
        return (
          <div key={v.id} className={cn("ep-tab", on && "on")} data-tab-id={v.id}>
            <button
              type="button"
              role="tab"
              id={`ep-tab-${v.id}`}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onClick={() => (edit && on ? setRenaming(v.id) : onActive(v.id))}
              title={edit && on ? "Tocar no nome para renomear" : undefined}
            >
              {v.name}
            </button>
            {edit && on && (
              <ActionMenu
                label={`Opções da aba ${v.name}`}
                triggerClassName="ep-tm"
                trigger={<Ellipsis className="i" aria-hidden />}
                align="start"
                items={[
                  { label: "Renomear", Icon: Pencil, moveFocus: true, onSelect: () => setRenaming(v.id) },
                  { label: "Mover para a esquerda", Icon: ArrowLeft, disabled: i === 0, onSelect: () => edit.moveView(v.id, -1) },
                  { label: "Mover para a direita", Icon: ArrowRight, disabled: i === views.length - 1, onSelect: () => edit.moveView(v.id, 1) },
                  { label: "Apagar", Icon: Trash2, danger: true, divider: true, disabled: views.length < 2, onSelect: () => edit.removeView(v) },
                ]}
              />
            )}
          </div>
        );
      })}
      {edit && (
        <div className="ep-tab add">
          <button
            type="button"
            disabled={!edit.canAddView}
            title={edit.canAddView ? undefined : "No máximo 10 abas"}
            onClick={() => {
              const id = edit.addView();
              if (id) setRenaming(id);
            }}
          >
            <Plus className="i i-sm" aria-hidden />
            Nova aba
          </button>
        </div>
      )}
    </div>
  );
}
