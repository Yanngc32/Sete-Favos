// Pílulas de filtro/abas (sobre o bloco mel ou sobre a página), com contagem e indicador que desliza
// (só transform + largura medida). Estrutura inspirada em Tabs (Wensity, MIT) e Segmented toggle
// (Opensource UI, MIT) do banco de referências; reescrita sem dependência, com os tokens do DS.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Swap } from "./Swap";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface PillOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Contagem ao lado do rótulo (troca com crossfade). */
  count?: number;
  disabled?: boolean;
  /** Nome acessível quando o label não é texto puro. */
  ariaLabel?: string;
}

export interface FilterPillsProps<V extends string = string> {
  options: PillOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Nome do grupo pra leitor de tela, ex. "Filtrar por cômodo". */
  label: string;
  /** "radio" (padrão) = filtro, role radiogroup; "tabs" = abas, role tablist (use `panelId`). */
  mode?: "radio" | "tabs";
  /** Só em mode="tabs": id do painel que as abas controlam (`aria-controls`). */
  panelId?: string;
  /** "honey" (padrão) = sobre o bloco mel; "page" = sobre o fundo da página. */
  tone?: "honey" | "page";
  className?: string;
}

export function FilterPills<V extends string = string>({
  options,
  value,
  onChange,
  label,
  mode = "radio",
  panelId,
  tone = "honey",
  className,
}: FilterPillsProps<V>) {
  const track = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const active = Math.max(0, options.findIndex((o) => o.value === value));

  // Mede a pílula escolhida (e de novo quando o tamanho muda: fonte carregando, contagem trocando).
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelectorAll<HTMLElement>("[data-pill]")[active];
      if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll("[data-pill]").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [active, options.length]);

  // Só liga a transição depois da 1ª medida: o indicador não "voa" do zero ao abrir a tela.
  useLayoutEffect(() => {
    if (ind && !ready) {
      const r = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(r);
    }
  }, [ind, ready]);

  const select = (i: number, focus: boolean) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    const b = track.current?.querySelectorAll<HTMLElement>("[data-pill]")[i];
    if (focus) b?.focus();
    b?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced() ? "auto" : "smooth" });
  };

  const onKey = (e: KeyboardEvent) => {
    const n = options.length;
    const step = (from: number, dir: number) => {
      for (let k = 1; k <= n; k++) {
        const i = (from + dir * k + n) % n;
        if (!options[i].disabled) return i;
      }
      return from;
    };
    let i: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = step(active, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = step(active, -1);
    else if (e.key === "Home") i = step(-1, 1);
    else if (e.key === "End") i = step(n, -1);
    if (i !== null) {
      e.preventDefault();
      select(i, true);
    }
  };

  const tabs = mode === "tabs";
  return (
    <div className={cn("fv-pills", `fv-pills-${tone}`, className)}>
      <div
        ref={track}
        className="fv-pills-t"
        role={tabs ? "tablist" : "radiogroup"}
        aria-label={label}
        onKeyDown={onKey}
        data-ready={ready || undefined}
      >
        {ind && (
          <span
            className="fv-pills-ind"
            aria-hidden
            style={{ transform: `translateX(${ind.x}px)`, width: ind.w }}
          />
        )}
        {options.map((o, i) => {
          const on = i === active;
          return (
            <button
              key={o.value}
              type="button"
              data-pill
              className="fv-pill"
              role={tabs ? "tab" : "radio"}
              aria-selected={tabs ? on : undefined}
              aria-checked={tabs ? undefined : on}
              aria-controls={tabs ? panelId : undefined}
              aria-label={o.ariaLabel}
              tabIndex={on ? 0 : -1}
              disabled={o.disabled}
              onClick={() => select(i, false)}
            >
              <span>{o.label}</span>
              {o.count !== undefined && (
                <small>
                  <Swap value={o.count} />
                </small>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
