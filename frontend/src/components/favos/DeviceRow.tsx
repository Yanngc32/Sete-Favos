// Linha de aparelho Sete Favos: favo do ícone + nome/estado + (seta de abrir) + switch do kit.
// Ligado = tinta latão (accent-soft + borda accent-fill) e favo cheio. Corpo expandido opcional (controles).
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Collapse, ExpandButton, useDisclosure } from "./Expandable";
import { HexTile } from "./HexTile";

export interface DeviceSwitch {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Rótulo acessível, ex. "Ligar Luz da sala". */
  label: string;
  disabled?: boolean;
  /** Comando em andamento: bolinha no meio + aria-busy. */
  busy?: boolean;
}

export interface DeviceRowProps {
  icon: LucideIcon | ReactNode;
  title: ReactNode;
  /** Estado/cômodo ("Ligada · 70% · laranja"). Use <Swap> dentro pra trocar com crossfade. */
  meta?: ReactNode;
  /** Ligado: tinta latão + favo cheio. */
  on?: boolean;
  /** Sem resposta: opacidade de offline (mantenha o motivo em `meta`). */
  offline?: boolean;
  /** Link do corpo (abre o Detalhe). */
  to?: string;
  /** state do Link (ex.: { back: "/dispositivos" } pro Detalhe voltar pra cá). */
  toState?: unknown;
  /** Alternativa ao `to`: corpo vira botão. */
  onOpen?: () => void;
  switch?: DeviceSwitch;
  /** Algo à direita antes do switch (ex. seta de ir, chip). */
  trailing?: ReactNode;
  /** Controles que abrem embaixo (região Collapse). Sem children não há seta. */
  children?: ReactNode;
  /** Rótulo do botão de abrir, ex. "controles da TV da sala". */
  expandLabel?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function DeviceRow({
  icon,
  title,
  meta,
  on,
  offline,
  to,
  toState,
  onOpen,
  switch: sw,
  trailing,
  children,
  expandLabel,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: DeviceRowProps) {
  const d = useDisclosure({ open, defaultOpen, onOpenChange });
  const text = (
    <>
      <b>{title}</b>
      {meta !== undefined && <span>{meta}</span>}
    </>
  );
  return (
    <div
      className={cn("fv-dev", on && "on", offline && "is-off", children !== undefined && "has-x", className)}
      data-open={(children !== undefined && d.open) || undefined}
    >
      <div className="fv-dev-r">
        <HexTile icon={icon} variant={on ? "on" : "neutral"} size="sm" />
        {to ? (
          <Link className="fv-dev-tx" to={to} state={toState}>
            {text}
          </Link>
        ) : onOpen ? (
          <button type="button" className="fv-dev-tx" onClick={onOpen}>
            {text}
          </button>
        ) : (
          <div className="fv-dev-tx">{text}</div>
        )}
        {trailing}
        {children !== undefined && (
          <ExpandButton
            open={d.open}
            onClick={d.toggle}
            controls={d.regionId}
            label={expandLabel ?? (typeof title === "string" ? `controles de ${title}` : "controles")}
          />
        )}
        {sw && (
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={sw.checked}
            aria-label={sw.label}
            aria-busy={sw.busy || undefined}
            disabled={sw.disabled}
            onClick={() => sw.onChange(!sw.checked)}
          />
        )}
      </div>
      {children !== undefined && (
        <Collapse open={d.open} id={d.regionId} innerClassName="fv-dev-x">
          {children}
        </Collapse>
      )}
    </div>
  );
}
