// Sheet: painel lateral de 420 px no PC e folha de baixo no celular (fecha arrastando para baixo).
// Base UI Drawer (foco preso, Esc, retorno do foco, gesto). O conteúdo e o rodapé são de quem usa.
import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import "./sheet.css";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean, reason?: string) => void;
  /** PC = lateral à direita; celular = folha de baixo. */
  desktop: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Classe extra na raiz do portal (escopo do CSS de quem usa). */
  rootClassName?: string;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null> | boolean;
  finalFocus?: RefObject<HTMLElement | null> | boolean | (() => HTMLElement | boolean | null);
  /** Chamado depois da animação de saída. */
  onClosed?: () => void;
}

export function Sheet({
  open,
  onOpenChange,
  desktop,
  title,
  children,
  footer,
  rootClassName,
  className,
  initialFocus,
  finalFocus,
  onClosed,
}: SheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next, details) => {
        // Toque no toast ("Tentar de novo") não é "clicar fora": a folha fica aberta.
        const target = details.event?.target;
        if (!next && details.reason === "outside-press" && target instanceof Element && target.closest(".toasts")) {
          details.cancel();
          return;
        }
        onOpenChange(next, details.reason);
      }}
      onOpenChangeComplete={(o) => {
        if (!o) onClosed?.();
      }}
      swipeDirection={desktop ? "right" : "down"}
    >
      <Drawer.Portal className={cn("mk", rootClassName)}>
        <Drawer.Backdrop className="scrim sht-scrim" />
        <Drawer.Viewport className="sht-vp">
          <Drawer.Popup
            className={cn("sht", desktop ? "sht-side" : "sht-bt", className)}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
          >
            {!desktop && <span className="sheet-grab" aria-hidden />}
            <div className="sht-hd">
              <Drawer.Title render={<h2 />}>{title}</Drawer.Title>
              <Drawer.Close className="ibtn" aria-label="Fechar">
                <X className="i" aria-hidden />
              </Drawer.Close>
            </div>
            <Drawer.Content className="sht-bd">{children}</Drawer.Content>
            {footer && <div className="sht-ft">{footer}</div>}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
