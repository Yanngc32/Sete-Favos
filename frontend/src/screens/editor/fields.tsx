// Campos do editor: número com unidade, hora (inline-time-edit), horário, dias da semana (week-strip).
import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ALL_DAYS, hhmm, WEEKDAYS } from "@/screens/automacoes/frase";

export function NumField({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  label,
  labelledBy,
  error,
  describedBy,
  integer,
  focusKey,
}: {
  value: unknown;
  onChange: (v: number | undefined) => void;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  unit?: string | null;
  label: string;
  labelledBy?: string;
  error?: boolean;
  describedBy?: string;
  integer?: boolean;
  focusKey?: string;
}) {
  const asText = (v: unknown) => (typeof v === "number" ? String(v).replace(".", ",") : "");
  const [txt, setTxt] = useState(asText(value));
  useEffect(() => {
    const n = Number(txt.replace(",", "."));
    if (txt.trim() === "" ? value !== undefined : n !== value) setTxt(asText(value));
  }, [value]);

  const parse = (s: string) => {
    if (s.trim() === "") return undefined;
    const n = Number(s.replace(",", "."));
    if (Number.isNaN(n)) return undefined;
    return integer ? Math.round(n) : n;
  };
  const bump = (dir: 1 | -1) => {
    const cur = typeof value === "number" ? value : (min ?? 0);
    let n = cur + dir * (step || 1);
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onChange(n);
    setTxt(asText(n));
  };
  return (
    <label className={cn("pick nf", error && "is-err")}>
      <input
        inputMode={integer ? "numeric" : "decimal"}
        value={txt}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-invalid={error || undefined}
        aria-describedby={describedBy}
        data-fk={focusKey}
        onChange={(e) => {
          const s = e.target.value.replace(/[^\d,.-]/g, "");
          setTxt(s);
          onChange(parse(s));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            bump(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
      />
      {unit && <span className="u">{unit}</span>}
    </label>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Hora do gatilho: pílula fechada "22:30" + lápis; editando, campos de h e min + ✓. */
export function TimeEdit({ at, onChange, labelId }: { at: string; onChange: (at: string) => void; labelId: string }) {
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const hRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [hh, mm] = at.split(":");

  const start = () => {
    setH(String(Number(hh)));
    setM(mm);
    setEditing(true);
    requestAnimationFrame(() => {
      hRef.current?.focus();
      hRef.current?.select();
    });
  };
  const close = (save: boolean) => {
    if (save) {
      const hn = Math.min(23, Math.max(0, Number(h) || 0));
      const mn = Math.min(59, Math.max(0, Number(m) || 0));
      onChange(`${pad(hn)}:${pad(mn)}`);
    }
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    }
  };

  if (!editing)
    return (
      <div className="tme" role="group" aria-labelledby={labelId}>
        <span className="tme-v">{hhmm(at)}</span>
        <button type="button" className="tme-b" ref={editRef} aria-label={`Editar hora, ${Number(hh)} e ${mm}`} onClick={start}>
          <Pencil className="i i-sm" aria-hidden />
        </button>
      </div>
    );
  return (
    <div
      className="tme-o"
      role="group"
      aria-labelledby={labelId}
      ref={groupRef}
      onBlur={(e) => {
        if (!groupRef.current?.contains(e.relatedTarget as Node)) close(true);
      }}
    >
      <label className="tp">
        <input ref={hRef} value={h} inputMode="numeric" maxLength={2} aria-label="Horas" onKeyDown={onKey}
          onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} onFocus={(e) => e.target.select()} />
        <span>h</span>
      </label>
      <label className="tp">
        <input value={m} inputMode="numeric" maxLength={2} aria-label="Minutos" onKeyDown={onKey}
          onChange={(e) => setM(e.target.value.replace(/\D/g, ""))} onFocus={(e) => e.target.select()} />
        <span>min</span>
      </label>
      <button type="button" className="tp-ok" aria-label="Salvar hora" onClick={() => close(true)}>
        <Check className="i" aria-hidden />
      </button>
    </div>
  );
}

/** Horário nativo (teclado e roda do celular), com a cara do .pick. */
export function TimeInput({ value, onChange, label, error }: { value: string; onChange: (v: string) => void; label: string; error?: boolean }) {
  return (
    <label className={cn("pick tm", error && "is-err")}>
      <input type="time" value={value} aria-label={label} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

// Domingo primeiro, como no calendário; o modelo usa 0 = segunda … 6 = domingo.
const ORDER = [6, 0, 1, 2, 3, 4, 5];
const LETTER: Record<number, string> = { 6: "D", 0: "S", 1: "T", 2: "Q", 3: "Q", 4: "S", 5: "S" };
const NAME: Record<number, string> = { 6: "Domingo", 0: "Segunda", 1: "Terça", 2: "Quarta", 3: "Quinta", 4: "Sexta", 5: "Sábado" };

const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((x, i) => x === b[i]);

export function Days({ days, onChange, labelledBy, label, small }: { days: number[]; onChange: (d: number[]) => void; labelledBy?: string; label?: string; small?: boolean }) {
  return (
    <div className={cn("days", small && "sm")} role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      {ORDER.map((d) => (
        <button
          key={d}
          type="button"
          className="day"
          aria-pressed={days.includes(d)}
          aria-label={NAME[d]}
          onClick={() => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
        >
          {LETTER[d]}
        </button>
      ))}
    </div>
  );
}

export function DayShortcuts({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="qk-l" role="group" aria-label="Atalhos de dias">
      <button type="button" className="qk" aria-pressed={same(days, ALL_DAYS)} onClick={() => onChange([...ALL_DAYS])}>
        Todo dia
      </button>
      <button type="button" className="qk" aria-pressed={same(days, WEEKDAYS)} onClick={() => onChange([...WEEKDAYS])}>
        Dias úteis
      </button>
    </div>
  );
}
