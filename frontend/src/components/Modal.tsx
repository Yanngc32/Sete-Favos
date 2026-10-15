import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** Confirmação destrutiva: vira alertdialog (não fecha clicando fora). */
  alert?: boolean;
  /** Onde o foco começa (ex.: o botão Cancelar numa confirmação de perigo). */
  initialFocus?: RefObject<HTMLElement | null>;
}

/** Dialog do kit (.dlg sobre .scrim) com foco preso, Esc e retorno do foco (Base UI). */
export function Modal({ open, onOpenChange, children, className, alert, initialFocus }: ModalProps) {
  const Part = alert ? AlertDialog : Dialog;
  return (
    <Part.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {/* .mk no portal: o dialog sai fora da raiz do app e precisa da fonte e do reset do kit. */}
      <Part.Portal className="mk">
        <Part.Backdrop className="scrim" />
        <Part.Viewport className="overlay-c">
          <Part.Popup className={cn("dlg", className)} initialFocus={initialFocus}>
            {children}
          </Part.Popup>
        </Part.Viewport>
      </Part.Portal>
    </Part.Root>
  );
}

export const ModalTitle = Dialog.Title;
export const ModalDescription = Dialog.Description;
export const ModalClose = Dialog.Close;

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
}

/** Confirmação de perigo do kit: foco começa em Cancelar. */
export function Confirm({ open, onOpenChange, title, description, confirmLabel, onConfirm, busy, cancelRef }: ConfirmProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} alert initialFocus={cancelRef}>
      <AlertDialog.Title render={<h3 />}>{title}</AlertDialog.Title>
      <AlertDialog.Description render={<p />}>{description}</AlertDialog.Description>
      <div className="dlg-act">
        <AlertDialog.Close ref={cancelRef} className="btn btn-sec">
          Cancelar
        </AlertDialog.Close>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
