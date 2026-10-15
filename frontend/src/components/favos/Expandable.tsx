// Abrir/recolher: região que anima a altura com grid-template-rows 0fr → 1fr + fade, e o botão de seta
// com aria-expanded/aria-controls. Estrutura inspirada no Collapsible do Wensity (MIT,
// components/primitives/collapsible), reescrita sem dependência, com os tokens do DS.
import { ChevronDown } from "lucide-react";
import { useCallback, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Estado de abrir/recolher, controlado (`open` + `onOpenChange`) ou não (`defaultOpen`). */
export function useDisclosure(opts: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const { open: controlled, defaultOpen = false, onOpenChange } = opts;
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const id = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { open, setOpen, toggle, regionId: `${id}-region` };
}

export interface CollapseProps {
  open: boolean;
  id?: string;
  children: ReactNode;
  className?: string;
  /** Classe do miolo (onde vai o padding: padding na casca quebraria a altura 0). */
  innerClassName?: string;
}

/** Região que abre e fecha. Fechada fica `inert` (fora do Tab e do leitor de tela). */
export function Collapse({ open, id, children, className, innerClassName }: CollapseProps) {
  return (
    <div id={id} className={cn("fv-col", className)} data-open={open || undefined} inert={!open}>
      <div className="fv-col-in">
        <div className={innerClassName}>{children}</div>
      </div>
    </div>
  );
}

export interface ExpandButtonProps {
  open: boolean;
  onClick: () => void;
  /** id da região (Collapse) que este botão controla. */
  controls: string;
  /** Nome do que abre, ex. "controles da Luz da sala" → "Mostrar controles da Luz da sala". */
  label: string;
  className?: string;
}

/** Botão de ícone com a seta que gira 180° (só transform). */
export function ExpandButton({ open, onClick, controls, label, className }: ExpandButtonProps) {
  return (
    <button
      type="button"
      className={cn("ibtn fv-xb", className)}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Esconder" : "Mostrar"} ${label}`}
      onClick={onClick}
    >
      <ChevronDown className="i i-sm" aria-hidden />
    </button>
  );
}

export interface ExpandableProps {
  /** Linha sempre visível (o botão de seta vai à direita dela). */
  summary: ReactNode;
  /** Rótulo acessível do botão, ex. "controles da TV da sala". */
  label: string;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
}

/** Atalho: linha-resumo + seta + região. Para layouts próprios use useDisclosure + ExpandButton + Collapse. */
export function Expandable({ summary, label, children, open, defaultOpen, onOpenChange, className, bodyClassName }: ExpandableProps) {
  const d = useDisclosure({ open, defaultOpen, onOpenChange });
  return (
    <div className={cn("fv-exp", className)} data-open={d.open || undefined}>
      <div className="fv-exp-h">
        <div className="fv-exp-s">{summary}</div>
        <ExpandButton open={d.open} onClick={d.toggle} controls={d.regionId} label={label} />
      </div>
      <Collapse open={d.open} id={d.regionId} innerClassName={cn("fv-exp-b", bodyClassName)}>
        {children}
      </Collapse>
    </div>
  );
}
