// "Configurar card": sheet lateral de 420 px no PC, folha de baixo no celular. Campos por tipo, largura com miniatura,
// nome exibido, "Mover para a aba…" e Remover. As mudanças vão pro rascunho ao vivo (a grade atrás acompanha).
import { HexTile } from "@/components/favos";
import { Check, ChevronsUpDown, GripVertical, Layers, Search, Trash2, WifiOff, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Sheet } from "@/components/Sheet";
import { resolveLook, showOptions, type Look } from "@/lib/cardLook";
import { flipPanel, useCardOf } from "@/lib/cardPrefsStore";
import { isComplete, MAX_GLANCE, minCols } from "@/lib/dashboard";
import { isOffline, kindIcon } from "@/lib/devices";
import type { DashCard, DashView, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardPreview, ShowFields, SizeField } from "../CardLookSheet";
import { routineIcon, virtualIcon } from "../home";
import { useEnv } from "./env";
import { matches, plural } from "./util";

interface Opt {
  value: string;
  label: string;
  sub?: string;
  Icon: LucideIcon;
  group?: string;
  off?: boolean;
}

const TYPE_NAME: Record<DashCard["type"], string> = {
  device: "Aparelho",
  glance: "Lista compacta",
  routine: "Rotina",
  virtual: "Objeto virtual",
  summary: "Resumo da casa",
};

const isGroup = (d: Device) => d.vendor === "grupo";

function deviceOpts(devices: Device[]): Opt[] {
  const opt = (d: Device, group: string): Opt => ({
    value: d.id,
    label: d.name,
    sub: isGroup(d) ? `${d.members?.length ?? 0} aparelhos` : (d.room ?? undefined),
    Icon: isGroup(d) ? Layers : kindIcon(d.kind),
    group,
    off: isOffline(d),
  });
  const by = (a: Device, b: Device) => a.name.localeCompare(b.name, "pt-BR");
  const groups = devices.filter(isGroup).sort(by);
  const rooms = new Map<string, Device[]>();
  for (const d of devices.filter((x) => !isGroup(x))) rooms.set(d.room ?? "Sem cômodo", [...(rooms.get(d.room ?? "Sem cômodo") ?? []), d]);
  const names = [...rooms.keys()].sort((a, b) => (a === "Sem cômodo" ? 1 : b === "Sem cômodo" ? -1 : a.localeCompare(b, "pt-BR")));
  return [...groups.map((d) => opt(d, "Grupos")), ...names.flatMap((n) => rooms.get(n)!.sort(by).map((d) => opt(d, n)))];
}

/* ---------------- escolha única (com busca) ---------------- */

function OptRow({ o, selected, hl, id, onPick, onHover }: { o: Opt; selected: boolean; hl: boolean; id: string; onPick: () => void; onHover: () => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={cn("ep-pk ep-pk-b", selected && "on", hl && "is-hl", o.off && "off")}
      onPointerMove={onHover}
      onClick={onPick}
    >
      <HexTile icon={<o.Icon className="i" aria-hidden />} size="sm" />
      <span className="ep-pk-t">
        <b>{o.label}</b>
        {o.sub && <small>{o.sub}</small>}
        {o.off && (
          <small className="ep-off">
            <WifiOff className="i i-sm" aria-hidden />
            Sem resposta
          </small>
        )}
      </span>
      {selected && <Check className="i i-sm ep-ck" aria-hidden />}
    </div>
  );
}

function ChoiceField({
  label,
  options,
  value,
  onChange,
  placeholder,
  searchLabel,
  onNewGroup,
}: {
  label: string;
  options: Opt[];
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder: string;
  searchLabel: string;
  /** "Novo grupo…" no fim da lista (só no seletor de aparelhos). */
  onNewGroup?: () => void;
}) {
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const labelId = useId();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cur = options.find((o) => o.value === value);
  const shown = useMemo(() => options.filter((o) => matches(q, `${o.label} ${o.sub ?? ""} ${o.group ?? ""}`)), [options, q]);
  const at = Math.min(hl, Math.max(0, shown.length - 1));

  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  function pick(o: Opt) {
    onChange(o.value);
    setOpen(false);
    setQ("");
    trigger.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl(shown.length ? (at + 1) % shown.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl(shown.length ? (at - 1 + shown.length) % shown.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[at]) pick(shown[at]);
    } else if (e.key === "Escape" && cur) {
      // Fecha só a lista (sem escolha ainda, o Esc fecha a folha como sempre).
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }

  let lastGroup: string | undefined;
  return (
    <div className="fld">
      <span className="lbl" id={labelId}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="inp ep-combo"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId}`}
        onClick={() => setOpen((o) => !o)}
      >
        {cur && <cur.Icon className="i muted" aria-hidden />}
        <span className={cn("ep-v", !cur && "ep-ph")}>{cur ? cur.label : placeholder}</span>
        {cur?.sub && <span className="ep-v2">{cur.sub}</span>}
        <ChevronsUpDown className="i i-sm muted" aria-hidden />
      </button>
      {open && (
        <div className="ep-pickw">
          <div className="inp">
            <Search className="i i-sm muted" aria-hidden />
            <input
              ref={input}
              type="search"
              value={q}
              placeholder={searchLabel}
              aria-label={searchLabel}
              autoComplete="off"
              onChange={(e) => {
                setQ(e.target.value);
                setHl(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="ep-pick ep-pick-sel" role="listbox" id={listId} aria-labelledby={labelId}>
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value} role="none">
                  {head && options.some((x) => x.group !== o.group) && <p className="ep-gh">{head}</p>}
                  <OptRow o={o} selected={o.value === value} hl={i === at} id={`${listId}-${i}`} onHover={() => setHl(i)} onPick={() => pick(o)} />
                </div>
              );
            })}
            {shown.length === 0 && <p className="ep-none">Nada com “{q.trim()}”.</p>}
            {onNewGroup && (
              <button type="button" className="ep-newgrp" onClick={onNewGroup}>
                <HexTile icon={<Layers className="i" aria-hidden />} size="sm" />
                Novo grupo…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- lista compacta: vários aparelhos, com ordem ---------------- */

const arrayMove = <T,>(list: T[], from: number, to: number) => {
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

function MultiField({ devices, value, onChange }: { devices: Device[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [said, setSaid] = useState("");
  const labelId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const chosen = value.flatMap((id) => byId.get(id) ?? []);
  const rest = useMemo(
    () => deviceOpts(devices).filter((o) => !value.includes(o.value) && matches(q, `${o.label} ${o.sub ?? ""}`)),
    [devices, value, q],
  );
  const full = value.length >= MAX_GLANCE;

  const rowOf = (d: Device): Opt => deviceOpts([d])[0];

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!full) onChange([...value, id]);
  }

  function step(i: number, dir: -1 | 1, name: string) {
    const to = i + dir;
    if (to < 0 || to >= value.length) return;
    onChange(arrayMove(value, i, to));
    setSaid(`${name}, posição ${to + 1} de ${value.length}`);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(value[i])}"] .ep-gp`)?.focus());
  }

  function drag(e: React.PointerEvent<HTMLElement>, i: number) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const h = rows[0]?.getBoundingClientRect().height || 40;
    const id = value[i];
    const y0 = e.clientY;
    let at = i;
    setLifted(id);
    const move = (ev: PointerEvent) => {
      const to = Math.max(0, Math.min(value.length - 1, i + Math.round((ev.clientY - y0) / h)));
      if (to !== at) {
        at = to;
        onChange(arrayMove(value, i, to));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLifted(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className="fld">
      <div className="ep-lh">
        <span className="lbl" id={labelId}>
          Aparelhos
        </span>
        <span className="muted num">
          {value.length} {value.length === 1 ? "selecionado" : "selecionados"}
          {value.length > 1 && " · alça ordena"}
        </span>
      </div>
      <div className="inp">
        <Search className="i i-sm muted" aria-hidden />
        <input type="search" value={q} placeholder="Buscar aparelho" aria-label="Buscar aparelho" autoComplete="off" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ep-pick" role="listbox" aria-multiselectable="true" aria-labelledby={labelId} ref={list}>
        {chosen.map((d, i) => {
          const o = rowOf(d);
          return (
            <div key={d.id} className={cn("ep-pk on", lifted === d.id && "lift")} role="option" aria-selected data-row={d.id}>
              <button
                type="button"
                className={cn("ep-gp", chosen.length < 2 && "no")}
                aria-label={`Mover ${d.name}`}
                aria-roledescription="item arrastável"
                tabIndex={chosen.length < 2 ? -1 : 0}
                onPointerDown={(e) => drag(e, i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    step(i, e.key === "ArrowUp" ? -1 : 1, d.name);
                  }
                }}
              >
                <GripVertical className="i i-sm" aria-hidden />
              </button>
              <HexTile icon={<o.Icon className="i" aria-hidden />} size="sm" />
              <span className="ep-pk-t">
                <b>{d.name}</b>
                {o.sub && <small>{o.sub}</small>}
              </span>
              <button type="button" className="ep-cb on" role="checkbox" aria-checked aria-label={`Tirar ${d.name}`} onClick={() => toggle(d.id)}>
                <Check className="i" aria-hidden />
              </button>
            </div>
          );
        })}
        {rest.map((o, i) => (
          <div key={o.value} className={cn("ep-pk", i === 0 && chosen.length > 0 && "sepr")} role="option" aria-selected={false}>
            <span className="ep-gp no" aria-hidden>
              <GripVertical className="i i-sm" />
            </span>
            <HexTile icon={<o.Icon className="i" aria-hidden />} size="sm" />
            <span className="ep-pk-t">
              <b>{o.label}</b>
              {o.sub && <small>{o.sub}</small>}
            </span>
            <button type="button" className="ep-cb" role="checkbox" aria-checked={false} aria-label={`Incluir ${o.label}`} disabled={full} onClick={() => toggle(o.value)}>
              <Check className="i" aria-hidden />
            </button>
          </div>
        ))}
        {rest.length === 0 && chosen.length === 0 && <p className="ep-none">Nenhum aparelho com “{q.trim()}”.</p>}
      </div>
      {full && <p className="hint">No máximo {MAX_GLANCE} aparelhos na lista.</p>}
      <p className="sr" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/* ---------------- largura e nome ---------------- */

function WidthField({ cols, min, onChange, hint, columnsOnPhone }: { cols: number; min: number; onChange: (c: 1 | 2 | 3 | 4) => void; hint: string; columnsOnPhone: boolean }) {
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opts = [1, 2, 3, 4] as const;
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = opts.indexOf(cols as 1);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = Math.min(3, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = Math.max(min - 1, i - 1);
    else if (e.key === "Home") n = min - 1;
    else if (e.key === "End") n = 3;
    if (n < 0) return;
    e.preventDefault();
    onChange(opts[n]);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[n]?.focus();
  }
  return (
    <div className="fld">
      <span className="lbl" id={labelId}>
        Largura
      </span>
      <div className="seg seg-full" role="radiogroup" aria-labelledby={labelId} ref={ref} onKeyDown={onKeyDown}>
        {opts.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === cols}
            tabIndex={n === cols ? 0 : -1}
            disabled={n < min}
            onClick={() => onChange(n)}
          >
            {n === 4 ? "Linha toda" : `${n} ${n === 1 ? "coluna" : "colunas"}`}
          </button>
        ))}
      </div>
      <div className="ep-gm" aria-hidden>
        <i className="on" style={{ gridColumn: `span ${cols}` }} />
        {Array.from({ length: 4 - cols }, (_, k) => (
          <i key={k} />
        ))}
      </div>
      <p className="hint">
        {hint}
        {columnsOnPhone && cols >= 3 ? " No celular ocupa a linha toda." : ""}
      </p>
    </div>
  );
}

function NameField({ value, placeholder, hint, onChange }: { value: string; placeholder: string; hint: string; onChange: (v: string | null) => void }) {
  const id = useId();
  return (
    <div className="fld">
      <label htmlFor={id}>Nome exibido</label>
      <div className="inp">
        <input id={id} type="text" value={value} placeholder={placeholder} maxLength={60} autoComplete="off" aria-describedby={`${id}-h`} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)} />
      </div>
      <p className="hint" id={`${id}-h`}>
        {hint}
      </p>
    </div>
  );
}

const occupies = (cols: number) =>
  cols === 4 ? "Ocupa a linha toda." : `Ocupa ${cols} ${cols === 1 ? "coluna" : "colunas"}; em tela larga cabem mais cards por linha.`;

/** Aparência do card de aparelho no painel: herda o padrão do aparelho ou tem a sua (tamanho + o que mostra). */
function LookField({ card, device, desktop, now, onPatch }: { card: DashCard; device: Device; desktop: boolean; now: number; onPatch: Props["onPatch"] }) {
  const cardOf = useCardOf();
  const base = cardOf(device);
  const own = Boolean(card.size || card.show);
  const look = resolveLook(base, card);
  const id = useId();
  // Só as chaves do tipo deste aparelho (o resto o card nem desenha).
  const showOf = (l: Look) => Object.fromEntries(showOptions(device).map((o) => [o.key, l.show[o.key] !== false]));
  const set = (next: Look) => {
    const patch = { size: next.size, show: showOf(next) };
    if (next.size !== look.size) flipPanel(device.id, () => onPatch(patch));
    else onPatch(patch);
  };
  return (
    <>
      <CardPreview device={base} look={look} desktop={desktop} now={now} />
      <div className="fld">
        <div className="cl-r ep-own">
          <span className="cl-tx">
            <span className="t" id={id}>
              Igual ao card do aparelho
            </span>
            <span className="s">{own ? "Este card tem tamanho e itens próprios" : "Muda junto quando você personaliza o aparelho"}</span>
          </span>
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={!own}
            aria-labelledby={id}
            onClick={() => {
              if (own) flipPanel(device.id, () => onPatch({ size: null, show: null }));
              else onPatch({ size: look.size, show: showOf(look) });
            }}
          />
        </div>
      </div>
      {own && (
        <>
          <SizeField value={look.size} onChange={(size) => set({ ...look, size })} />
          <ShowFields device={device} look={look} onChange={(k, v) => set({ ...look, show: { ...look.show, [k]: v } })} />
        </>
      )}
    </>
  );
}

/* ---------------- a folha ---------------- */

interface Props {
  card: DashCard | null;
  /** Aberta (some enquanto o dialog de grupo está na frente). */
  open: boolean;
  desktop: boolean;
  views: DashView[];
  activeViewId: string;
  onPatch: (patch: Partial<Omit<DashCard, "id">>) => void;
  onRemove: () => void;
  /** Concluir, fechar (X, Esc, fora). */
  onClose: () => void;
  onMoveToView: (viewId: string) => void;
  onNewGroup: () => void;
  /** Depois da animação de saída. */
  onClosed: () => void;
  /** O foco volta pra engrenagem do card. */
  finalFocus: () => HTMLElement | boolean | null;
}

export function ConfigCard({ card, open, desktop, views, activeViewId, onPatch, onRemove, onClose, onMoveToView, onNewGroup, onClosed, finalFocus }: Props) {
  const env = useEnv();
  const last = useRef<DashCard | null>(card);
  if (card) last.current = card;
  const c = card ?? last.current;
  const device = c?.type === "device" ? env.devices.find((d) => d.id === c.device_id) : undefined;
  const dOpts = useMemo(() => deviceOpts(env.devices), [env.devices]);
  const rOpts = useMemo<Opt[]>(
    () => env.routines.map((r) => ({ value: r.id, label: r.name, sub: r.incomplete ? "Incompleta" : plural(r.actions.length, "ação", "ações"), Icon: routineIcon(r.name) })),
    [env.routines],
  );
  const vOpts = useMemo<Opt[]>(() => env.virtuals.map((v) => ({ value: v.id, label: v.name, Icon: virtualIcon(v.name) })), [env.virtuals]);

  if (!c) return null;
  const min = minCols(c, device);
  const complete = isComplete(c);
  const fallbackName =
    c.type === "device"
      ? (device?.name ?? "")
      : c.type === "routine"
        ? (env.routines.find((r) => r.id === c.routine_id)?.name ?? "")
        : c.type === "virtual"
          ? (env.virtuals.find((v) => v.id === c.virtual_id)?.name ?? "")
          : "Mais usados";
  const nameHint =
    c.type === "device"
      ? "Opcional. Vazio usa o nome do aparelho."
      : c.type === "routine"
        ? "Opcional. Vazio usa o nome da rotina."
        : c.type === "virtual"
          ? "Opcional. Vazio usa o nome do objeto."
          : "Opcional. Aparece no topo da lista.";
  const widthHint =
    c.type === "glance"
      ? `A lista precisa de pelo menos 2 colunas. ${occupies(c.cols)}`
      : min === 2
        ? `O robô precisa de pelo menos 2 colunas. ${occupies(c.cols)}`
        : `${occupies(c.cols)}${device && device.kind === "ac" ? " Ar e robô sugerem 2." : ""}`;
  const others = views.filter((v) => v.id !== activeViewId);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onClosed={onClosed}
      desktop={desktop}
      rootClassName="ep cl"
      className="ep-cfg"
      title={`Configurar card · ${TYPE_NAME[c.type]}`}
      finalFocus={finalFocus}
      footer={
        <>
          <button type="button" className="btn btn-ghost ep-rm" onClick={onRemove}>
            <Trash2 className="i" aria-hidden />
            Remover card
          </button>
          <button type="button" className="btn" disabled={!complete} title={complete ? undefined : "Escolha o que o card mostra"} onClick={onClose}>
            Concluir
          </button>
        </>
      }
    >
      {c.type === "device" && (
        <ChoiceField label="Aparelho" options={dOpts} value={c.device_id} placeholder="Escolha um aparelho" searchLabel="Buscar aparelho" onNewGroup={onNewGroup} onChange={(id) => {
          const d = env.devices.find((x) => x.id === id);
          // Ar sugere 2 colunas; o robô exige. Só sobe, nunca desce o que a pessoa já escolheu.
          const want = d && d.vendor !== "grupo" && (d.kind === "ac" || d.kind === "vacuum") && !c.device_id ? 2 : c.cols;
          onPatch({ device_id: id, cols: Math.max(want, minCols(c, d)) as 1 | 2 | 3 | 4 });
        }} />
      )}
      {c.type === "routine" && (
        <ChoiceField label="Rotina" options={rOpts} value={c.routine_id} placeholder="Escolha uma rotina" searchLabel="Buscar rotina" onChange={(id) => onPatch({ routine_id: id })} />
      )}
      {c.type === "virtual" && (
        <ChoiceField label="Objeto virtual" options={vOpts} value={c.virtual_id} placeholder="Escolha um objeto" searchLabel="Buscar objeto" onChange={(id) => onPatch({ virtual_id: id })} />
      )}
      {c.type === "glance" && <MultiField devices={env.devices} value={c.device_ids ?? []} onChange={(ids) => onPatch({ device_ids: ids })} />}
      <WidthField cols={c.cols} min={min} hint={widthHint} columnsOnPhone onChange={(cols) => onPatch({ cols })} />
      {c.type === "device" && device && <LookField card={c} device={device} desktop={desktop} now={env.now} onPatch={onPatch} />}
      {c.type !== "summary" && <NameField value={c.name ?? ""} placeholder={fallbackName} hint={nameHint} onChange={(name) => onPatch({ name })} />}
      {others.length > 0 && complete && (
        <div className="fld">
          <span className="lbl" id="ep-mv-l">
            Mover para a aba
          </span>
          <div className="ep-mv" role="group" aria-labelledby="ep-mv-l">
            {others.map((v) => (
              <button key={v.id} type="button" className="btn btn-sec btn-sm" onClick={() => onMoveToView(v.id)}>
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
