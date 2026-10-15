// Ajustes de uma ação de aparelho: um card por aparelho, com vários ajustes (liga, 23 °C, frio, ventilação baixa).
// Cada ajuste tem o controle do tipo dele; "+ ajuste" mostra o que o aparelho ainda aceita; atalhos por tipo.
import { Camera, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import {
  actionValues,
  initialValue,
  MAX_VALUES,
  orderedValues,
  presetsFor,
  REMOTE_KEY,
  sameValues,
  valuesFromState,
  writableCaps,
} from "@/lib/actions";
import { int } from "@/lib/format";
import type { Capability, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { partsText, valueParts } from "@/screens/automacoes/frase";
import { Seg, Slider, Step } from "@/screens/detalhe/controls";
import { matchSwatch, PALETTE, paletteHex, swatchVar } from "@/screens/detalhe/colors";
import { NumField } from "./fields";
import type { DAction } from "./model";
import { Picker } from "./Picker";

type DevAction = Extract<DAction, { type: "device" }>;

const NBSP = " ";

/** "liga, em 23 °C, modo Frio, ventilação baixa" (na ordem em que a central executa). */
export function valuesSummary(d: Device | undefined, values: Record<string, unknown>): string {
  if (!d) return "";
  return orderedValues(values, d)
    .map(([k, v]) => partsText(valueParts(d, k, v)))
    .filter(Boolean)
    .join(", ");
}

function capLabel(d: Device, c: Capability): string {
  if (c.id === "power") return d.kind === "light" ? "Acender / apagar" : "Liga / desliga";
  if (c.type === "action") return "Comando";
  return c.label;
}

function numText(c: Capability, v: number): string {
  const n = int.format(v);
  if (!c.unit) return c.id === "color_temp" ? (v <= 33 ? `${n} · quente` : v >= 67 ? `${n} · fria` : `${n} · neutra`) : n;
  return c.unit === "%" ? `${n}%` : `${n}${NBSP}${c.unit}`;
}

const clamp = (c: Capability, n: number) => Math.min(c.max ?? n, Math.max(c.min ?? n, n));

/** Controle certo para cada tipo de ajuste. */
function AdjControl({ d, c, value, onChange, labelId, error }: {
  d: Device; c: Capability; value: unknown; onChange: (v: unknown) => void; labelId: string; error?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  if (c.type === "action") return <span className="adj-cmd">{c.label}</span>;
  if (c.id === "power" && c.type === "bool")
    return (
      <Seg labelledBy={labelId} value={String(value)} onChange={(v) => onChange(v === "true")}
        options={[{ value: "true", label: d.kind === "light" ? "Acende" : "Liga" }, { value: "false", label: d.kind === "light" ? "Apaga" : "Desliga" }]} />
    );
  if (c.type === "bool") {
    const on = value === true;
    const text = c.id === "muted" ? (on ? "Sem som" : "Com som") : on ? "Liga" : "Desliga";
    return (
      <span className="adj-sw">
        <button type="button" className="sw" role="switch" aria-checked={on} aria-labelledby={labelId} onClick={() => onChange(!on)} />
        <span className="adj-swt" aria-hidden>{text}</span>
      </span>
    );
  }
  if (c.type === "enum") {
    const opts = (c.options ?? []).map((o) => ({ value: o.value, label: o.label }));
    if (opts.length <= 4 && c.id !== REMOTE_KEY && c.id !== "source")
      return <Seg labelledBy={labelId} value={value} options={opts} onChange={onChange} />;
    return <Picker label={c.label} labelledBy={labelId} options={opts} value={value == null ? "" : String(value)} onChange={onChange} error={error} />;
  }
  if (c.type === "int" || c.type === "float") {
    const n = typeof value === "number" ? value : (c.min ?? 0);
    const step = c.step || 1;
    if (c.id === "target_temp" || c.unit === "°C" || c.min == null || c.max == null) {
      if (c.min == null || c.max == null)
        return <NumField label={c.label} labelledBy={labelId} value={value} onChange={onChange} min={c.min} max={c.max} step={c.step}
          unit={c.unit} integer={c.type === "int"} error={error} />;
      return (
        <span className="adj-stp" role="group" aria-labelledby={labelId}>
          <Step label={`Menos ${c.label.toLowerCase()}`} disabled={n <= c.min} onClick={() => onChange(clamp(c, n - step))}>
            <Minus className="i i-sm" aria-hidden />
          </Step>
          <output className="adj-n num" aria-live="polite">{numText(c, n)}</output>
          <Step label={`Mais ${c.label.toLowerCase()}`} disabled={n >= c.max} onClick={() => onChange(clamp(c, n + step))}>
            <Plus className="i i-sm" aria-hidden />
          </Step>
        </span>
      );
    }
    return (
      <span className={cn("adj-sl", c.id === "color_temp" && "kel")}>
        <Slider value={n} min={c.min} max={c.max} step={step} label={c.label} fill={c.id !== "color_temp"}
          valueText={(v) => numText(c, v)} onCommit={onChange} onDraft={setDraft} />
        <span className="adj-n num" aria-hidden>{numText(c, draft ?? n)}</span>
      </span>
    );
  }
  if (c.type === "color") return <ColorPick value={value} onChange={onChange} labelId={labelId} />;
  return <span />;
}

/** Paleta (--color-luz-*) + cor livre. */
function ColorPick({ value, onChange, labelId }: { value: unknown; onChange: (v: unknown) => void; labelId: string }) {
  const sel = matchSwatch(value);
  const hex = typeof value === "string" ? value : "#ffffff";
  return (
    <span className="adj-pal" role="radiogroup" aria-labelledby={labelId}>
      {PALETTE.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={sel === p.id} aria-label={p.label} className="adj-sw-c"
          style={{ background: swatchVar(p.id) }} onClick={() => onChange(paletteHex().get(p.id) ?? hex)} />
      ))}
      <label className={cn("adj-sw-c adj-free", !sel && "is-on")} title="Outra cor">
        <input type="color" value={hex} aria-label="Outra cor" onChange={(e) => onChange(e.target.value.toLowerCase())} />
        <Plus className="i i-sm" aria-hidden />
      </label>
    </span>
  );
}

/** Lista de ajustes do card + "+ ajuste" + atalhos. */
export function DeviceAdjusts({ a, d, set, stacked, err }: {
  a: DevAction; d: Device; set: (a: DAction) => void; stacked?: boolean; err?: boolean;
}) {
  const [said, setSaid] = useState("");
  // Só o ajuste recém-adicionado entra com movimento (abrir o editor não anima a lista).
  const [fresh, setFresh] = useState<string | null>(null);
  const values = actionValues(a);
  const caps = writableCaps(d);
  const capOf = (k: string) => caps.find((c) => c.id === k);
  const keys = Object.keys(values);
  const setValues = (v: Record<string, unknown>) => {
    const { capability: _c, value: _v, ...rest } = a;
    set({ ...rest, values: v } as DAction);
  };
  const hasCommand = keys.some((k) => capOf(k)?.type === "action");
  const missing = caps.filter((c) => !(c.id in values));
  const full = keys.length >= MAX_VALUES;
  const idBase = `${stacked ? "m" : ""}adj-${a._k}`;
  const presets = presetsFor(d);
  const now = valuesFromState(d);

  const add = (c: Capability) => {
    setValues({ ...values, [c.id]: initialValue(c, d) });
    setFresh(c.id);
    setSaid(`${capLabel(d, c)} adicionado`);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-adj="${idBase}-${c.id}"] :is(button:not([disabled]), input, [role=slider], [tabindex="0"])`)?.focus(),
      ),
    );
  };
  const remove = (k: string) => {
    const next = { ...values };
    delete next[k];
    setValues(next);
    const c = capOf(k);
    setSaid(`${c ? capLabel(d, c) : k} removido`);
  };
  const apply = (v: Record<string, unknown>, label: string) => {
    setValues({ ...v });
    setSaid(`${label}: ${valuesSummary(d, v)}`);
  };

  return (
    <div className={cn("adj", stacked && "is-stk", err && "is-err")} role="group" aria-label={`Ajustes de ${d.name}`}>
      {keys.length > 0 && (
        <ul className="adj-l">
          {keys.map((k) => {
            const c = capOf(k);
            const labelId = `${idBase}-${k}-l`;
            if (!c) {
              const lost = d.capabilities.find((x) => x.id === k)?.label ?? (k === REMOTE_KEY ? "Tecla do controle" : k);
              return (
                <li key={k} className="adj-r is-lost" data-adj={`${idBase}-${k}`}>
                  <span className="adj-k" id={labelId}><s>{lost}</s></span>
                  <span className="adj-lost">{d.name} não tem mais</span>
                  <button type="button" className="ibtn" aria-label={`Remover ${lost}`} onClick={() => remove(k)}>
                    <X className="i i-sm" aria-hidden />
                  </button>
                </li>
              );
            }
            return (
              <li key={k} className={cn("adj-r", fresh === k && "is-new")} data-adj={`${idBase}-${k}`}>
                <span className="adj-k" id={labelId}>{capLabel(d, c)}</span>
                <span className="adj-c">
                  <AdjControl d={d} c={c} value={values[k]} labelId={labelId} error={err}
                    onChange={(v) => setValues({ ...values, [k]: v })} />
                </span>
                <button type="button" className="ibtn" aria-label={`Remover ${capLabel(d, c).toLowerCase()}`}
                  disabled={keys.length === 1} title={keys.length === 1 ? "A ação precisa de pelo menos um ajuste" : undefined}
                  onClick={() => remove(k)}>
                  <X className="i i-sm" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {missing.length > 0 && (
        <div className="adj-add" role="group" aria-label="Adicionar ajuste">
          <span className="adj-h" aria-hidden>Adicionar</span>
          {missing.map((c) => {
            const blocked = full || (c.type === "action" && hasCommand) || (c.id === REMOTE_KEY && values.power === false);
            return (
              <button key={c.id} type="button" className="adj-chip" disabled={blocked} onClick={() => add(c)}
                title={c.type === "action" && hasCommand ? "Um comando por ação" : undefined}
                aria-label={`Adicionar ${capLabel(d, c).toLowerCase()}`}>
                <Plus className="i i-sm" aria-hidden />
                {c.type === "action" ? c.label : capLabel(d, c)}
              </button>
            );
          })}
        </div>
      )}
      {(presets.length > 0 || Object.keys(now).length > 0) && (
        <div className="adj-add adj-pre" role="group" aria-label="Atalhos">
          <span className="adj-h" aria-hidden>Atalhos</span>
          {Object.keys(now).length > 0 && (
            <button type="button" className="adj-chip" aria-pressed={sameValues(values, now)}
              title={`Preenche com o estado de agora: ${valuesSummary(d, now)}`}
              onClick={() => apply(now, "Igual a agora")}>
              <Camera className="i i-sm" aria-hidden />
              Igual a agora
            </button>
          )}
          {presets.map((p) => (
            <button key={p.id} type="button" className="adj-chip" aria-pressed={sameValues(values, p.values)}
              title={valuesSummary(d, p.values)} onClick={() => apply(p.values, p.label)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="sr" role="status" aria-live="polite">{said}</p>
    </div>
  );
}
