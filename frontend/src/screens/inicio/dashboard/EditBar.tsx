// Topo do modo editar: bloco mel "Editando o painel" com Cancelar / Concluir / ⋯ e, quando o bloco sai da tela,
// uma faixa compacta grudada no topo com as mesmas ações (Concluir sempre à mão durante o arraste).
// Também o aviso de "o painel mudou em outro aparelho" (vai junto da faixa quando ela está à vista).
import { Ellipsis, MonitorSmartphone, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Loader } from "@/components/Logo";
import { HoneyHeader } from "@/components/favos";
import { cn } from "@/lib/utils";
import { ActionMenu } from "./ActionMenu";
import type { Editor } from "./useEditor";

function Actions({ editor, canReset, sm }: { editor: Editor; canReset: boolean; sm: boolean }) {
  const s = sm ? " btn-sm" : "";
  return (
    <div className="ep-bar-a">
      {canReset && (
        <ActionMenu
          label="Mais opções do modo editar"
          triggerClassName="ibtn bd"
          trigger={<Ellipsis className="i" aria-hidden />}
          items={[{ label: "Voltar ao painel automático", Icon: RotateCcw, onSelect: () => editor.setAsk("voltar") }]}
        />
      )}
      <button type="button" className={`btn btn-ghost${s}`} disabled={editor.saving} onClick={editor.cancel}>
        Cancelar
      </button>
      <button type="button" className={`btn btn-ico${s}`} aria-busy={editor.saving || undefined} disabled={editor.saving} onClick={() => void editor.save()}>
        {editor.saving && <Loader className="i i-sm spin" aria-hidden />}
        Concluir
      </button>
    </div>
  );
}

export function RemoteBanner({ editor }: { editor: Editor }) {
  if (!editor.changedElsewhere) return null;
  return (
    <div className="banner ep-bn" role="status">
      <MonitorSmartphone className="i" aria-hidden />
      <p>O painel mudou em outro aparelho.</p>
      <div className="ep-bn-a">
        <button type="button" className="btn btn-sec btn-sm" onClick={() => void editor.seeNew()}>
          Ver o novo
        </button>
        <button type="button" className="btn btn-sec btn-sm" onClick={editor.ignoreRemote}>
          Continuar editando
        </button>
      </div>
    </div>
  );
}

/** Retorna se o bloco mel saiu da tela (a faixa compacta aparece). */
export function EditBar({ editor, desktop, canReset, onStuck }: { editor: Editor; desktop: boolean; canReset: boolean; onStuck?: (stuck: boolean) => void }) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      const s = !e.isIntersecting && e.boundingClientRect.top < 0;
      setStuck(s);
      onStuck?.(s);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onStuck]);

  return (
    <>
      <div className="ep ep-top">
        <div className={cn("ep-bar", !desktop && "m", stuck && "is-in")} role="region" aria-label="Edição do painel (atalho)" inert={!stuck} data-edit-top={stuck ? "" : undefined}>
          <span className="ep-bar-t">Editando o painel</span>
          <Actions editor={editor} canReset={canReset} sm />
        </div>
        {stuck && <RemoteBanner editor={editor} />}
      </div>
      <HoneyHeader
        variant="compacta"
        title="Editando o painel"
        subtitle={desktop ? "Arraste pela alça, toque na engrenagem para configurar. Nada muda antes de Concluir." : "Arraste pela alça · nada muda antes de Concluir"}
        actions={
          desktop ? (
            <Actions editor={editor} canReset={canReset} sm={false} />
          ) : canReset ? (
            <ActionMenu
              label="Mais opções do modo editar"
              triggerClassName="ibtn bd"
              trigger={<Ellipsis className="i" aria-hidden />}
              items={[{ label: "Voltar ao painel automático", Icon: RotateCcw, onSelect: () => editor.setAsk("voltar") }]}
            />
          ) : undefined
        }
        className="ep-fv"
      >
        {!desktop && <Actions editor={editor} canReset={false} sm={false} />}
      </HoneyHeader>
      <span ref={sentinel} className="ep-sentinel" aria-hidden />
    </>
  );
}
