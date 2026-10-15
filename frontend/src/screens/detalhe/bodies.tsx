// Corpo do Detalhe por tipo de aparelho. Cada controle só aparece se o aparelho tiver a capacidade.
import {
  AppWindow,
  Calendar,
  Check,
  CircleAlert,
  Droplets,
  Fan,
  Flame,
  HdmiPort,
  House,
  Minus,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCcw,
  Snowflake,
  Thermometer,
  Tv,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { cap, has, isOn, optionLabel, vacuumStatus } from "@/lib/devices";
import { int, whenShort } from "@/lib/format";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { matchSwatch, PALETTE, paletteHex, swatchVar } from "./colors";
import { Opts, Ring, Seg, Slider, Step, type SegOption } from "./controls";
import { Remote } from "./Remote";
import { warmth, type Control } from "./useControl";

export interface BodyProps {
  device: Device;
  ctl: Control;
  disabled: boolean;
  /**
   * O herói do bloco mel (Detalhe) já mostra o controle principal: o corpo não repete brilho, alvo do ar,
   * volume/estado da TV, botão grande da tomada nem o anel do robô. Fora do Detalhe, deixe sem.
   */
  inHero?: boolean;
}

const options = (device: Device, id: string, icons?: Record<string, LucideIcon>): SegOption[] =>
  (cap(device, id)?.options ?? []).map((o) => ({ ...o, Icon: icons?.[o.value] }));

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/* ---------------- luz / fita LED ---------------- */

export function LightBody({ device, ctl, disabled, inHero }: BodyProps) {
  const ids = useId();
  const bright = cap(device, "brightness");
  const temp = cap(device, "color_temp");
  const color = cap(device, "color");
  return (
    <>
      {bright && !bright.readonly && !inHero && (
        <div className="ctl">
          <span className="lbl" id={`${ids}-b`}>Brilho</span>
          <Slider
            className="sl-b"
            label="Brilho"
            min={bright.min ?? 1}
            max={bright.max ?? 100}
            step={bright.step ?? 1}
            value={num(ctl.value("brightness"), bright.min ?? 1)}
            valueText={(v) => `${Math.round(v)} por cento`}
            bubble={(v) => `${Math.round(v)}%`}
            onCommit={(v) => void ctl.send("brightness", v)}
            disabled={disabled}
          />
        </div>
      )}
      {temp && !temp.readonly && (
        <div className="ctl">
          <div className="ctl-h">
            <span className="lbl">Temperatura de cor</span>
            <span className="ctl-v">{warmth(num(ctl.value("color_temp"), 50))}</span>
          </div>
          <Slider
            className="kel"
            fill={false}
            label="Temperatura de cor"
            min={temp.min ?? 0}
            max={temp.max ?? 100}
            step={temp.step ?? 1}
            value={num(ctl.value("color_temp"), 50)}
            valueText={(v) => warmth(v).toLowerCase()}
            onCommit={(v) => void ctl.send("color_temp", v)}
            disabled={disabled}
          />
          <div className="kel-l" aria-hidden>
            <span>Quente</span>
            <span>Frio</span>
          </div>
        </div>
      )}
      {color && !color.readonly && <ColorPicker ctl={ctl} disabled={disabled} />}
    </>
  );
}

function ColorPicker({ ctl, disabled }: { ctl: Control; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const value = ctl.value<string | undefined>("color");
  const selected = matchSwatch(value);
  const name = selected ? PALETTE.find((c) => c.id === selected)?.label : value ? "Personalizada" : "—";

  // O seletor nativo dispara "input" a cada arrasto; o comando só vai no "change" (quando fecha).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => void ctl.send("color", el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [ctl]);

  return (
    <div className="ctl">
      <div className="ctl-h">
        <span className="lbl">Cor</span>
        <span className="ctl-v">{name}</span>
      </div>
      <div className="cores" role="group" aria-label="Cor">
        {PALETTE.map((c) => (
          <button
            key={c.id}
            type="button"
            className="cor"
            style={{ background: swatchVar(c.id) }}
            aria-label={c.label}
            aria-pressed={selected === c.id}
            disabled={disabled}
            onClick={() => {
              const hex = paletteHex().get(c.id);
              if (hex) void ctl.send("color", hex);
            }}
          >
            {selected === c.id && <Check className="i" aria-hidden />}
          </button>
        ))}
        <button
          type="button"
          className="cor add"
          aria-label="Personalizar cor"
          disabled={disabled}
          onClick={() => {
            const el = input.current;
            if (!el) return;
            if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) el.value = value;
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          }}
        >
          <Plus className="i" aria-hidden />
        </button>
        <input ref={input} type="color" className="sr" tabIndex={-1} aria-hidden />
      </div>
    </div>
  );
}

/* ---------------- tomada / interruptor ---------------- */

const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function PowerBody({ device, ctl, disabled, inHero }: BodyProps) {
  if (inHero) return null;
  const on = ctl.value("power") === true;
  const since = num(device.state.on_since, 0);
  const watts = ctl.value("power_w");
  return (
    <>
      <div className="pw">
        <button
          type="button"
          className="pw-b"
          aria-pressed={on}
          aria-label={`${on ? "Desligar" : "Ligar"} ${device.name}`}
          aria-busy={ctl.pending("power") || undefined}
          disabled={disabled}
          onClick={() => void ctl.send("power", !on)}
        >
          <Power className="i" aria-hidden />
        </button>
        <p className="pw-s" aria-live="polite">
          {on ? (since && device.state.power === true ? `Ligado desde ${hhmm.format(since * 1000)}` : "Ligado") : "Desligado"}
        </p>
      </div>
      {has(device, "power_w") && typeof watts === "number" && (
        <div className="stat">
          <span className="lbl">Agora</span>
          <span className="disp">
            {int.format(watts)}
            <small>W</small>
          </span>
        </div>
      )}
    </>
  );
}

/* ---------------- ar-condicionado ---------------- */

const MODE_ICONS: Record<string, LucideIcon> = { cool: Snowflake, heat: Flame, fan: Fan, dry: Droplets, auto: RefreshCcw };

export function AcBody({ device, ctl, disabled, inHero }: BodyProps) {
  const ids = useId();
  const target = cap(device, "target_temp");
  const min = target?.min ?? 16;
  const max = target?.max ?? 30;
  const step = target?.step ?? 1;
  const t = num(ctl.value("target_temp"), min);
  const decimals = step < 1 ? 1 : 0;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const ambient = device.state.current_temp;
  const go = (delta: number) => {
    const next = Math.round(Math.min(max, Math.max(min, t + delta)) / step) * step;
    if (next !== t) ctl.bump("target_temp", next);
  };
  return (
    <>
      {target && !target.readonly && !inHero && (
        <div className="ar" role="group" aria-label="Temperatura alvo">
          <Step label={`Diminuir para ${fmt(Math.max(min, t - step))} graus`} disabled={disabled || t <= min} onClick={() => go(-step)}>
            <Minus className="i i-lg" aria-hidden />
          </Step>
          <div className="ar-c">
            <span className="hero-num" aria-live="polite">
              <span className="sr">Alvo </span>
              {fmt(t)}
              <small>°C</small>
            </span>
            {typeof ambient === "number" && (
              <span className="amb">
                <Thermometer className="i i-sm" aria-hidden />
                Ambiente {int.format(ambient)} °C
              </span>
            )}
          </div>
          <Step label={`Aumentar para ${fmt(Math.min(max, t + step))} graus`} disabled={disabled || t >= max} onClick={() => go(step)}>
            <Plus className="i i-lg" aria-hidden />
          </Step>
        </div>
      )}
      {has(device, "ac_mode") && (
        <div className="ctl">
          <span className="lbl" id={`${ids}-m`}>Modo</span>
          <Seg
            className="seg-st"
            labelledBy={`${ids}-m`}
            options={options(device, "ac_mode", MODE_ICONS)}
            value={ctl.value("ac_mode")}
            onChange={(v) => void ctl.send("ac_mode", v)}
            disabled={disabled}
          />
        </div>
      )}
      {has(device, "fan_speed") && (
        <div className="ctl">
          <span className="lbl" id={`${ids}-v`}>Ventilação</span>
          <Seg
            labelledBy={`${ids}-v`}
            options={options(device, "fan_speed")}
            value={ctl.value("fan_speed")}
            onChange={(v) => void ctl.send("fan_speed", v)}
            disabled={disabled}
          />
        </div>
      )}
    </>
  );
}

/* ---------------- TV ---------------- */

const sourceIcon = (value: string): LucideIcon =>
  /hdmi/i.test(value) ? HdmiPort : value.toLowerCase() === "tv" ? Tv : AppWindow;

export function TvBody({ device, ctl, disabled, inHero }: BodyProps) {
  const ids = useId();
  const on = ctl.value("power") === true;
  const source = ctl.value<string | undefined>("source");
  const volCap = cap(device, "volume");
  const vol = num(ctl.value("volume"), 0);
  const muted = ctl.value("muted") === true;
  const vMin = volCap?.min ?? 0;
  const vMax = volCap?.max ?? 100;
  const vStep = volCap?.step ?? 1;

  // Desligada: sem volume nem entradas (a TV não responde). Se der pra ligar pela rede, o botão grande liga.
  if (!on) {
    if (noWol(device) || inHero) return null;
    return (
      <div className="pw">
        <button
          type="button"
          className="pw-b"
          aria-pressed={false}
          aria-label={`Ligar ${device.name}`}
          disabled={disabled}
          onClick={() => void ctl.send("power", true)}
        >
          <Power className="i" aria-hidden />
        </button>
        <p className="pw-s">Desligada</p>
      </div>
    );
  }

  const srcOpts = (cap(device, "source")?.options ?? []).map((o) => ({ ...o, Icon: sourceIcon(o.value) }));
  const SrcIcon = source ? sourceIcon(source) : AppWindow;
  return (
    <>
      {source && !disabled && !inHero && (
        <div className="np">
          <span className="tile">
            <SrcIcon className="i" aria-hidden />
          </span>
          <div className="np-tx">
            <b>{optionLabel(device, "source", source)}</b>
            <small>Na tela agora</small>
          </div>
        </div>
      )}
      {volCap && !volCap.readonly && !inHero && (
        <div className="ctl">
          <div className="ctl-h">
            <span className="lbl">Volume</span>
          </div>
          <div className="vol" role="group" aria-label="Volume">
            {has(device, "muted") ? (
              <Step label="Mudo" pressed={muted} disabled={disabled} onClick={() => void ctl.send("muted", !muted)}>
                <VolumeX className="i" aria-hidden />
              </Step>
            ) : (
              <span className="stp-sp" aria-hidden />
            )}
            <Step label="Diminuir volume" disabled={disabled || vol <= vMin} onClick={() => ctl.bump("volume", Math.max(vMin, vol - vStep))}>
              <Minus className="i i-lg" aria-hidden />
            </Step>
            <span className={cn("disp", muted && "is-muted")} aria-live="polite">
              <span className="sr">{muted ? "Mudo, volume " : "Volume "}</span>
              {Math.round(vol)}
            </span>
            <Step label="Aumentar volume" disabled={disabled || vol >= vMax} onClick={() => ctl.bump("volume", Math.min(vMax, vol + vStep))}>
              <Plus className="i i-lg" aria-hidden />
            </Step>
          </div>
        </div>
      )}
      {device.remote && <Remote device={device} disabled={disabled} />}
      {srcOpts.length > 0 && (
        <div className="ctl">
          <span className="lbl" id={`${ids}-e`}>Entrada</span>
          <Opts labelledBy={`${ids}-e`} options={srcOpts} value={source} onChange={(v) => void ctl.send("source", v)} disabled={disabled} />
        </div>
      )}
    </>
  );
}

/** A central avisa nas notas quando a TV não tem Wake-on-LAN ("Esta TV só liga pelo controle."). */
export function noWol(device: Device): string | null {
  if (device.kind !== "tv") return null;
  return device.notes.find((n) => /só liga pelo controle/i.test(n)) ?? null;
}

/* ---------------- robô aspirador ---------------- */

export function VacuumBody({ device, ctl, disabled, inHero }: BodyProps) {
  const ids = useId();
  const status = String(device.state.vacuum_status ?? "");
  const battery = num(device.state.battery, 0);
  const error = status === "error" ? String(device.state.vacuum_error || "Erro sem descrição") : null;
  const active = isOn(device);
  const can = (a: string) => has(device, a);
  const cleaning = status === "cleaning";
  const atBase = status === "docked" || status === "charging" || status === "returning";
  const lastClean = formatLastClean(device.state.last_clean);

  const act = (a: string) => void ctl.send(a);
  const actions = [
    can("start") && { id: "start", label: "Iniciar", Icon: Play, primary: !cleaning, off: cleaning },
    can("pause") && { id: "pause", label: "Pausar", Icon: Pause, primary: cleaning, off: !cleaning && status !== "returning" },
    can("dock") && { id: "dock", label: "Voltar à base", Icon: House, primary: false, off: atBase },
  ].filter(Boolean) as { id: string; label: string; Icon: LucideIcon; primary: boolean; off: boolean }[];

  return (
    <>
      {inHero ? null : error ? (
        <div className="rb rb-err">
          <Ring pct={battery} size={88} label={`Bateria ${Math.round(battery)} por cento`}>
            {Math.round(battery)}%
          </Ring>
          <div>
            <p className="rb-st">{vacuumStatus(device)}</p>
            <p className="err-l" role="alert">
              <CircleAlert className="i i-sm" aria-hidden />
              {error}
            </p>
          </div>
        </div>
      ) : (
        <div className={cn("rb", active && "on")}>
          {typeof device.state.battery === "number" && (
            <Ring pct={battery} label={`Bateria ${Math.round(battery)} por cento`}>
              {Math.round(battery)}%<small>bateria</small>
            </Ring>
          )}
          <p className="rb-st" aria-live="polite">
            {vacuumStatus(device)}
          </p>
        </div>
      )}
      {actions.length > 0 && (
        <div className="rb-acts">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={cn("btn", !a.primary && "btn-sec")}
              disabled={disabled || a.off}
              aria-busy={ctl.pending(a.id) || undefined}
              onClick={() => act(a.id)}
            >
              <a.Icon className="i" aria-hidden />
              {a.label}
            </button>
          ))}
        </div>
      )}
      {has(device, "fan_power") && (
        <div className="ctl">
          <span className="lbl" id={`${ids}-p`}>Potência</span>
          <Seg
            labelledBy={`${ids}-p`}
            options={options(device, "fan_power")}
            value={ctl.value("fan_power")}
            onChange={(v) => void ctl.send("fan_power", v)}
            disabled={disabled}
          />
        </div>
      )}
      {lastClean && (
        <div className="ctl">
          <span className="lbl">Última limpeza</span>
          <p className="last">
            <Calendar className="i i-sm" aria-hidden />
            {lastClean}
          </p>
        </div>
      )}
    </>
  );
}

/** "Hoje 10:12 · 48 min · 62 m²" (só se o aparelho informar). Aceita texto pronto ou {at, minutes, area}. */
function formatLastClean(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const at = num(o.at ?? o.start ?? o.end, 0);
  const minutes = num(o.minutes ?? o.duration_min ?? o.duration, -1);
  const area = num(o.area ?? o.area_m2, -1);
  const parts: string[] = [];
  if (at > 0) {
    const w = whenShort(at);
    parts.push(w.charAt(0).toUpperCase() + w.slice(1));
  }
  if (minutes >= 0) parts.push(`${int.format(minutes)} min`);
  if (area >= 0) parts.push(`${int.format(area)} m²`);
  return parts.length ? parts.join(" · ") : null;
}
