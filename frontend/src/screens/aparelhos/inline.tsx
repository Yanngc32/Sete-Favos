// Controles que abrem dentro do card na lista Dispositivos (mock exploracao-favos, telas 3, 6 e 7).
// Mesma lógica de comando do Detalhe (useControl: otimista, volta e toast "Tentar de novo" se falhar); aqui só
// o desenho compacto. Cada controle só aparece se o aparelho tiver a capacidade (e não for só leitura).
import {
  BatteryCharging,
  ChevronRight,
  CircleAlert,
  House,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Expandable, Swap } from "@/components/favos";
import { cap, has, switchKeys, vacuumStatus } from "@/lib/devices";
import { dec, int } from "@/lib/format";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { matchSwatch, PALETTE, paletteHex, swatchVar } from "@/screens/detalhe/colors";
import { Seg, Slider, type SegOption } from "@/screens/detalhe/controls";
import { noWol } from "@/screens/detalhe/bodies";
import { Remote } from "@/screens/detalhe/Remote";
import { warmth, type Control } from "@/screens/detalhe/useControl";
import { vendorShort } from "./wizard/model";

export interface InlineProps {
  device: Device;
  ctl: Control;
  disabled: boolean;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Rótulos curtos só onde o original não cabe numa linha de 375px (o nome inteiro fica no aria-label). */
const SHORT: Record<string, string> = { Desumidificar: "Secar" };

function opts(device: Device, id: string): SegOption[] {
  return (cap(device, id)?.options ?? []).map((o) => ({ value: o.value, label: SHORT[o.label] ?? o.label }));
}

const writable = (device: Device, id: string) => {
  const c = cap(device, id);
  return !!c && !c.readonly;
};

/** O card tem algo pra abrir? (controles ou, no mínimo, a ficha com IP/modelo e o link do detalhe). */
export function inlineBody(props: InlineProps) {
  const { device } = props;
  const k = device.kind;
  let body: ReactNode = null;
  if (k === "light") body = <LightInline {...props} />;
  else if (k === "ac") body = <AcInline {...props} />;
  else if (k === "tv") body = <TvInline {...props} />;
  else if (k === "switch" && switchKeys(device).length > 1) body = <KeysInline {...props} />;
  else if (k === "vacuum") body = <VacuumInline {...props} />;
  else if (k === "plug") body = <PlugInline {...props} />;
  else if (k === "phone") body = <PhoneInline {...props} />;
  return (
    <>
      {props.disabled && device.online === false && (
        <p className="dx-off" role="status">
          <CircleAlert className="i i-sm" aria-hidden />
          Sem resposta. Os controles voltam quando o aparelho responder.
        </p>
      )}
      {body}
      <Info device={device} />
    </>
  );
}

/* ---------------- ficha: fabricante · modelo · IP + Abrir detalhe ---------------- */

function Info({ device }: { device: Device }) {
  const location = useLocation();
  const members = device.vendor === "grupo" ? (device.members?.length ?? 0) : null;
  return (
    <div className="dx-info">
      <span className="dx-meta">
        {members != null ? (
          <>Grupo · {members === 1 ? "1 aparelho" : `${members} aparelhos`}</>
        ) : (
          <>
            {vendorShort(device.vendor_label)}
            {device.model && device.model !== vendorShort(device.vendor_label) && <> · {device.model}</>}
            {device.ip && (
              <>
                {" · "}
                <span className="mono">{device.ip}</span>
              </>
            )}
          </>
        )}
      </span>
      <Link className="btn-link dx-go" to={`/aparelho/${device.id}`} state={{ back: location.pathname + location.search }}>
        {device.vendor === "grupo" ? "Abrir grupo" : "Abrir detalhe"}
        <ChevronRight className="i i-sm" aria-hidden />
      </Link>
    </div>
  );
}

/* ---------------- −/+ grande (ar e volume) ---------------- */

function Stepper({
  value,
  unit,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusOff,
  plusOff,
  srLabel,
  muted,
  children,
}: {
  value: number | string;
  unit: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  minusOff?: boolean;
  plusOff?: boolean;
  srLabel: string;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="dx-stp" role="group" aria-label={srLabel}>
      <button type="button" className="dx-stb" aria-label={minusLabel} disabled={minusOff} onClick={onMinus}>
        <Minus className="i i-sm" aria-hidden />
      </button>
      <span className={cn("dx-stv", muted && "is-muted")} aria-live="polite">
        <span className="sr">{srLabel} </span>
        <Swap value={value} />
        <small>{unit}</small>
      </span>
      <button type="button" className="dx-stb" aria-label={plusLabel} disabled={plusOff} onClick={onPlus}>
        <Plus className="i i-sm" aria-hidden />
      </button>
      {children}
    </div>
  );
}

function Row({ label, id, value, children }: { label: string; id?: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dx-c">
      <div className="dx-r">
        <span className="dx-l" id={id}>
          {label}
        </span>
        {value !== undefined && <span className="dx-v">{value}</span>}
      </div>
      {children}
    </div>
  );
}

/* ---------------- luz / fita LED ---------------- */

const WHITE = [
  { id: "quente", label: "Quente" },
  { id: "fria", label: "Fria" },
] as const;

function LightInline({ device, ctl, disabled }: InlineProps) {
  const bright = cap(device, "brightness");
  const temp = cap(device, "color_temp");
  const hasColor = writable(device, "color");
  const b = num(ctl.value("brightness"), bright?.min ?? 1);
  const t = num(ctl.value("color_temp"), 50);
  return (
    <>
      {bright && !bright.readonly && (
        <Row label="Brilho" value={<Swap value={`${Math.round(b)}%`} />}>
          <Slider
            className="dx-sl"
            label={`Brilho de ${device.name}`}
            min={bright.min ?? 1}
            max={bright.max ?? 100}
            step={bright.step ?? 1}
            value={b}
            valueText={(v) => `${Math.round(v)} por cento`}
            onCommit={(v) => void ctl.send("brightness", v)}
            disabled={disabled}
          />
        </Row>
      )}
      {hasColor ? (
        <Palette device={device} ctl={ctl} disabled={disabled} />
      ) : (
        temp &&
        !temp.readonly && (
          <Row label="Temperatura de cor" value={<Swap value={warmth(t)} />}>
            <Slider
              className="dx-sl dx-kel"
              fill={false}
              label={`Temperatura de cor de ${device.name}`}
              min={temp.min ?? 0}
              max={temp.max ?? 100}
              step={temp.step ?? 1}
              value={t}
              valueText={(v) => warmth(v).toLowerCase()}
              onCommit={(v) => void ctl.send("color_temp", v)}
              disabled={disabled}
            />
          </Row>
        )
      )}
    </>
  );
}

/** Paleta da lâmpada RGB: Quente/Fria (temperatura de cor, se houver) + as cores --color-luz-*. */
function Palette({ device, ctl, disabled }: InlineProps) {
  const ids = useId();
  const temp = cap(device, "color_temp");
  const tempOk = !!temp && !temp.readonly;
  const color = ctl.value<string | undefined>("color");
  const swatch = matchSwatch(color);
  const t = num(ctl.value("color_temp"), 50);
  // O estado não diz se a lâmpada está no branco ou na cor: sem cor nenhuma (ou logo depois de tocar em
  // Quente/Fria aqui) vale o branco; uma cor fora da paleta é "Personalizada" (feita no Detalhe).
  const [whiteMode, setWhiteMode] = useState(false);
  const white = !swatch && tempOk && (whiteMode || !color) ? (t <= 33 ? "quente" : t >= 67 ? "fria" : null) : null;
  const selected = swatch ?? white;
  const name = swatch
    ? PALETTE.find((c) => c.id === swatch)?.label
    : white
      ? `Branco ${white === "quente" ? "quente" : "frio"}`
      : color
        ? "Personalizada"
        : "—";
  const items = [...(tempOk ? WHITE : []), ...PALETTE];
  const pick = (id: string) => {
    if (id === "quente" || id === "fria") {
      const v = id === "quente" ? (temp?.min ?? 0) : (temp?.max ?? 100);
      setWhiteMode(true);
      void ctl.send("color_temp", v);
      return;
    }
    setWhiteMode(false);
    const hex = paletteHex().get(id);
    if (hex) void ctl.send("color", hex);
  };
  return (
    <Row label="Cor" id={`${ids}-c`} value={<Swap value={name ?? "—"} />}>
      <div className="dx-pal" role="radiogroup" aria-labelledby={`${ids}-c`} style={{ "--n": items.length } as CSSProperties}>
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className="dx-pc"
            role="radio"
            aria-checked={selected === c.id}
            aria-label={c.label}
            disabled={disabled}
            style={{ background: swatchVar(c.id) }}
            onClick={() => selected !== c.id && pick(c.id)}
          />
        ))}
      </div>
    </Row>
  );
}

/* ---------------- ar-condicionado ---------------- */

function AcInline({ device, ctl, disabled }: InlineProps) {
  const ids = useId();
  const target = cap(device, "target_temp");
  const min = target?.min ?? 16;
  const max = target?.max ?? 30;
  const step = target?.step ?? 1;
  const t = num(ctl.value("target_temp"), min);
  const decimals = step < 1 ? 1 : 0;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const go = (delta: number) => {
    const next = Math.round(Math.min(max, Math.max(min, t + delta)) / step) * step;
    if (next !== t) ctl.bump("target_temp", next);
  };
  const ambient = device.state.current_temp;
  return (
    <>
      {target && !target.readonly && (
        <Stepper
          srLabel="Temperatura alvo"
          value={fmt(t)}
          unit="°C"
          minusLabel={`Diminuir para ${fmt(Math.max(min, t - step))} graus`}
          plusLabel={`Aumentar para ${fmt(Math.min(max, t + step))} graus`}
          minusOff={disabled || t <= min}
          plusOff={disabled || t >= max}
          onMinus={() => go(-step)}
          onPlus={() => go(step)}
        />
      )}
      {typeof ambient === "number" && <p className="dx-amb">Ambiente {int.format(ambient)} °C</p>}
      {writable(device, "ac_mode") && (
        <Row label="Modo" id={`${ids}-m`}>
          <Seg className="dx-seg" labelledBy={`${ids}-m`} options={opts(device, "ac_mode")} value={ctl.value("ac_mode")}
            onChange={(v) => void ctl.send("ac_mode", v)} disabled={disabled} />
        </Row>
      )}
      {writable(device, "fan_speed") && (
        <Row label="Ventilação" id={`${ids}-v`}>
          <Seg className="dx-seg" labelledBy={`${ids}-v`} options={opts(device, "fan_speed")} value={ctl.value("fan_speed")}
            onChange={(v) => void ctl.send("fan_speed", v)} disabled={disabled} />
        </Row>
      )}
    </>
  );
}

/* ---------------- TV ---------------- */

function TvInline({ device, ctl, disabled }: InlineProps) {
  const ids = useId();
  const on = ctl.value("power") === true;
  const volCap = cap(device, "volume");
  const vol = num(ctl.value("volume"), 0);
  const muted = ctl.value("muted") === true;
  const vMin = volCap?.min ?? 0;
  const vMax = volCap?.max ?? 100;
  const vStep = volCap?.step ?? 1;
  if (!on) {
    const why = noWol(device);
    return <p className="dx-note">{why ?? "Desligada. Ligue no botão ao lado pra mudar volume e entrada."}</p>;
  }
  const srcs = opts(device, "source");
  return (
    <>
      {volCap && !volCap.readonly && (
        <Stepper
          srLabel={muted ? "Mudo, volume" : "Volume"}
          value={Math.round(vol)}
          unit="vol"
          muted={muted}
          minusLabel="Diminuir volume"
          plusLabel="Aumentar volume"
          minusOff={disabled || vol <= vMin}
          plusOff={disabled || vol >= vMax}
          onMinus={() => ctl.bump("volume", Math.max(vMin, vol - vStep))}
          onPlus={() => ctl.bump("volume", Math.min(vMax, vol + vStep))}
        >
          {has(device, "muted") && (
            <button type="button" className="dx-stb" aria-label="Mudo" aria-pressed={muted} disabled={disabled}
              onClick={() => void ctl.send("muted", !muted)}>
              <VolumeX className="i i-sm" aria-hidden />
            </button>
          )}
        </Stepper>
      )}
      {srcs.length > 0 && writable(device, "source") && (
        <Row label="Entrada" id={`${ids}-e`}>
          <Seg className={cn("dx-seg", srcs.length > 5 && "dx-seg-wrap")} labelledBy={`${ids}-e`} options={srcs}
            value={ctl.value("source")} onChange={(v) => void ctl.send("source", v)} disabled={disabled} />
        </Row>
      )}
      {device.remote && device.remote.length > 0 && (
        <Expandable className="dx-rc" summary={<span className="dx-l">Controle remoto</span>} label="controle remoto">
          <Remote device={device} disabled={disabled} />
        </Expandable>
      )}
    </>
  );
}

/* ---------------- interruptor de várias teclas: uma tecla por linha ---------------- */

function KeysInline({ device, ctl, disabled }: InlineProps) {
  return (
    <ul className="dx-keys" aria-label="Teclas">
      {switchKeys(device).map((k) => {
        const on = ctl.value(k.id) === true;
        return (
          <li key={k.id} className={cn("dx-key", on && "on")}>
            <span>{k.label}</span>
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={on}
              aria-busy={ctl.pending(k.id) || undefined}
              aria-label={`${on ? "Desligar" : "Ligar"} ${k.label}`}
              disabled={disabled || k.readonly}
              onClick={() => void ctl.send(k.id, !on)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- robô ---------------- */

function VacuumInline({ device, ctl, disabled }: InlineProps) {
  const ids = useId();
  const status = String(device.state.vacuum_status ?? "");
  const cleaning = status === "cleaning";
  const atBase = status === "docked" || status === "charging" || status === "returning";
  const error = status === "error" ? String(device.state.vacuum_error || "Erro sem descrição") : null;
  const actions = [
    has(device, "start") && { id: "start", label: "Iniciar", Icon: Play, primary: !cleaning, off: cleaning },
    has(device, "pause") && { id: "pause", label: "Pausar", Icon: Pause, primary: cleaning, off: !cleaning && status !== "returning" },
    has(device, "dock") && { id: "dock", label: "Base", Icon: House, primary: false, off: atBase },
  ].filter(Boolean) as { id: string; label: string; Icon: LucideIcon; primary: boolean; off: boolean }[];
  return (
    <>
      {error && (
        <p className="dx-err" role="alert">
          <CircleAlert className="i i-sm" aria-hidden />
          {vacuumStatus(device)}: {error}
        </p>
      )}
      {actions.length > 0 && (
        <div className="dx-acts">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={cn("btn btn-sm", !a.primary && "btn-sec")}
              disabled={disabled || a.off}
              aria-busy={ctl.pending(a.id) || undefined}
              onClick={() => void ctl.send(a.id)}
            >
              <a.Icon className="i i-sm" aria-hidden />
              {a.label}
            </button>
          ))}
        </div>
      )}
      {writable(device, "fan_power") && (
        <Row label="Potência" id={`${ids}-p`}>
          <Seg className="dx-seg" labelledBy={`${ids}-p`} options={opts(device, "fan_power")} value={ctl.value("fan_power")}
            onChange={(v) => void ctl.send("fan_power", v)} disabled={disabled} />
        </Row>
      )}
    </>
  );
}

/* ---------------- tomada: consumo ---------------- */

const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function PlugInline({ device, ctl }: InlineProps) {
  const on = ctl.value("power") === true;
  const watts = ctl.value("power_w");
  const since = num(device.state.on_since, 0);
  if (!has(device, "power_w") && !(on && since)) return null;
  return (
    <div className="dx-stats">
      {has(device, "power_w") && typeof watts === "number" && (
        <div className="dx-stat">
          <span className="dx-l">Consumo agora</span>
          <span className="dx-big">
            <Swap value={int.format(watts)} />
            <small>W</small>
          </span>
        </div>
      )}
      {on && since > 0 && device.state.power === true && (
        <div className="dx-stat">
          <span className="dx-l">Ligada desde</span>
          <span className="dx-big">{hhmm.format(since * 1000)}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- celular (sensor) ---------------- */

function PhoneInline({ device }: InlineProps) {
  const s = device.state;
  return (
    <div className="dx-stats">
      {typeof s.battery === "number" && (
        <div className="dx-stat">
          <span className="dx-l">
            Bateria
            {s.charging === true && <BatteryCharging className="i i-sm" aria-label="carregando" />}
          </span>
          <span className="dx-big">
            <Swap value={Math.round(s.battery)} />
            <small>%</small>
          </span>
        </div>
      )}
      {(s.at_home === true || typeof s.distance_km === "number") && (
        <div className="dx-stat">
          <span className="dx-l">
            <MapPin className="i i-sm" aria-hidden />
            Onde
          </span>
          <span className="dx-big dx-big-t">{s.at_home === true ? "Em casa" : `A ${dec.format(Number(s.distance_km))} km`}</span>
        </div>
      )}
    </div>
  );
}

/** Frase do card com o valor otimista e a cor da lâmpada RGB ("Ligada · 40% · roxo"). */
export function metaText(view: Device, raw: string): string {
  // "Frio · 22 °C (ambiente 26 °C)" → "Frio · 22 °C · ambiente 26 °C" (forma do mock no card).
  const base = raw.replace(/ \((ambiente [^)]+)\)$/, " · $1");
  if (view.kind !== "light" || view.state.power !== true || !has(view, "color")) return base;
  const id = matchSwatch(view.state.color);
  if (!id) return base;
  const name = PALETTE.find((c) => c.id === id)?.label.toLowerCase();
  const parts = base.split(" · ").filter((p) => !["quente", "fria", "neutra"].includes(p));
  return name ? [...parts, name].join(" · ") : base;
}

