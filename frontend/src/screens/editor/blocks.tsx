// Blocos da frase: Quando (gatilho) · Se (condições) · Então (ações).
import { Menu } from "@base-ui/react/menu";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CirclePlay,
  Clock,
  GripVertical,
  House,
  ListFilter,
  Hourglass,
  PlugZap,
  Play,
  Plus,
  Sunrise,
  Sunset,
  ToggleRight,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { cap, kindIcon } from "@/lib/devices";
import type { Action, Condition, Device, Trigger } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HexTile } from "@/components/favos";
import { ALL_DAYS, daysPhrase, hhmm, sunOffsetText, WEEKDAYS } from "@/screens/automacoes/frase";
import { routineIcon, virtualIcon } from "@/screens/automacoes/icons";
import { useIsMobile } from "@/screens/automacoes/media";
import { Days, DayShortcuts, NumField, TimeEdit, TimeInput } from "./fields";
import {
  boolOptions,
  conditionCaps,
  conditionStateOptions,
  decodeState,
  defaultValue,
  deviceOptions,
  encodeState,
  enumOptions,
  key,
  missingOption,
  stateCaps,
  virtualOptions,
  type DAction,
  type DCondition,
  type Draft,
  type Lookup,
} from "./model";
import { Picker, Sheet, type PickOpt } from "./Picker";
import { DeviceAdjusts, valuesSummary } from "./adjust";
import { actionValues, firstValues, writableCaps } from "@/lib/actions";

export type Upd = (fn: (d: Draft) => Draft) => void;

const fem = (d?: Device) => !!d && (d.kind === "light" || d.kind === "plug" || d.kind === "tv");

function Err({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="hint err" id={id}>
      <CircleAlert className="i i-sm" aria-hidden />
      {children}
    </p>
  );
}

function focusLater(sel: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus()));
}

/** Editor de valor de uma capacidade: liga/desliga, opções, número com unidade, cor, texto. */
function ValueField({
  device,
  capId,
  value,
  onChange,
  label,
  labelledBy,
  error,
  describedBy,
  forState,
}: {
  device: Device;
  capId: string;
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
  labelledBy?: string;
  error?: boolean;
  describedBy?: string;
  forState?: boolean;
}) {
  const c = cap(device, capId);
  if (!c || c.type === "action") return <span />;
  if (c.type === "bool") {
    const opts = forState ? boolOptions(capId === "power" && fem(device)) : [
      { value: "true", label: "Ligado" },
      { value: "false", label: "Desligado" },
    ];
    return (
      <Picker label={label} labelledBy={labelledBy} options={opts} value={typeof value === "boolean" ? String(value) : ""}
        onChange={(v) => onChange(v === "true")} error={error} describedBy={describedBy} />
    );
  }
  if (c.type === "enum")
    return (
      <Picker label={label} labelledBy={labelledBy} options={enumOptions(c)} value={value == null ? "" : String(value)}
        onChange={onChange} error={error} describedBy={describedBy} />
    );
  if (c.type === "int" || c.type === "float")
    return (
      <NumField label={label} labelledBy={labelledBy} value={value} onChange={onChange} min={c.min} max={c.max} step={c.step}
        unit={c.unit} integer={c.type === "int"} error={error} describedBy={describedBy} />
    );
  if (c.type === "color")
    return (
      <label className={cn("pick clr", error && "is-err")}>
        <input type="color" value={typeof value === "string" ? value : "#ffffff"} aria-label={label} onChange={(e) => onChange(e.target.value)} />
        <span className="v num">{typeof value === "string" ? value : ""}</span>
      </label>
    );
  return (
    <label className={cn("pick nf", error && "is-err")}>
      <input value={typeof value === "string" ? value : ""} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// QUANDO ------------------------------------------------------------------------------

const TRIGGER_TYPES: { type: Trigger["type"]; label: string; short: string; rest: string; Icon: LucideIcon }[] = [
  { type: "time", label: "Horário", short: "Horário", rest: "", Icon: Clock },
  { type: "device", label: "Aparelho muda", short: "Aparelho", rest: " muda", Icon: PlugZap },
  { type: "virtual", label: "Objeto virtual muda", short: "Objeto", rest: " virtual muda", Icon: ToggleRight },
  { type: "sun", label: "Nascer/pôr do sol", short: "Sol", rest: "", Icon: Sunset },
];

const SUN_EVENTS = [
  { value: "sunset", label: "Pôr do sol" },
  { value: "sunrise", label: "Nascer do sol" },
];

const SUN_OFFSETS = [-120, -60, -45, -30, -15, 0, 15, 30, 45, 60, 120].map((m) => ({ value: String(m), label: sunOffsetText(m) }));

function defaultTrigger(type: Trigger["type"]): Trigger {
  if (type === "time") return { type: "time", at: "07:00", days: [...ALL_DAYS] };
  if (type === "device") return { type: "device", device_id: "", capability: "", to: undefined };
  if (type === "sun") return { type: "sun", event: "sunset", offset: 0, days: [...ALL_DAYS] };
  return { type: "virtual", virtual_id: "", to: true };
}

/** Favo do bloco Quando: o desenho diz o tipo de gatilho. */
function triggerIcon(t: Trigger | null, look: Lookup): LucideIcon {
  if (!t || t.type === "time") return Clock;
  if (t.type === "sun") return t.event === "sunrise" ? Sunrise : Sunset;
  if (t.type === "virtual") return ToggleRight;
  const d = look.devices.find((x) => x.id === t.device_id);
  return d ? (d.kind === "phone" ? House : kindIcon(d.kind)) : Zap;
}

export function QuandoBlock({ d, upd, look, err }: { d: Draft; upd: Upd; look: Lookup; err?: string }) {
  const mobile = useIsMobile();
  const t = d.trigger;
  const mem = useRef<Partial<Record<Trigger["type"], Trigger>>>({});
  const setT = (nt: Trigger) => upd((x) => ({ ...x, trigger: nt }));
  const switchType = (type: Trigger["type"]) => {
    if (t?.type === type) return;
    if (t) mem.current[t.type] = t;
    setT(mem.current[type] ?? defaultTrigger(type));
  };
  const errId = "q-err";

  return (
    <section className={cn("blk card", err && "is-err")} aria-labelledby="q-t">
      <div className="blk-h">
        <HexTile icon={triggerIcon(t, look)} variant={t ? "soft" : "neutral"} size="sm" />
        <h2 id="q-t">Quando</h2>
        {t && <span>1 gatilho</span>}
      </div>
      {!t ? (
        <button type="button" className={cn("add-d", err && "is-err")} aria-describedby={err ? errId : undefined}
          onClick={() => setT(defaultTrigger("time"))}>
          <Plus className="i" aria-hidden />
          Adicionar gatilho
        </button>
      ) : (
        <>
          <div
            className={cn("seg", mobile && "seg-full")}
            role="radiogroup"
            aria-label="Tipo de gatilho"
            onKeyDown={(e) => {
              const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!dir) return;
              e.preventDefault();
              const i = TRIGGER_TYPES.findIndex((x) => x.type === t.type);
              const next = TRIGGER_TYPES[(i + dir + TRIGGER_TYPES.length) % TRIGGER_TYPES.length];
              switchType(next.type);
              focusLater(`[data-trig="${next.type}"]`);
            }}
          >
            {TRIGGER_TYPES.map((x) => (
              <button key={x.type} type="button" role="radio" aria-checked={t.type === x.type} tabIndex={t.type === x.type ? 0 : -1}
                data-trig={x.type} onClick={() => switchType(x.type)}>
                {!mobile && <x.Icon className="i i-sm" aria-hidden />}
                {mobile ? (
                  <>
                    {x.short}
                    {x.rest && <span className="sr">{x.rest}</span>}
                  </>
                ) : (
                  x.label
                )}
              </button>
            ))}
          </div>
          {t.type === "time" && (
            <div className="trig">
              <div className="f">
                <span className="cap" id="h-l">Hora</span>
                <TimeEdit at={t.at} labelId="h-l" onChange={(at) => setT({ ...t, at })} />
              </div>
              <div className="f">
                <span className="cap" id="d-l">Dias da semana</span>
                <Days days={t.days} labelledBy="d-l" onChange={(days) => setT({ ...t, days })} />
                <DayShortcuts days={t.days} onChange={(days) => setT({ ...t, days })} />
              </div>
            </div>
          )}
          {t.type === "device" && <DeviceTrigger t={t} setT={setT} look={look} err={!!err} errId={errId} />}
          {t.type === "sun" && (
            <div className="trig">
              <div className="r3">
                <div className="f">
                  <span className="cap" id="s-e">Quando</span>
                  <Picker label="Quando" labelledBy="s-e" Icon={Sunset} options={SUN_EVENTS} value={t.event}
                    onChange={(v) => setT({ ...t, event: v as "sunrise" | "sunset" })} />
                </div>
                <div className="f">
                  <span className="cap" id="s-o">Folga</span>
                  <Picker label="Folga" labelledBy="s-o"
                    options={SUN_OFFSETS.some((o) => o.value === String(t.offset)) ? SUN_OFFSETS : [...SUN_OFFSETS, { value: String(t.offset), label: sunOffsetText(t.offset) }]}
                    value={String(t.offset)} onChange={(v) => setT({ ...t, offset: Number(v) })} />
                </div>
              </div>
              <div className="f">
                <span className="cap" id="s-d">Dias da semana</span>
                <Days days={t.days} labelledBy="s-d" onChange={(days) => setT({ ...t, days })} />
                <DayShortcuts days={t.days} onChange={(days) => setT({ ...t, days })} />
              </div>
            </div>
          )}
          {t.type === "virtual" && (
            <div className="r3">
              <div className="f">
                <span className="cap" id="tv-a">Objeto virtual</span>
                <Picker label="Objeto virtual" labelledBy="tv-a" Icon={ToggleRight}
                  options={withMissing(virtualOptions(look.virtuals).map((o) => ({ ...o, group: undefined })), t.virtual_id ? `v:${t.virtual_id}` : "", look)}
                  value={t.virtual_id ? `v:${t.virtual_id}` : ""} error={!!err && !look.virtuals.some((v) => v.id === t.virtual_id)}
                  describedBy={err ? errId : undefined} onChange={(v) => setT({ ...t, virtual_id: v.slice(2) })} />
              </div>
              <span className="vira">vira</span>
              <div className="f">
                <span className="cap" id="tv-b">Para</span>
                <Picker label="Para" labelledBy="tv-b" options={boolOptions()} value={String(t.to)} onChange={(v) => setT({ ...t, to: v === "true" })} />
              </div>
            </div>
          )}
        </>
      )}
      {err && <Err id={errId}>{err}</Err>}
    </section>
  );
}

function withMissing(opts: PickOpt[], value: string, look: Lookup): PickOpt[] {
  if (!value || opts.some((o) => o.value === value)) return opts;
  const name = value.startsWith("d:") ? "Aparelho" : value.startsWith("v:") ? "Objeto" : "Item";
  void look;
  return [missingOption(value, name), ...opts];
}

function DeviceTrigger({ t, setT, look, err, errId }: {
  t: Extract<Trigger, { type: "device" }>; setT: (t: Trigger) => void; look: Lookup; err: boolean; errId: string;
}) {
  const dv = look.devices.find((x) => x.id === t.device_id);
  const caps = dv ? stateCaps(dv) : [];
  const c = dv && cap(dv, t.capability);
  const value = t.device_id ? `d:${t.device_id}` : "";
  return (
    <div className="r4">
      <div className="f">
        <span className="cap" id="td-a">Aparelho</span>
        <Picker label="Aparelho" labelledBy="td-a" Icon={PlugZap}
          options={withMissing(deviceOptions(look.devices, (x) => stateCaps(x).length > 0).map((o) => ({ ...o, group: undefined })), value, look)}
          value={value} error={err && !dv} describedBy={err ? errId : undefined}
          onChange={(v) => {
            const nd = look.devices.find((x) => x.id === v.slice(2));
            const nc = nd && (stateCaps(nd).find((k) => k.id === "power") ?? stateCaps(nd)[0]);
            setT({ ...t, device_id: v.slice(2), capability: nc?.id ?? "", to: nc ? defaultValue(nc, nd) : undefined });
          }} />
      </div>
      <div className="f">
        <span className="cap" id="td-b">O que muda</span>
        <Picker label="O que muda" labelledBy="td-b" disabled={!dv} placeholder={dv ? "Escolha" : "—"}
          options={caps.map((k) => ({ value: k.id, label: k.label }))} value={t.capability}
          onChange={(v) => {
            const nc = dv && cap(dv, v);
            setT({ ...t, capability: v, to: nc ? defaultValue(nc, dv) : undefined });
          }} />
      </div>
      <span className="vira">vira</span>
      <div className="f">
        <span className="cap" id="td-c">Para</span>
        {dv && c ? (
          <ValueField device={dv} capId={c.id} value={t.to} label="Para" labelledBy="td-c" forState
            error={err && dv && !!c} describedBy={err ? errId : undefined} onChange={(to) => setT({ ...t, to })} />
        ) : (
          <Picker label="Para" labelledBy="td-c" disabled options={[]} value="" placeholder="—" onChange={() => {}} />
        )}
      </div>
    </div>
  );
}

// SE ----------------------------------------------------------------------------------

const subjectOf = (c: Condition): string =>
  c.type === "time_between" ? "t:between" : c.type === "weekday" ? "t:weekday" : c.type === "virtual_is" ? (c.virtual_id ? `v:${c.virtual_id}` : "") : c.device_id ? `d:${c.device_id}` : "";

function subjectOptions(look: Lookup): PickOpt[] {
  return [
    { value: "t:between", label: "Horário entre…", Icon: Clock, group: "Tempo" },
    { value: "t:weekday", label: "Dia da semana", Icon: CalendarDays, group: "Tempo" },
    ...virtualOptions(look.virtuals),
    ...deviceOptions(look.devices, (x) => conditionCaps(x).length > 0),
  ];
}

function conditionFromSubject(v: string, prev: DCondition, look: Lookup): DCondition {
  const _k = prev._k;
  if (v === "t:between") return { type: "time_between", start: "09:00", end: "17:00", _k };
  if (v === "t:weekday") return { type: "weekday", days: [...WEEKDAYS], _k };
  if (v.startsWith("v:")) return { type: "virtual_is", virtual_id: v.slice(2), value: prev.type === "virtual_is" ? prev.value : false, _k };
  const dv = look.devices.find((x) => x.id === v.slice(2));
  const c = dv && (conditionCaps(dv).find((k) => k.id === "power") ?? conditionCaps(dv)[0]);
  return { type: "device_is", device_id: v.slice(2), capability: c?.id ?? "", value: c ? (c.type === "bool" ? false : defaultValue(c, dv)) : null, _k };
}

/** Texto curto do estado ("está desligado", "9:00 e 17:00", "seg a sex"). */
function conditionStateText(c: Condition, look: Lookup): string {
  if (c.type === "time_between") return `${hhmm(c.start)} e ${hhmm(c.end)}`;
  if (c.type === "weekday") return c.days.length ? daysPhrase(c.days) : "nenhum dia";
  if (c.type === "virtual_is") return c.virtual_id ? `está ${c.value ? "ligado" : "desligado"}` : "";
  const dv = look.devices.find((x) => x.id === c.device_id);
  return conditionStateOptions(dv ?? ({ capabilities: [] } as unknown as Device)).find((o) => o.value === encodeState(c.capability, c.value))?.label ?? "";
}

function StateCell({ c, set, look, labelledBy, err }: { c: DCondition; set: (c: DCondition) => void; look: Lookup; labelledBy?: string; err?: boolean }) {
  if (c.type === "time_between")
    return (
      <div className="tb">
        <TimeInput label="Das" value={c.start} onChange={(start) => set({ ...c, start })} error={err} />
        <span className="vira">e</span>
        <TimeInput label="Até" value={c.end} onChange={(end) => set({ ...c, end })} error={err} />
      </div>
    );
  if (c.type === "weekday")
    return <Days small days={c.days} label="Dias da semana" onChange={(days) => set({ ...c, days })} />;
  if (c.type === "virtual_is")
    return (
      <Picker label="Estado" labelledBy={labelledBy} disabled={!c.virtual_id} placeholder={c.virtual_id ? "Escolha" : "—"}
        options={[{ value: "true", label: "está ligado" }, { value: "false", label: "está desligado" }]}
        value={c.virtual_id ? String(c.value) : ""} onChange={(v) => set({ ...c, value: v === "true" })} />
    );
  const dv = look.devices.find((x) => x.id === c.device_id);
  return (
    <Picker label="Estado" labelledBy={labelledBy} disabled={!dv} placeholder={dv ? "Escolha" : "—"} error={err && !!dv}
      options={dv ? conditionStateOptions(dv) : []} value={encodeState(c.capability, c.value)}
      onChange={(v) => set({ ...c, ...decodeState(v) })} />
  );
}

function subjectIcon(c: Condition, look: Lookup): LucideIcon {
  if (c.type === "time_between") return Clock;
  if (c.type === "weekday") return CalendarDays;
  if (c.type === "virtual_is") return virtualIcon(look.virtuals.find((v) => v.id === c.virtual_id)?.name ?? "");
  const dv = look.devices.find((x) => x.id === c.device_id);
  return dv ? kindIcon(dv.kind) : PlugZap;
}

export function SeBlock({ d, upd, look, errs }: { d: Draft; upd: Upd; look: Lookup; errs: Record<string, string> | null }) {
  const mobile = useIsMobile();
  const [editing, setEditing] = useState<string | null>(null);
  const subjOpts = subjectOptions(look);
  const set = (c: DCondition) => upd((x) => ({ ...x, conditions: x.conditions.map((y) => (y._k === c._k ? c : y)) }));
  const remove = (k: string) => upd((x) => ({ ...x, conditions: x.conditions.filter((y) => y._k !== k) }));
  const add = () => {
    const k = key();
    upd((x) => ({ ...x, conditions: [...x.conditions, { type: "virtual_is", virtual_id: "", value: false, _k: k }] }));
    if (mobile) setEditing(k);
    else focusLater(`[data-fk="${k}"]`);
  };
  const n = d.conditions.length;
  const editingC = d.conditions.find((c) => c._k === editing);

  return (
    <section className="blk card" aria-labelledby="s-t">
      <div className="blk-h">
        <HexTile icon={ListFilter} variant={n ? "soft" : "neutral"} size="sm" />
        <h2 id="s-t">Se</h2>
        <span>{mobile ? "opcional · até 3" : "opcional · até 3 · todas precisam valer"}</span>
      </div>
      {n > 0 && (
        <div className="cg">
          {!mobile && (
            <>
              <span className="gh" id="c-a">Objeto ou aparelho</span>
              <span className="gh" id="c-b">Estado</span>
              <span />
            </>
          )}
          {d.conditions.map((c, i) => {
            // Linha recém-adicionada (nada escolhido) não grita: o motivo aparece ao lado do Salvar.
            const e = subjectOf(c) || c.type === "time_between" || c.type === "weekday" ? errs?.[c._k] : undefined;
            const subj = subjectOf(c);
            const label = subjOpts.find((o) => o.value === subj)?.label;
            const errId = `c-err-${c._k}`;
            return mobile ? (
              <div className="cg-r" key={c._k}>
                <button type="button" className={cn("pick two", e && "is-err")} aria-describedby={e ? errId : undefined}
                  aria-label={`Condição ${i + 1}: ${label ?? "a escolher"} ${conditionStateText(c, look)}`} onClick={() => setEditing(c._k)}>
                  {(() => {
                    const I = subjectIcon(c, look);
                    return <I className="i i-sm" aria-hidden />;
                  })()}
                  <span className="v">
                    {label ?? <span className="ph-t">Escolha</span>}
                    {label && <small>{conditionStateText(c, look)}</small>}
                  </span>
                  <ChevronRight className="i i-sm" aria-hidden />
                </button>
                <button type="button" className="ibtn" aria-label={`Remover condição ${i + 1}`} onClick={() => remove(c._k)}>
                  <X className="i" aria-hidden />
                </button>
                {e && <Err id={errId}>{e}</Err>}
              </div>
            ) : (
              <div className="cg-r" key={c._k}>
                <Picker label="Objeto ou aparelho" labelledBy="c-a" options={withMissing(subjOpts, subj, look)} value={subj} focusKey={c._k}
                  error={!!e && !subj} describedBy={e ? errId : undefined} onChange={(v) => set(conditionFromSubject(v, c, look))} />
                <StateCell c={c} set={set} look={look} labelledBy="c-b" err={!!e && !!subj} />
                <button type="button" className="ibtn" aria-label={`Remover condição ${label ?? i + 1}`} onClick={() => remove(c._k)}>
                  <X className="i" aria-hidden />
                </button>
                {e && <Err id={errId}>{e}</Err>}
              </div>
            );
          })}
        </div>
      )}
      {n === 0 ? (
        <button type="button" className="add-d" onClick={add}>
          <Plus className="i" aria-hidden />
          Adicionar condição
        </button>
      ) : (
        n < 3 && (
          <button type="button" className="btn btn-ghost btn-sm btn-ico add" onClick={add}>
            <Plus className="i i-sm" aria-hidden />
            Adicionar condição
          </button>
        )
      )}
      {mobile && (
        <Sheet open={!!editingC} onOpenChange={(o) => !o && setEditing(null)}
          title={`Condição ${editingC ? d.conditions.indexOf(editingC) + 1 : ""}`}
          footer={<button type="button" className="btn" onClick={() => setEditing(null)}>Pronto</button>}>
          {editingC && (
            <div className="stk">
              <div className="f">
                <span className="cap" id="mc-a">Objeto ou aparelho</span>
                <Picker label="Objeto ou aparelho" labelledBy="mc-a" options={withMissing(subjOpts, subjectOf(editingC), look)}
                  value={subjectOf(editingC)} onChange={(v) => set(conditionFromSubject(v, editingC, look))} />
              </div>
              <div className="f">
                <span className="cap" id="mc-b">Estado</span>
                <StateCell c={editingC} set={set} look={look} labelledBy="mc-b" />
              </div>
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}

// ENTÃO -------------------------------------------------------------------------------

function actionTitle(a: Action, look: Lookup): { title: string; detail: string; Icon: LucideIcon } {
  if (a.type === "delay") return { title: "Esperar", detail: `${a.minutes} min`, Icon: Hourglass };
  if (a.type === "routine") {
    const r = look.routines.find((x) => x.id === a.routine_id);
    return { title: "Executar rotina", detail: r?.name ?? "Escolha a rotina", Icon: CirclePlay };
  }
  if (a.type === "virtual") {
    const v = look.virtuals.find((x) => x.id === a.virtual_id);
    return { title: v?.name ?? (a.virtual_id ? "Objeto removido" : "Escolha o objeto"), detail: a.value ? "Ligar" : "Desligar", Icon: virtualIcon(v?.name ?? "") };
  }
  const dv = look.devices.find((x) => x.id === a.device_id);
  if (!dv) return { title: a.device_id ? "Aparelho removido" : "Escolha o aparelho", detail: "", Icon: PlugZap };
  return { title: dv.name, detail: valuesSummary(dv, actionValues(a)), Icon: kindIcon(dv.kind) };
}

export function actionSpoken(a: Action, look: Lookup) {
  const t = actionTitle(a, look);
  return [t.title, t.detail].filter(Boolean).join(" · ");
}

function subjectValue(a: Action) {
  if (a.type === "device") return a.device_id ? `d:${a.device_id}` : "";
  if (a.type === "virtual") return a.virtual_id ? `v:${a.virtual_id}` : "";
  return "";
}

function actionFromSubject(v: string, prev: DAction, look: Lookup): DAction {
  const _k = prev._k;
  if (v.startsWith("v:")) return { type: "virtual", virtual_id: v.slice(2), value: prev.type === "virtual" ? prev.value : true, _k };
  const id = v.slice(2);
  if (prev.type === "device" && prev.device_id === id) return prev;
  const dv = look.devices.find((x) => x.id === id);
  if (!dv) return { type: "device", device_id: id, values: {}, _k };
  // Trocou de aparelho: fica o que o novo também aceita (grupo de luzes → outra luz); senão, começa do "liga".
  const caps = writableCaps(dv);
  const kept = prev.type === "device"
    ? Object.fromEntries(Object.entries(actionValues(prev)).filter(([k]) => caps.some((c) => c.id === k)))
    : {};
  return { type: "device", device_id: id, values: Object.keys(kept).length ? kept : firstValues(dv), _k };
}

/** Campos de uma ação (colunas no desktop; empilhados no sheet do celular). */
function ActionFields({ a, set, look, selfId, err, errId, stacked }: {
  a: DAction; set: (a: DAction) => void; look: Lookup; selfId: string | null; err?: string; errId: string; stacked?: boolean;
}) {
  const subjOpts = [...deviceOptions(look.devices, (x) => writableCaps(x).length > 0), ...virtualOptions(look.virtuals)];
  const dv = a.type === "device" ? look.devices.find((x) => x.id === a.device_id) : undefined;
  const lbl = (id: string) => (stacked ? `m${id}` : id);
  const desc = err ? errId : undefined;
  const wrap = (labelText: string, id: string, node: ReactNode) =>
    stacked ? (
      <div className="f">
        <span className="cap" id={lbl(id)}>{labelText}</span>
        {node}
      </div>
    ) : (
      node
    );

  let first: ReactNode;
  let second: ReactNode;

  if (a.type === "device" || a.type === "virtual") {
    const sv = subjectValue(a);
    first = wrap("Aparelho ou objeto", "a-a",
      <Picker label="Aparelho" labelledBy={lbl("a-a")} options={withMissing(subjOpts, sv, look)} value={sv} focusKey={a._k}
        error={!!err && (a.type === "device" ? !dv : !look.virtuals.some((v) => v.id === a.virtual_id))} describedBy={desc}
        onChange={(v) => set(actionFromSubject(v, a, look))} />);
    if (a.type === "virtual") {
      second = wrap("Ação", "a-b",
        <Picker label="Ação" labelledBy={lbl("a-b")} options={[{ value: "true", label: "Ligar" }, { value: "false", label: "Desligar" }]}
          value={String(a.value)} onChange={(v) => set({ ...a, value: v === "true" })} />);
    } else if (stacked) {
      // Celular (sheet): os ajustes ficam logo abaixo do aparelho.
      second = dv ? (
        <div className="f">
          <span className="cap" id={lbl("a-b")}>Ajustes</span>
          <DeviceAdjusts a={a} d={dv} set={set} stacked err={!!err} />
        </div>
      ) : null;
    } else {
      // Desktop: a frase ao vivo do card; os ajustes vêm na linha de baixo (EntaoBlock).
      const txt = dv ? valuesSummary(dv, actionValues(a)) : "";
      second = (
        <p className="adj-sum" aria-hidden>
          {txt || <span className="ph-t">{dv ? "Escolha um ajuste" : "Escolha o aparelho"}</span>}
        </p>
      );
    }
  } else if (a.type === "delay") {
    first = wrap("Tipo", "a-a",
      <span className="pick is-static">
        <Hourglass className="i i-sm" aria-hidden />
        <span className="v">Esperar</span>
      </span>);
    second = wrap("Minutos", "a-b",
      <NumField label="Minutos" labelledBy={lbl("a-b")} value={a.minutes} min={1} max={120} step={5} unit="min" integer
        error={!!err} describedBy={desc} focusKey={stacked ? undefined : a._k}
        onChange={(m) => set({ ...a, minutes: m ?? Number.NaN })} />);
  } else {
    first = wrap("Tipo", "a-a",
      <span className="pick is-static">
        <CirclePlay className="i i-sm" aria-hidden />
        <span className="v">Executar rotina</span>
      </span>);
    second = wrap("Rotina", "a-b",
      <Picker label="Rotina" labelledBy={lbl("a-b")} focusKey={stacked ? undefined : a._k} error={!!err} describedBy={desc}
        options={look.routines.filter((r) => r.id !== selfId).map((r) => ({ value: r.id, label: r.name, Icon: routineIcon(r.name) }))}
        value={a.routine_id} onChange={(routine_id) => set({ ...a, routine_id })} />);
  }
  return (
    <>
      {first}
      {second}
    </>
  );
}

const ADD_KINDS: { label: string; Icon: LucideIcon; make: () => Action }[] = [
  { label: "Aparelho", Icon: PlugZap, make: () => ({ type: "device", device_id: "", values: {} }) },
  { label: "Objeto virtual", Icon: ToggleRight, make: () => ({ type: "virtual", virtual_id: "", value: true }) },
  { label: "Esperar", Icon: Hourglass, make: () => ({ type: "delay", minutes: 10 }) },
  { label: "Executar outra rotina", Icon: CirclePlay, make: () => ({ type: "routine", routine_id: "" }) },
];

function AddAction({ empty, err, errId, onAdd, canRoutine }: { empty: boolean; err?: boolean; errId: string; onAdd: (a: Action) => void; canRoutine: boolean }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={empty ? cn("add-d", err && "is-err") : "btn btn-ghost btn-sm btn-ico add"}
        aria-describedby={err ? errId : undefined}
      >
        <Plus className={empty ? "i" : "i i-sm"} aria-hidden />
        Adicionar ação
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="mk ed-pos" align="start" sideOffset={4}>
          <Menu.Popup className="menu">
            {ADD_KINDS.map((k) => (
              <Menu.Item key={k.label} render={<button type="button" />} nativeButton disabled={k.label === "Executar outra rotina" && !canRoutine}
                onClick={() => onAdd(k.make())}>
                <k.Icon className="i" aria-hidden />
                {k.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Ação recém-adicionada, sem nada escolhido ainda. */
function isBlank(a: Action) {
  return (a.type === "device" && !a.device_id) || (a.type === "virtual" && !a.virtual_id) || (a.type === "routine" && !a.routine_id);
}

function arrayMove<T>(list: T[], from: number, to: number) {
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function EntaoBlock({ d, upd, look, errs, noActions, selfId }: {
  d: Draft; upd: Upd; look: Lookup; errs: Record<string, string> | null; noActions?: string; selfId: string | null;
}) {
  const mobile = useIsMobile();
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ k: string; dy: number } | null>(null);
  const [said, setSaid] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const n = d.actions.length;
  const set = (a: DAction) => upd((x) => ({ ...x, actions: x.actions.map((y) => (y._k === a._k ? a : y)) }));
  const remove = (k: string) => upd((x) => ({ ...x, actions: x.actions.filter((y) => y._k !== k) }));
  const move = (from: number, to: number) => upd((x) => ({ ...x, actions: arrayMove(x.actions, from, to) }));
  const announce = (a: Action, pos: number) => setSaid(`${actionSpoken(a, look)}, posição ${pos + 1} de ${n}`);

  const add = (a: Action) => {
    const k = key();
    upd((x) => ({ ...x, actions: [...x.actions, { ...a, _k: k } as DAction] }));
    if (mobile) setEditing(k);
    else focusLater(`[data-fk="${k}"]`);
  };

  const step = (i: number, dir: -1 | 1) => {
    const a = d.actions[i];
    const to = i + dir;
    if (to < 0 || to >= n) return;
    move(i, to);
    announce(a, to);
    const atEdge = to === 0 || to === n - 1;
    const btn = atEdge ? (dir === -1 ? "dn" : "up") : dir === -1 ? "up" : "dn";
    focusLater(`[data-row="${a._k}"] .mv-${btn}`);
  };

  const startDrag = (e: RPointerEvent, index: number, k: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    if (rows.length < 2) return;
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    const gap = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom;
    const order = rows.map((_, i) => i);
    const st = { i: index, y0: e.clientY };
    setDrag({ k, dy: 0 });
    const onMove = (ev: PointerEvent) => {
      let dy = ev.clientY - st.y0;
      if (dy > 0 && st.i < order.length - 1) {
        const h = heights[order[st.i + 1]] + gap;
        if (dy > h / 2) {
          [order[st.i], order[st.i + 1]] = [order[st.i + 1], order[st.i]];
          move(st.i, st.i + 1);
          st.i++;
          st.y0 += h;
          dy -= h;
        }
      } else if (dy < 0 && st.i > 0) {
        const h = heights[order[st.i - 1]] + gap;
        if (-dy > h / 2) {
          [order[st.i], order[st.i - 1]] = [order[st.i - 1], order[st.i]];
          move(st.i, st.i - 1);
          st.i--;
          st.y0 -= h;
          dy += h;
        }
      }
      setDrag({ k, dy });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      const a = d.actions.find((x) => x._k === k);
      if (a) announce(a, st.i);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const editingA = d.actions.find((a) => a._k === editing);
  const editingI = editingA ? d.actions.indexOf(editingA) : -1;
  const listErrId = "e-err";
  const canRoutine = look.routines.some((r) => r.id !== selfId);

  return (
    <section className={cn("blk card", noActions && "is-err")} aria-labelledby="e-t">
      <div className="blk-h">
        <HexTile icon={Play} variant={n ? "soft" : "neutral"} size="sm" />
        <h2 id="e-t">Então</h2>
        <span>{mobile ? (n > 1 ? `${n} ações, em ordem` : "em ordem") : "1 ou mais ações, nesta ordem"}</span>
      </div>
      {n > 0 && (
        <ol className={cn(mobile ? "am-l" : "ag")} ref={listRef} aria-label="Ações">
          {!mobile && (
            <li className="ag-r ag-h" aria-hidden>
              <span />
              <span />
              <span className="gh" id="a-a">Item</span>
              <span className="gh" id="a-b">O que faz</span>
              <span />
            </li>
          )}
          {d.actions.map((a, i) => {
            const e = isBlank(a) ? undefined : errs?.[a._k];
            const errId = `a-err-${a._k}`;
            const lifted = drag?.k === a._k;
            const style = lifted ? { transform: `translateY(${drag.dy}px) scale(1.01)` } : undefined;
            const grip = (
              <span className="grip" aria-hidden onPointerDown={(ev) => startDrag(ev, i, a._k)}>
                <GripVertical className="i i-sm" />
              </span>
            );
            if (mobile) {
              const t = actionTitle(a, look);
              return (
                <li key={a._k} data-row={a._k} className={cn("am", lifted && "lift")} style={style}>
                  {grip}
                  <button type="button" className={cn("pick two", e && "is-err")} aria-describedby={e ? errId : undefined}
                    aria-label={`Ação ${i + 1}: ${actionSpoken(a, look)}`} onClick={() => setEditing(a._k)}>
                    <t.Icon className="i i-sm" aria-hidden />
                    <span className="v">
                      {t.title}
                      {t.detail && <small>{t.detail}</small>}
                    </span>
                    <ChevronRight className="i i-sm" aria-hidden />
                  </button>
                  <button type="button" className="ibtn" aria-label={`Remover ação ${i + 1}`} onClick={() => remove(a._k)}>
                    <X className="i" aria-hidden />
                  </button>
                  {e && <Err id={errId}>{e}</Err>}
                </li>
              );
            }
            const spoken = actionSpoken(a, look);
            const adev = a.type === "device" ? look.devices.find((x) => x.id === a.device_id) : undefined;
            return (
              <li key={a._k} data-row={a._k} className={cn("ag-r", adev && "ag-dev", lifted && "lift")} style={style}>
                {grip}
                <span className="ix">{i + 1}</span>
                <ActionFields a={a} set={set} look={look} selfId={selfId} err={e} errId={errId} />
                <span className="mv">
                  <button type="button" className="ibtn mv-up" disabled={i === 0} aria-label={`Subir ${spoken}`} onClick={() => step(i, -1)}>
                    <ArrowUp className="i i-sm" aria-hidden />
                  </button>
                  <button type="button" className="ibtn mv-dn" disabled={i === n - 1} aria-label={`Descer ${spoken}`} onClick={() => step(i, 1)}>
                    <ArrowDown className="i i-sm" aria-hidden />
                  </button>
                  <button type="button" className="ibtn" aria-label={`Remover ${spoken}`} onClick={() => remove(a._k)}>
                    <X className="i i-sm" aria-hidden />
                  </button>
                </span>
                {adev && a.type === "device" && <DeviceAdjusts a={a} d={adev} set={set} err={!!e} />}
                {e && <Err id={errId}>{e}</Err>}
              </li>
            );
          })}
        </ol>
      )}
      <p className="sr" role="status" aria-live="polite">
        {said}
      </p>
      <AddAction empty={n === 0} err={!!noActions} errId={listErrId} onAdd={add} canRoutine={canRoutine} />
      {noActions && <Err id={listErrId}>{noActions}</Err>}
      {mobile && (
        <Sheet open={!!editingA} onOpenChange={(o) => !o && setEditing(null)} title={`Ação ${editingI + 1}`}
          footer={
            <>
              {n > 1 && (
                <div className="sh-mv">
                  <button type="button" className="btn btn-sec btn-ico" disabled={editingI <= 0} onClick={() => move(editingI, editingI - 1)}>
                    <ArrowUp className="i i-sm" aria-hidden />
                    Subir
                  </button>
                  <button type="button" className="btn btn-sec btn-ico" disabled={editingI >= n - 1} onClick={() => move(editingI, editingI + 1)}>
                    <ArrowDown className="i i-sm" aria-hidden />
                    Descer
                  </button>
                </div>
              )}
              <button type="button" className="btn" onClick={() => setEditing(null)}>Pronto</button>
            </>
          }>
          {editingA && (
            <div className="stk">
              <ActionFields a={editingA} set={set} look={look} selfId={selfId} err={errs?.[editingA._k]} errId={`ma-err-${editingA._k}`} stacked />
              {errs?.[editingA._k] && <Err id={`ma-err-${editingA._k}`}>{errs[editingA._k]}</Err>}
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
