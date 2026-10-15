// Perguntas do modo editar: Personalizar?, Descartar?, Voltar ao automático?, conflito (409).
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {  } from "lucide-react";
import { Loader } from "@/components/Logo";
import { useRef, type ReactNode, type RefObject } from "react";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import type { Ask, Editor } from "./useEditor";

function Box({
  open,
  onClose,
  title,
  text,
  column,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text?: string;
  column?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} alert className="mk ep" initialFocus={initialFocus}>
      <AlertDialog.Title render={<h3 />}>{title}</AlertDialog.Title>
      {text && <AlertDialog.Description render={<p />}>{text}</AlertDialog.Description>}
      <div className={cn("dlg-act", column && "ep-act-col")}>{children}</div>
    </Modal>
  );
}

export function EditDialogs({ editor }: { editor: Editor }) {
  const safe = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const ask: Ask = editor.ask;
  return (
    <>
      <Box
        open={ask === "personalizar"}
        onClose={() => editor.setAsk(null)}
        title="Personalizar o painel?"
        text="Vamos transformar o painel automático (um bloco por cômodo) em um painel seu. Dá para voltar ao automático depois."
        initialFocus={first}
      >
        <button type="button" ref={first} className="btn btn-sec" onClick={() => editor.setAsk(null)}>
          Cancelar
        </button>
        <button type="button" className="btn" onClick={() => editor.begin(true)}>
          Personalizar
        </button>
      </Box>

      <Box
        open={ask === "descartar"}
        onClose={editor.keepEditing}
        title="Descartar alterações?"
        text="Você mudou o painel e ainda não tocou em Concluir. Se cancelar agora, as mudanças se perdem."
        initialFocus={safe}
      >
        <button type="button" ref={safe} className="btn btn-sec" onClick={editor.keepEditing}>
          Continuar editando
        </button>
        <button type="button" className="btn btn-danger" onClick={editor.discard}>
          Descartar
        </button>
      </Box>

      <Box
        open={ask === "voltar"}
        onClose={() => editor.setAsk(null)}
        title="Voltar ao automático?"
        text="O painel automático volta a mostrar um bloco por cômodo. Suas abas e cards personalizados serão apagados."
        initialFocus={first}
      >
        <button type="button" ref={first} className="btn btn-sec" onClick={() => editor.setAsk(null)}>
          Cancelar
        </button>
        <button type="button" className="btn btn-danger" disabled={editor.resetting} aria-busy={editor.resetting || undefined} onClick={() => void editor.resetToAuto()}>
          {editor.resetting && <Loader className="i i-sm spin" aria-hidden />}
          Voltar ao automático
        </button>
      </Box>

      <Box open={ask === "conflito"} onClose={() => editor.setAsk(null)} title="Painel alterado em outro aparelho" column initialFocus={safe}>
        <button type="button" ref={safe} className="btn btn-sec" onClick={() => void editor.reload()}>
          Recarregar e perder minhas mudanças
        </button>
        <button type="button" className="btn btn-danger" disabled={editor.saving} aria-busy={editor.saving || undefined} onClick={() => void editor.overwrite()}>
          {editor.saving && <Loader className="i i-sm spin" aria-hidden />}
          Sobrescrever com as minhas
        </button>
      </Box>
    </>
  );
}
