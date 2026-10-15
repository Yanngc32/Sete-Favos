// Herói do Detalhe dentro do bloco mel (mock "Sete Favos", tela 2): número grande + linha de estado + o
// controle principal do tipo (intensidade da luz, alvo do ar, volume da TV). A arte (lâmpada pendurada ou o
// ícone do tipo com o halo de favos concêntricos) acende conforme o aparelho está ligado.
import { CircleAlert, Lightbulb, LampCeiling, Minus, Plus, Timer, VolumeX, WifiOff, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Swap } from "@/components/favos";
import { cap, groupCounts, has, isGroup, isOn, kindIcon, optionLabel, switchKeys, vacuumStatus } from "@/lib/devices";
import { dec, int } from "@/lib/format";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { colorName } from "./colors";
import { Ring, Slider, Step } from "./controls";
import { warmth, type Control } from "./useControl";
import { noWol } from "./bodies";

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const MARKS = [0, 25, 50, 75, 100];
const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/* ---------------- arte ---------------- */

/** Lâmpada pendurada (luz) ou ícone do tipo, com 4 favos concêntricos. `level` 0–1 acende o halo. */
export function HeroArt({ device, level }: { device: Device; level: number }) {
  const lamp = device.kind === "light" && !isGroup(device);
  const Icon: LucideIcon = lamp ? LampCeiling : kindIcon(device.kind);
  return (
    <div className={cn("dt-art", lamp ? "is-lamp" : "is-icon")} style={{ "--lvl": level } as CSSProperties}>
      {lamp && <span className="dt-cord" />}
      {[1, 2, 3, 4].map((n) => (
        <svg key={n} className={`dt-halo h${n}`} viewBox="0 0 100 100" focusable="false">
          <use href="#hx-shape" />
        </svg>
      ))}
      <Icon className="dt-bulb" aria-hidden />
    </div>
  );
}

/** Quanto o halo acende: luz pelo brilho, o resto ligado/desligado. */
export function heroLevel(device: Device, ctl: Control, on: boolean): number {
  if (!on) return 0;
  if (has(device, "brightness")) {
    const b = cap(device, "brightness");
    const v = num(ctl.value("brightness"), b?.max ?? 100);
    const min = b?.min ?? 1;
    const max = b?.max ?? 100;
    return 0.45 + 0.55 * ((v - min) / Math.max(1, max - min));
  }
  return 1;
}

/* ---------------- herói ---------------- */

interface HeroProps {
  device: Device;
  ctl: Control;
  disabled: boolean;
  /** Ligado (com o otimista do switch). */
  on: boolean;
  offline: boolean;
  /** "Sem resposta há 3 min" (troca a linha de estado). */
  offlineText: string | null;
  /** Linha do topo: cômodo + switch + timer. */
  lead: ReactNode;
}

export function Hero(p: HeroProps) {
  const { device } = p;
  const group = isGroup(device);
  let body: ReactNode;
  if (group) body = <GroupHero {...p} />;
  else if (device.kind === "light") body = <LightHero {...p} />;
  else if (device.kind === "ac") body = <AcHero {...p} />;
  else if (device.kind === "tv") body = <TvHero {...p} />;
  else if (device.kind === "vacuum") body = <VacuumHero {...p} />;
  else if (device.kind === "phone") body = <PhoneHero {...p} />;
  else if (device.kind === "switch" && switchKeys(device).length > 1) body = <SwitchHero {...p} />;
  else body = <PowerHero {...p} />;
  return (
    <div className={cn("dt-hero", p.disabled && "is-dis")}>
      <div className="dt-lead">{p.lead}</div>
      {body}
    </div>
  );
}

/** Linha de estado embaixo do número (vira o aviso de offline quando não responde). */
function Sub({ offlineText, children, live }: { offlineText: string | null; children: ReactNode; live?: boolean }) {
  if (offlineText)
    return (
      <p className="fv-s dt-sub dt-sub-off">
        <WifiOff className="i i-sm" aria-hidden />
        {offlineText}
      </p>
    );
  return (
    <p className="fv-s dt-sub" aria-live={live ? "polite" : undefined}>
      {children}
    </p>
  );
}

/** Número herói com crossfade (sem animar enquanto arrasta: o número segue o dedo). */
function Big({ value, unit, dim, dragging, sr }: { value: string | number; unit?: string; dim?: boolean; dragging?: boolean; sr?: string }) {
  return (
    <span className={cn("hero-num dt-num", dim && "is-dim")}>
      {sr && <span className="sr">{sr}</span>}
      <span aria-hidden={sr ? true : undefined}>
        {dragging ? value : <Swap value={value} />}
      </span>
      {unit && <small aria-hidden>{unit}</small>}
    </span>
  );
}

function Word({ children }: { children: ReactNode }) {
  return <span className="dt-word">{children}</span>;
}

/* luz: brilho + intensidade com marcas */
function LightHero({ device, ctl, disabled, on, offlineText }: HeroProps) {
  const bright = cap(device, "brightness");
  const [draft, setDraft] = useState<number | null>(null);
  const b = Math.round(draft ?? num(ctl.value("brightness"), bright?.min ?? 1));
  // Com cor da paleta escolhida (fita RGB), a linha diz a cor; senão, o tom do branco.
  const color = has(device, "color") ? ctl.value<string | undefined>("color") : undefined;
  const named = color ? colorName(color) : null;
  const tone = named
    ? named.toLowerCase()
    : has(device, "color_temp")
      ? `luz ${warmth(num(ctl.value("color_temp"), 50)).toLowerCase()}`
      : color
        ? "cor personalizada"
        : null;
  return (
    <>
      {bright ? <Big value={b} unit="%" dim={!on} dragging={draft != null} sr={`Brilho ${b} por cento`} /> : <Word>{on ? "Ligada" : "Desligada"}</Word>}
      <Sub offlineText={offlineText} live>
        {on ? [bright && "Brilho", tone].filter(Boolean).join(" · ") || "Ligada" : "Desligada"}
      </Sub>
      {bright && !bright.readonly && (
        <div className="dt-int">
          <div className="dt-int-l">
            <span id={`int-${device.id}`}>Intensidade</span>
            <span className="fv-s num" aria-hidden>
              {b}%
            </span>
          </div>
          <div className="dt-int-r">
            <Lightbulb className="i i-sm" aria-hidden />
            <Slider
              className="sl-mel"
              label={`Brilho de ${device.name}`}
              min={bright.min ?? 1}
              max={bright.max ?? 100}
              step={bright.step ?? 1}
              marks={MARKS}
              value={num(ctl.value("brightness"), bright.min ?? 1)}
              valueText={(v) => `${Math.round(v)} por cento`}
              onDraft={setDraft}
              onCommit={(v) => void ctl.send("brightness", v)}
              disabled={disabled}
            />
            <Lightbulb className="i i-lg" aria-hidden />
          </div>
        </div>
      )}
    </>
  );
}

/* ar: alvo + −/+ */
function AcHero({ device, ctl, disabled, on, offlineText }: HeroProps) {
  const target = cap(device, "target_temp");
  const min = target?.min ?? 16;
  const max = target?.max ?? 30;
  const step = target?.step ?? 1;
  const t = num(ctl.value("target_temp"), min);
  const decimals = step < 1 ? 1 : 0;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const ambient = device.state.current_temp;
  const mode = optionLabel(device, "ac_mode", ctl.value("ac_mode"));
  const go = (delta: number) => {
    const next = Math.round(Math.min(max, Math.max(min, t + delta)) / step) * step;
    if (next !== t) ctl.bump("target_temp", next);
  };
  const parts = [on ? (mode ?? "Ligado") : "Desligado", typeof ambient === "number" && `ambiente ${int.format(ambient)} °C`].filter(Boolean);
  return (
    <>
      {target ? <Big value={fmt(t)} unit="°C" dim={!on} sr={`Alvo ${fmt(t)} graus`} /> : <Word>{on ? "Ligado" : "Desligado"}</Word>}
      <Sub offlineText={offlineText} live>
        {parts.join(" · ")}
      </Sub>
      {target && !target.readonly && (
        <div className="dt-int dt-steps" role="group" aria-label="Temperatura alvo">
          <span className="dt-int-t">Temperatura</span>
          <Step label={`Diminuir para ${fmt(Math.max(min, t - step))} graus`} disabled={disabled || t <= min} onClick={() => go(-step)}>
            <Minus className="i" aria-hidden />
          </Step>
          <Step label={`Aumentar para ${fmt(Math.min(max, t + step))} graus`} disabled={disabled || t >= max} onClick={() => go(step)}>
            <Plus className="i" aria-hidden />
          </Step>
        </div>
      )}
    </>
  );
}

/* TV: volume (+ mudo) ou "Desligada" */
function TvHero({ device, ctl, disabled, on, offlineText }: HeroProps) {
  const volCap = cap(device, "volume");
  const vol = Math.round(num(ctl.value("volume"), 0));
  const muted = ctl.value("muted") === true;
  const source = ctl.value<string | undefined>("source");
  const vMin = volCap?.min ?? 0;
  const vMax = volCap?.max ?? 100;
  const vStep = volCap?.step ?? 1;
  const wol = noWol(device);
  if (!on)
    return (
      <>
        <Word>Desligada</Word>
        <Sub offlineText={offlineText}>{wol ? "Só pelo controle" : "Liga pela rede no botão acima"}</Sub>
      </>
    );
  return (
    <>
      {volCap ? <Big value={vol} unit="vol" dim={muted} sr={muted ? `Mudo, volume ${vol}` : `Volume ${vol}`} /> : <Word>Ligada</Word>}
      <Sub offlineText={offlineText} live>
        {[muted && "Mudo", source ? `${optionLabel(device, "source", source) ?? source} na tela` : !muted && "Ligada"].filter(Boolean).join(" · ")}
      </Sub>
      {volCap && !volCap.readonly && (
        <div className="dt-int dt-steps" role="group" aria-label="Volume">
          <span className="dt-int-t">Volume</span>
          {has(device, "muted") && (
            <Step label="Mudo" pressed={muted} disabled={disabled} onClick={() => void ctl.send("muted", !muted)}>
              <VolumeX className="i" aria-hidden />
            </Step>
          )}
          <Step label="Diminuir volume" disabled={disabled || vol <= vMin} onClick={() => ctl.bump("volume", Math.max(vMin, vol - vStep))}>
            <Minus className="i" aria-hidden />
          </Step>
          <Step label="Aumentar volume" disabled={disabled || vol >= vMax} onClick={() => ctl.bump("volume", Math.min(vMax, vol + vStep))}>
            <Plus className="i" aria-hidden />
          </Step>
        </div>
      )}
    </>
  );
}

/* tomada / outro: consumo em W ou Ligada/Desligada */
function PowerHero({ device, ctl, on, offlineText }: HeroProps) {
  const watts = ctl.value("power_w");
  const since = num(device.state.on_since, 0);
  const fem = device.kind === "plug" || device.kind === "light";
  const word = on ? (fem ? "Ligada" : "Ligado") : fem ? "Desligada" : "Desligado";
  return (
    <>
      {has(device, "power_w") && typeof watts === "number" ? <Big value={int.format(watts)} unit="W" dim={!on} sr={`Consumo ${int.format(watts)} watts`} /> : <Word>{word}</Word>}
      <Sub offlineText={offlineText} live>
        {on ? (since && device.state.power === true ? `${word} desde ${hhmm.format(since * 1000)}` : word) : word}
        {on && has(device, "power_w") && typeof watts === "number" && " · consumo agora"}
      </Sub>
    </>
  );
}

/* interruptor de várias teclas: "2 de 3" */
function SwitchHero({ device, ctl, offlineText }: HeroProps) {
  const keys = switchKeys(device);
  const n = keys.filter((k) => ctl.value(k.id) === true).length;
  return (
    <>
      <Big value={n} unit={`de ${keys.length}`} dim={n === 0} sr={`${n} de ${keys.length} teclas ligadas`} />
      <Sub offlineText={offlineText} live>
        {n === 1 ? "tecla ligada" : "teclas ligadas"}
      </Sub>
    </>
  );
}

/* grupo: "3 de 4" ligados */
function GroupHero({ device, offlineText }: HeroProps) {
  const { total, on, offline } = groupCounts(device);
  return (
    <>
      <Big value={on} unit={`de ${total}`} dim={on === 0} sr={`${on} de ${total} ligados`} />
      <Sub offlineText={offlineText} live>
        {on === 1 ? "ligado" : "ligados"}
        {offline > 0 && <b className="dt-sub-w"> · {offline} sem resposta</b>}
      </Sub>
    </>
  );
}

/* robô: anel de bateria + estado (erro em destaque) */
function VacuumHero({ device, offlineText }: HeroProps) {
  const battery = typeof device.state.battery === "number" ? Math.round(device.state.battery) : null;
  const status = String(device.state.vacuum_status ?? "");
  const error = status === "error" ? String(device.state.vacuum_error || "Erro sem descrição") : null;
  return (
    <div className="dt-ring-row">
      {battery !== null && (
        <Ring pct={battery} size={104} label={`Bateria ${battery} por cento`}>
          <Swap value={battery}>{battery}%</Swap>
          <small>bateria</small>
        </Ring>
      )}
      <div className="dt-ring-tx">
        <Word>{vacuumStatus(device)}</Word>
        {error && !offlineText ? (
          <p className="dt-sub dt-sub-err" role="alert">
            <CircleAlert className="i i-sm" aria-hidden />
            {error}
          </p>
        ) : (
          <Sub offlineText={offlineText} live>
            {isOn(device) ? "Limpando agora" : battery === 100 ? "Bateria cheia" : "Pronto pra limpar"}
          </Sub>
        )}
      </div>
    </div>
  );
}

/* celular-sensor: bateria + carregando + em casa/distância */
function PhoneHero({ device, offlineText }: HeroProps) {
  const s = device.state;
  const battery = typeof s.battery === "number" ? Math.round(s.battery) : null;
  const where =
    s.at_home === true ? "em casa" : typeof s.distance_km === "number" ? `a ${dec.format(s.distance_km)} km de casa` : typeof s.lat === "number" ? "fora de casa" : null;
  return (
    <div className="dt-ring-row">
      <Ring pct={battery ?? 0} size={104} label={battery === null ? "Bateria desconhecida" : `Bateria ${battery} por cento`}>
        {battery === null ? "–" : <Swap value={battery}>{battery}%</Swap>}
        <small>bateria</small>
      </Ring>
      <div className="dt-ring-tx">
        <Word>{s.charging === true ? "Carregando" : "Na bateria"}</Word>
        <Sub offlineText={offlineText} live>
          {where ? where.charAt(0).toUpperCase() + where.slice(1) : "Sem localização"}
        </Sub>
      </div>
    </div>
  );
}

/* ---------------- linha do topo ---------------- */

/** "desliga em 23 min" / "desliga em 1 h 05" a partir do off_at (epoch s). */
export function timerText(offAt: number, now: number): string {
  const left = Math.max(0, Math.round((offAt * 1000 - now) / 60000));
  if (left < 60) return `desliga em ${left} min`;
  return `desliga em ${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")}`;
}

export function TimerChip({ offAt, now, onClick }: { offAt: number; now: number; onClick: () => void }) {
  return (
    <button type="button" className="dt-chip" onClick={onClick} aria-label={`Timer: ${timerText(offAt, now)}. Mudar ou cancelar`}>
      <Timer className="i i-sm" aria-hidden />
      <span className="num">{timerText(offAt, now)}</span>
    </button>
  );
}
