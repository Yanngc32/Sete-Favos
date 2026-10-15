// Controles do Detalhe montados sobre as classes do kit (.seg, .sl*, .ring) e do mock (.stp, .opts).
import { Check, type LucideIcon } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ---------- segmentado (role=radiogroup, setas movem e escolhem) ---------- */

export interface SegOption {
  value: string;
  label: string;
  Icon?: LucideIcon;
}

interface SegProps {
  options: SegOption[];
  value: unknown;
  onChange: (value: string) => void;
  labelledBy: string;
  disabled?: boolean;
  /** "seg-st": item com ícone em cima do texto */
  className?: string;
}

function roving(e: KeyboardEvent<HTMLElement>, count: number, index: number): number | null {
  const prev = ["ArrowLeft", "ArrowUp"].includes(e.key);
  const next = ["ArrowRight", "ArrowDown"].includes(e.key);
  if (prev) return (index - 1 + count) % count;
  if (next) return (index + 1) % count;
  if (e.key === "Home") return 0;
  if (e.key === "End") return count - 1;
  return null;
}

export function Seg({ options, value, onChange, labelledBy, disabled, className }: SegProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const focusable = current === -1 ? 0 : current;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = roving(e, options.length, i);
    if (to == null) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(options[to].value);
  };

  return (
    <div className={cn("seg seg-full", className)} role="radiogroup" aria-labelledby={labelledBy} aria-disabled={disabled || undefined}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === current}
          tabIndex={i === focusable ? 0 : -1}
          disabled={disabled}
          onClick={() => i !== current && onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.Icon && <o.Icon className="i" aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- lista de opções (entradas da TV) · radiogroup com setas ---------- */

export function Opts({ options, value, onChange, labelledBy, disabled }: SegProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const focusable = current === -1 ? 0 : current;
  return (
    <div className="opts" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className="opt"
          role="radio"
          aria-checked={i === current}
          tabIndex={i === focusable ? 0 : -1}
          disabled={disabled}
          onClick={() => i !== current && onChange(o.value)}
          onKeyDown={(e) => {
            const to = roving(e, options.length, i);
            if (to == null) return;
            e.preventDefault();
            refs.current[to]?.focus();
            onChange(options[to].value);
          }}
        >
          {o.Icon && <o.Icon className="i" aria-hidden />}
          {o.label}
          <Check className="i i-sm ck" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/* ---------- slider (primitives/slider) · manda 1 comando ao soltar ---------- */

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  valueText: (v: number) => string;
  onCommit: (v: number) => void;
  /** Balão com o valor (brilho). */
  bubble?: (v: number) => string;
  /** Trilho com preenchimento latão (o de temperatura de cor é um gradiente). */
  fill?: boolean;
  className?: string;
  disabled?: boolean;
  describedBy?: string;
  /** Marcas sobre o trilho, em % (ex.: [0, 25, 50, 75, 100] no slider do bloco mel). */
  marks?: number[];
  /** Valor durante o arrasto/teclado (null quando solta), pra quem mostra o número fora do slider. */
  onDraft?: (v: number | null) => void;
}

export function Slider({ value, min, max, step = 1, label, valueText, onCommit, bubble, fill = true, className, disabled, describedBy, marks, onDraft }: SliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min);
  const set = (v: number | null) => {
    draftRef.current = v;
    setDraft(v);
    onDraft?.(v);
  };
  const commit = () => {
    const v = draftRef.current;
    set(null);
    if (v != null && v !== value) onCommit(v);
  };

  const shown = clamp(draft ?? value);
  const pct = ((shown - min) / (max - min)) * 100;

  const fromPointer = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return shown;
    return snap(min + ((clientX - r.left) / r.width) * (max - min));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    set(fromPointer(e.clientX));
    thumbRef.current?.focus({ preventScroll: true });
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draftRef.current == null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    set(fromPointer(e.clientX));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = Math.max(step, (max - min) / 10);
    const base = draftRef.current ?? value;
    const map: Record<string, number> = {
      ArrowRight: base + step,
      ArrowUp: base + step,
      ArrowLeft: base - step,
      ArrowDown: base - step,
      PageUp: base + big,
      PageDown: base - big,
      Home: min,
      End: max,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    set(snap(map[e.key]));
  };

  return (
    <div
      className={cn("sl", className, draft != null && "is-drag")}
      data-base-ui-swipe-ignore=""
      data-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={commit}
      onPointerCancel={commit}
    >
      <div className="sl-tr" ref={trackRef}>
        {fill && <div className="sl-fill" style={{ width: `${pct}%` }} />}
        {marks?.map((m) => (
          <span key={m} className={cn("sl-mk", m <= pct && "is-in")} style={{ left: `${m}%` }} aria-hidden />
        ))}
        <div
          ref={thumbRef}
          className="sl-th"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={shown}
          aria-valuetext={valueText(shown)}
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy}
          style={{ left: `${pct}%` }}
          onKeyDown={onKeyDown}
          onKeyUp={commit}
          onBlur={() => draftRef.current != null && commit()}
        >
          {bubble && (
            <span className="sl-bub" aria-hidden>
              {bubble(shown)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- botão −/+ redondo ---------- */

export function Step({ label, onClick, disabled, children, pressed }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className="stp" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- anel (battery-face-widget, sem rosto) · arco de 270° ---------- */

const ARC = 235.6;
const CIRC = 314.2;

export function Ring({ pct, size, children, label }: { pct: number; size?: number; children: ReactNode; label: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="ring" role="img" aria-label={label} style={size ? ({ "--ring-size": `${size}px` } as CSSProperties) : undefined}>
      <svg viewBox="0 0 120 120" fill="none" strokeWidth={6} strokeLinecap="round" aria-hidden>
        <circle className="trk" cx="60" cy="60" r="50" strokeDasharray={`${ARC} ${CIRC}`} transform="rotate(135 60 60)" />
        <circle className="prg" cx="60" cy="60" r="50" strokeDasharray={`${(ARC * p) / 100} ${CIRC}`} transform="rotate(135 60 60)" />
      </svg>
      <b className="num">{children}</b>
    </div>
  );
}
