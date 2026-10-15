// "Personalizar card…" (menu do card): tamanho + o que o card mostra (opções do tipo do aparelho), com prévia ao vivo.
// Vale na hora (otimista) e vai pra colmeia: o mesmo card em todos os aparelhos de acesso.
import {
  Activity,
  AppWindow,
  BatteryCharging,
  BatteryMedium,
  Blend,
  Diff,
  DoorClosed,
  Fan,
  Gamepad2,
  House,
  Layers,
  MapPin,
  Palette,
  Play,
  Power,
  RotateCcw,
  Snowflake,
  SunMedium,
  Tag,
  Thermometer,
  ThermometerSun,
  ToggleRight,
  Volume2,
  VolumeX,
  WifiOff,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";
import { Sheet } from "@/components/Sheet";
import { prefsFromLook, resolveLook, showOptions, SIZE_HINT, SIZE_LABEL, SIZES, type Look, type ShowKey } from "@/lib/cardLook";
import { setCardPrefs, useCardDevice } from "@/lib/cardPrefsStore";
import type { CardSize, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeviceCard, SIZE_ICON } from "./DeviceCard";

/** Tamanho: rádio segmentado com setas (foco itinerante). */
export function SizeField({ value, onChange, label = "Tamanho", extra }: { value: CardSize | null; onChange: (s: CardSize) => void; label?: string; extra?: { label: string; selected: boolean; onSelect: () => void } }) {
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opts = SIZES;
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = Math.min(buttons.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = buttons.length - 1;
    if (n < 0) return;
    e.preventDefault();
    buttons[n].click();
    buttons[n].focus();
  }
  const current = extra?.selected ? null : value;
  return (
    <div className="fld">
      <span className="lbl" id={labelId}>
        {label}
      </span>
      <div className="seg seg-full cl-seg" role="radiogroup" aria-labelledby={labelId} ref={ref} onKeyDown={onKeyDown}>
        {extra && (
          <button type="button" role="radio" aria-checked={extra.selected} tabIndex={extra.selected ? 0 : -1} onClick={extra.onSelect}>
            {extra.label}
          </button>
        )}
        {opts.map((s) => {
          const Icon = SIZE_ICON[s];
          return (
            <button key={s} type="button" role="radio" aria-checked={current === s} tabIndex={current === s ? 0 : -1} onClick={() => onChange(s)}>
              <Icon className="i i-sm" aria-hidden />
              {SIZE_LABEL[s]}
            </button>
          );
        })}
      </div>
      <p className="hint">{current ? SIZE_HINT[current] : "Usa o tamanho escolhido no aparelho."}</p>
    </div>
  );
}

/** Ícone pequeno de cada opção (lucide, mesmo set do app). `level` muda com o tipo. */
const OPT_ICON: Record<string, LucideIcon> = {
  room: DoorClosed, members: Layers, status: Activity, offline: WifiOff,
  color: Blend, nudge: Diff, palette: Palette,
  source: AppWindow, power: Power, mute: VolumeX, remote: Gamepad2,
  current: ThermometerSun, mode: Snowflake, fan: Fan,
  fan_power: Wind, actions: Play, dock: House,
  keynames: Tag, all: ToggleRight,
  charging: BatteryCharging, home: MapPin,
};
const LEVEL_ICON: Partial<Record<Device["kind"], LucideIcon>> = {
  light: SunMedium, tv: Volume2, ac: Thermometer, vacuum: BatteryMedium, plug: Zap, phone: BatteryMedium,
};
/** Etiqueta só pro que é exclusivo de um tamanho ("só no grande"); o resto a nota do pequeno explica. */
const SIZES_TAG = (sizes: readonly CardSize[]) => (sizes.length === 1 ? `só no ${SIZE_LABEL[sizes[0]].toLowerCase()}` : null);

/** O que mostrar: opções do tipo do aparelho, em duas seções. Opção de outro tamanho fica esmaecida (vale quando trocar). */
export function ShowFields({ device, look, onChange, disabled }: { device: Device; look: Look; onChange: (k: ShowKey, v: boolean) => void; disabled?: boolean }) {
  const opts = showOptions(device);
  const groups = [
    { id: "info", title: "Informações", opts: opts.filter((o) => o.group === "info") },
    { id: "quick", title: "Controles rápidos", opts: opts.filter((o) => o.group === "quick") },
  ].filter((g) => g.opts.length);
  if (!groups.length) return <p className="hint">Este aparelho não tem o que esconder no card.</p>;
  return (
    <>
      {groups.map((g) => (
        <div className="fld" key={g.id}>
          <span className="lbl" id={`cl-g-${g.id}`}>
            {g.title}
          </span>
          <ul className="cl-show" aria-labelledby={`cl-g-${g.id}`}>
            {g.opts.map((o) => {
              const id = `cl-show-${o.key}`;
              const Glyph = o.key === "level" ? (LEVEL_ICON[device.kind] ?? Activity) : (OPT_ICON[o.key] ?? Activity);
              const elsewhere = !o.sizes.includes(look.size);
              const tag = SIZES_TAG(o.sizes);
              return (
                <li key={o.key} className={cn("cl-r", elsewhere && "is-dim", disabled && "is-dis")}>
                  <span className="cl-ic" aria-hidden>
                    <Glyph className="i i-sm" />
                  </span>
                  <span className="cl-tx">
                    <span className="t" id={id}>
                      {o.label}
                      {tag && <span className="cl-tag">{tag}</span>}
                    </span>
                    <span className="s">{o.hint}</span>
                  </span>
                  <button
                    type="button"
                    className="sw"
                    role="switch"
                    aria-checked={look.show[o.key] !== false}
                    aria-labelledby={id}
                    aria-describedby={elsewhere ? "cl-elsewhere" : undefined}
                    disabled={disabled}
                    onClick={() => onChange(o.key, look.show[o.key] === false)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {opts.some((o) => !o.sizes.includes(look.size)) && (
        <p className="hint" id="cl-elsewhere">
          As opções esmaecidas não aparecem no {SIZE_LABEL[look.size].toLowerCase()}; valem quando você trocar o tamanho.
        </p>
      )}
    </>
  );
}

/** Prévia: o próprio card, inerte, na largura de verdade (1 ou 2 colunas). */
export function CardPreview({ device, look, desktop, now }: { device: Device; look: Look; desktop: boolean; now: number }) {
  return (
    <div className={cn("ini cl-pv", desktop ? "ini-d" : "ini-m")} aria-hidden>
      <div className="devs cl-pv-g" inert>
        <DeviceCard device={device} stale={null} compact={!desktop} onLocal={() => {}} onMenu={() => {}} now={now} preview={look} />
      </div>
    </div>
  );
}

interface Props {
  device: Device | null;
  desktop: boolean;
  now: number;
  onClose: () => void;
}

export function CardLookSheet({ device, desktop, now, onClose }: Props) {
  const last = useRef<Device | null>(device);
  if (device) last.current = device;
  const d = device ?? last.current;
  // Hooks antes do retorno: sem aparelho, usa um vazio (a folha está fechando).
  const live = useCardDevice(d ?? EMPTY);
  if (!d) return null;
  const look = resolveLook(live);
  const isDefault = !live.card;
  const change = (next: Look) => setCardPrefs(d, prefsFromLook(next, d));

  return (
    <Sheet
      open={device !== null}
      onOpenChange={(o) => !o && onClose()}
      desktop={desktop}
      rootClassName="cl"
      className="cl-sht"
      title={`Personalizar card · ${d.name}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-ico" disabled={isDefault} onClick={() => setCardPrefs(d, null)}>
            <RotateCcw className="i" aria-hidden />
            Voltar ao padrão
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Concluir
          </button>
        </>
      }
    >
      <CardPreview device={live} look={look} desktop={desktop} now={now} />
      <p className="hint cl-note">Vale para este card em todos os aparelhos que abrem a colmeia.</p>
      <SizeField value={look.size} onChange={(size) => change({ ...look, size })} />
      <ShowFields device={d} look={look} onChange={(k, v) => change({ ...look, show: { ...look.show, [k]: v } })} />
    </Sheet>
  );
}

const EMPTY: Device = {
  id: "",
  vendor: "",
  vendor_label: "",
  kind: "other",
  name: "",
  room: null,
  pinned: false,
  online: null,
  last_seen: null,
  state: {},
  capabilities: [],
  notes: [],
};
