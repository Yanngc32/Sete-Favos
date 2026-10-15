// Card de aparelho da Início: switch otimista, nível arrastável (estilo Google Home),
// menu de clique direito / toque longo / ⋯, estados offline e "colmeia fora".
// Interruptor: placa com uma tecla por coluna. TV: botão de energia, mudo e volume no arraste.
// Tamanho por card (pequeno = pílula, médio = o de sempre, grande = número herói + controles) e o que ele mostra
// vêm de lib/cardLook (salvo na colmeia; o card do painel pode sobrescrever).
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  House,
  Layers,
  MapPin,
  Maximize2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  RectangleHorizontal,
  SlidersHorizontal,
  Square,
  Star,
  StarOff,
  Timer,
  TriangleAlert,
  Volume2,
  VolumeX,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Loader } from "@/components/Logo";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { cardSpan, resolveLook, SIZE_LABEL, SIZES, prefsFromLook, type Look } from "@/lib/cardLook";
import { setCardPrefs, useCardDevice } from "@/lib/cardPrefsStore";
import { cap, isOffline, isOn, kindIcon, levelOf, levelPct, optionLabel, switchKeys, vacuumStatus, type Level } from "@/lib/devices";
import { ago, dec, int } from "@/lib/format";
import type { CardShow, CardSize, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "@/components/toast";
import { HexTile, Swap } from "@/components/favos";
import { toastPartial } from "@/components/partialToast";
import { openGroupDialog } from "@/screens/grupos/groupDialog";

const TIMEOUT = 5000;
const DRAG_SLOP = 8;

/** Ícone de cada tamanho (menu e personalização). */
export const SIZE_ICON: Record<CardSize, LucideIcon> = { s: RectangleHorizontal, m: Square, l: Maximize2 };

export type CardMenuAction = "rename" | "move" | "timer" | "customize";

interface Props {
  device: Device;
  /** Central fora: controles desabilitados, último valor + "há X min". */
  stale: string | null;
  compact: boolean;
  /** Avisa a tela que a mudança é deste aparelho (para não anunciar como "veio de fora"). */
  onLocal: (id: string) => void;
  onMenu: (device: Device, action: CardMenuAction) => void;
  now: number;
  /** Card do painel com tamanho/o que mostrar próprios (sobrescreve o padrão do aparelho). */
  override?: { size?: CardSize | null; show?: CardShow | null } | null;
  /** Prévia da personalização: aparência pronta (rascunho), sem menu nem comandos. */
  preview?: Look;
}

/** keys: capacidades bool pendentes além do power (teclas do interruptor switch_1..., mudo da TV). */
type Pending = { power?: boolean; level?: number; keys?: Record<string, boolean> };
type Op = [capability: string, value?: unknown];

/** "desliga em 23 min" / "desliga em 1 h 05" a partir do off_at (epoch s). */
function timerText(offAt: number, now: number): string {
  const min = Math.max(1, Math.ceil((offAt * 1000 - now) / 60000));
  return min < 60 ? `desliga em ${min} min` : `desliga em ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function TimerChip({ offAt, now }: { offAt: number; now: number }) {
  return (
    <span className="chip">
      <Timer className="i i-sm" aria-hidden />
      {timerText(offAt, now)}
    </span>
  );
}

/** Nome do nível para o leitor: "Brilho da Luz da sala", "Temperatura do Ar do quarto". */
function levelLabel(d: Device, level: Level) {
  const what = level.capability === "brightness" ? "Brilho" : level.capability === "volume" ? "Volume" : "Temperatura";
  const fem = d.kind === "light" || d.kind === "tv" || d.kind === "plug";
  return `${what} ${fem ? "da" : "do"} ${d.name}`;
}

/** Número grande do arraste: "85" + "%", "23" + "°C", "18" + "vol". */
function LevelNum({ level, value, className }: { level: Level; value: number; className: string }) {
  const unit = level.capability === "brightness" ? "%" : level.capability === "volume" ? "vol" : "°C";
  return (
    <span className={className} aria-hidden>
      {int.format(value)}
      <small>{unit}</small>
    </span>
  );
}

/** Troca de texto que chega de fora: remonta com uma classe de crossfade (não anima na 1ª pintura). */
function useFlash(value: string) {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setN((x) => x + 1);
    }
  }, [value]);
  return n;
}

/** Grupo: "3 aparelhos · 2 ligados" no lugar do cômodo. */
export function groupLine(d: Device): string {
  const total = Number(d.state.group_total ?? d.members?.length ?? 0);
  const on = Number(d.state.group_on ?? 0);
  const n = `${total} ${total === 1 ? "aparelho" : "aparelhos"}`;
  return `${n} · ${on === 0 ? "nenhum ligado" : `${on} ${on === 1 ? "ligado" : "ligados"}`}`;
}

function OfflineTip({ id, group }: { id: string; group?: boolean }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tipId = `tip-${id}`;
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="tipb"
      aria-label="Por que está sem resposta"
      aria-describedby={tipId}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), 800);
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current);
        setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <TriangleAlert className="i" aria-hidden />
      <span className={cn("tipbox", !open && "ini-tip-hide")} role="tooltip" id={tipId}>
        {group ? "Nenhum aparelho do grupo responde" : "Verifique se está ligado na tomada e no Wi-Fi"}
      </span>
    </button>
  );
}

/** Itens do menu do card (o mesmo no clique direito / toque longo e no ⋯). */
function CardMenuItems({
  device,
  look,
  sizeLocked,
  onMenu,
  now,
}: {
  device: Device;
  look: Look;
  /** O card do painel tem tamanho próprio: o tamanho se troca na engrenagem do modo editar. */
  sizeLocked: boolean;
  onMenu: (device: Device, action: CardMenuAction) => void;
  now: number;
}) {
  const name = device.name;
  const isGroup = device.vendor === "grupo";
  return (
    <>
      <Menu.Item
        nativeButton
        render={<button type="button" />}
        onClick={() => {
          const pinned = !device.pinned;
          api.devices
            .update(device.id, { pinned })
            .then(() => toast({ tone: "ok", message: pinned ? `${name} fixado no topo` : `${name} saiu do topo` }))
            .catch((err: Error) => toast({ tone: "error", message: err.message }));
        }}
      >
        {device.pinned ? <StarOff className="i" aria-hidden /> : <Star className="i" aria-hidden />}
        {device.pinned ? "Tirar do topo" : "Fixar no topo"}
      </Menu.Item>
      <Menu.Item nativeButton render={<button type="button" />} onClick={() => onMenu(device, "rename")}>
        <Pencil className="i" aria-hidden />
        Renomear
      </Menu.Item>
      <Menu.Item nativeButton render={<button type="button" />} onClick={() => onMenu(device, "move")}>
        <MapPin className="i" aria-hidden />
        Mudar de cômodo
      </Menu.Item>
      {device.state.power === true && device.capabilities.some((c) => c.id === "power" && !c.readonly) && (
        <Menu.Item nativeButton render={<button type="button" />} onClick={() => onMenu(device, "timer")}>
          <Timer className="i" aria-hidden />
          {device.off_at ? `Timer: ${timerText(device.off_at, now)}` : "Desligar em…"}
        </Menu.Item>
      )}
      <Menu.Item
        nativeButton
        render={<button type="button" />}
        onClick={() => openGroupDialog(isGroup ? { edit: device.id } : { preselect: [device.id] })}
      >
        <Layers className="i" aria-hidden />
        {isGroup ? "Editar grupo" : "Agrupar com outros…"}
      </Menu.Item>
      <Menu.Separator render={<hr />} />
      {!sizeLocked && (
        <Menu.Group className="ini-mg">
          <Menu.GroupLabel className="ini-mg-l">Tamanho do card</Menu.GroupLabel>
          <Menu.RadioGroup
            className="ini-msz"
            value={look.size}
            onValueChange={(v: CardSize) => setCardPrefs(device, prefsFromLook({ ...look, size: v }, device))}
          >
            {SIZES.map((s) => {
              const SizeIcon = SIZE_ICON[s];
              return (
              <Menu.RadioItem key={s} value={s} closeOnClick={false} className="ini-msz-o" label={SIZE_LABEL[s]}>
                <SizeIcon className="i" aria-hidden />
                {SIZE_LABEL[s]}
                <Menu.RadioItemIndicator className="ini-msz-ck" keepMounted>
                  <Check className="i i-sm" aria-hidden />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
              );
            })}
          </Menu.RadioGroup>
        </Menu.Group>
      )}
      <Menu.Item nativeButton render={<button type="button" />} onClick={() => onMenu(device, "customize")}>
        <SlidersHorizontal className="i" aria-hidden />
        Personalizar card…
      </Menu.Item>
    </>
  );
}

function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="ibtn dev-more" aria-label={`Opções de ${label}`}>
        <Ellipsis className="i" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal className="mk">
        <Menu.Positioner className="ini-menu-pos" side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu ini-menu" aria-label={label}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Botões −/+ (ar: temperatura, luz: brilho, TV: volume). */
function Nudge({ label, unit, disabled, onStep }: { label: string; unit: string; disabled: boolean; onStep: (dir: -1 | 1) => void }) {
  return (
    <span className="dev-nudge" role="group" aria-label={label}>
      <button type="button" className="ibtn bd" aria-label={`Diminuir ${unit}`} disabled={disabled} onClick={() => onStep(-1)}>
        <Minus className="i" aria-hidden />
      </button>
      <button type="button" className="ibtn bd" aria-label={`Aumentar ${unit}`} disabled={disabled} onClick={() => onStep(1)}>
        <Plus className="i" aria-hidden />
      </button>
    </span>
  );
}

/** Paleta rápida da luz: temperatura (0 quente – 100 fria) e cores, todas dos tokens --color-luz-*. */
const TEMPS = [
  { label: "quente", value: 0 },
  { label: "neutra", value: 50 },
  { label: "fria", value: 100 },
] as const;
const HUES = [
  { token: "--color-luz-vermelho", label: "vermelha" },
  { token: "--color-luz-laranja", label: "laranja" },
  { token: "--color-luz-verde", label: "verde" },
  { token: "--color-luz-azul", label: "azul" },
  { token: "--color-luz-roxo", label: "roxa" },
  { token: "--color-luz-rosa", label: "rosa" },
] as const;

/** Cor de um token (oklch) em #rrggbb, que é o que o comando `color` aceita. */
function tokenHex(token: string): string | null {
  const color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!color || !ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Controle da TV no card grande: voltar, setas e OK (o completo fica no Detalhe). */
function MiniRemote({ device, disabled }: { device: Device; disabled: boolean }) {
  const keys = new Set(device.remote ?? []);
  const press = (key: string) => {
    if (disabled || !keys.has(key)) return;
    api.devices.remote(device.id, key).catch((e: unknown) =>
      toast({ id: `remote-${device.id}`, tone: "error", message: e instanceof Error ? e.message : "A TV não respondeu" }),
    );
  };
  const b = (key: string, label: string, Glyph: LucideIcon) =>
    keys.has(key) && (
      <button key={key} type="button" className="ibtn bd" aria-label={label} disabled={disabled} onClick={() => press(key)}>
        <Glyph className="i" aria-hidden />
      </button>
    );
  return (
    <div className="dev-rc" role="group" aria-label={`Controle de ${device.name}`}>
      {b("BACK", "Voltar", ArrowLeft)}
      <span className="dev-rc-pad">
        {b("LEFT", "Esquerda", ChevronLeft)}
        {b("UP", "Cima", ChevronUp)}
        {keys.has("ENTER") && (
          <button type="button" className="ibtn bd dev-rc-ok" disabled={disabled} onClick={() => press("ENTER")}>
            OK
          </button>
        )}
        {b("DOWN", "Baixo", ChevronDown)}
        {b("RIGHT", "Direita", ChevronRight)}
      </span>
    </div>
  );
}

export function DeviceCard({ device, stale, compact, onLocal, onMenu, now, override, preview }: Props) {
  const cardDevice = useCardDevice(device);
  const look = preview ?? resolveLook(cardDevice, override);
  const [pend, setPend] = useState<Pending | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const inflight = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; w: number; start: number; active: boolean } | null>(null);
  const dragValue = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const offline = isOffline(device);
  const blocked = stale !== null || offline;
  const baseLevel = levelOf(device);
  // Interruptor de várias teclas: o card vira uma tecla por coluna (grupo nunca).
  const keys = device.kind === "switch" && device.vendor !== "grupo" ? switchKeys(device) : [];

  // Estado mostrado = estado real + o que está pendente (otimista) + o arraste em curso.
  const shown: Device =
    pend && (pend.power !== undefined || pend.level !== undefined || pend.keys)
      ? {
          ...device,
          state: {
            ...device.state,
            ...(pend.power !== undefined ? { power: pend.power } : {}),
            ...(pend.level !== undefined && baseLevel ? { [baseLevel.capability]: pend.level } : {}),
            ...pend.keys,
            ...(pend.keys && keys.length
              ? { power: keys.some((k) => ({ ...device.state, ...pend.keys })[k.id] === true) }
              : {}),
          },
        }
      : device;
  const level = levelOf(shown);
  const dragging = drag !== null;
  const on = dragging || isOn(shown);
  const levelValue = dragging ? drag : (level?.value ?? 0);
  const pct = level ? Math.max(0, Math.min(100, levelPct(level, levelValue))) : 0;
  const draggable = Boolean(level) && !blocked;

  // Confirmação: quando o estado real alcança o pendente, solta o otimista.
  useEffect(() => {
    if (!pend || inflight.current) return;
    const s = device.state;
    const okPower = pend.power === undefined || s.power === pend.power;
    const okLevel = pend.level === undefined || !baseLevel || s[baseLevel.capability] === pend.level;
    const okKeys = !pend.keys || Object.entries(pend.keys).every(([k, v]) => s[k] === v);
    if (okPower && okLevel && okKeys) setPend(null);
  }, [device, pend, baseLevel]);

  useEffect(() => () => clearTimeout(keyTimer.current), []);

  async function run(ops: Op[], optimistic: Pending | null, verb: string) {
    const token = ++seq.current;
    onLocal(device.id);
    if (optimistic) setPend(optimistic);
    else setBusy(true);
    inflight.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
    });
    timeout.catch(() => {});
    try {
      for (const [capability, value] of ops) {
        const res = await Promise.race([api.devices.command(device.id, capability, value), timeout]);
        toastPartial(res);
      }
      if (token !== seq.current) return;
      inflight.current = false;
      // A central pode arredondar o valor: não segura o otimista para sempre.
      setTimeout(() => {
        if (token === seq.current) setPend(null);
      }, 1500);
    } catch {
      if (token !== seq.current) return;
      inflight.current = false;
      setPend(null);
      toast({
        id: `dev-${device.id}`,
        tone: "error",
        message: `Não consegui ${verb} ${device.name}`,
        action: { label: "Tentar de novo", onClick: () => void run(ops, optimistic, verb) },
        duration: 8000,
      });
    } finally {
      clearTimeout(timer);
      if (token === seq.current) setBusy(false);
    }
  }

  function toggle() {
    const next = !isOn(shown);
    void run([["power", next]], { power: next }, next ? "ligar" : "desligar");
  }

  /** Interruptor: todas as teclas de uma vez ("power" vale para todas). */
  function toggleAll() {
    const next = !isOn(shown);
    const all = Object.fromEntries(keys.map((k) => [k.id, next]));
    void run([["power", next]], { power: next, keys: all }, next ? "ligar" : "desligar");
  }

  function toggleMute() {
    const next = shown.state.muted !== true;
    void run([["muted", next]], { keys: { muted: next } }, next ? "silenciar" : "tirar o mudo de");
  }

  function toggleKey(id: string, label: string) {
    const next = shown.state[id] !== true;
    void run([[id, next]], { keys: { ...pend?.keys, [id]: next } }, `${next ? "ligar" : "desligar"} ${label} de`);
  }

  function commitLevel(value: number) {
    if (!baseLevel) return;
    const wasOn = isOn(device);
    const ops: Op[] = wasOn ? [] : [["power", true]];
    ops.push([baseLevel.capability, value]);
    void run(ops, { power: true, level: value }, wasOn ? "ajustar" : "ligar");
  }

  function valueAt(p: number): number {
    const l = baseLevel!;
    const raw = l.min + (p / 100) * (l.max - l.min);
    const stepped = Math.round(raw / l.step) * l.step;
    return Math.max(l.min, Math.min(l.max, Number(stepped.toFixed(2))));
  }

  // Arraste: >8px na horizontal vira ajuste de nível; vertical é rolagem (touch-action: pan-y).
  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (!draggable || !level || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as Element).closest(".sw, .btn, .ibtn, .tipb, .pwb, .dev-mute, .dev-more")) return;
    const r = e.currentTarget.getBoundingClientRect();
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      w: r.width,
      start: isOn(shown) ? levelPct(level) : 0,
      active: false,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dy) > DRAG_SLOP && Math.abs(dy) >= Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) <= DRAG_SLOP) return;
      g.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const v = valueAt(g.start + (dx / g.w) * 100);
    dragValue.current = v;
    setDrag(v);
  }

  function endGesture(e: PointerEvent<HTMLElement>, commit: boolean) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.active) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    const v = dragValue.current;
    dragValue.current = null;
    setDrag(null);
    if (commit && v !== null) commitLevel(v);
  }

  function onSliderKey(e: KeyboardEvent<HTMLSpanElement>) {
    if (!draggable || !level || !baseLevel) return;
    // Ar: ±1 °C (Shift ±2); luz e TV: ±5 (Shift ±10).
    const unit = baseLevel.capability === "target_temp" ? baseLevel.step : 5;
    const big = baseLevel.capability === "target_temp" ? baseLevel.step * 2 : 10;
    const d = e.shiftKey ? big : unit;
    const cur = isOn(shown) ? level.value : baseLevel.min;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + d;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - d;
    else if (e.key === "PageUp") next = cur + big;
    else if (e.key === "PageDown") next = cur - big;
    else if (e.key === "Home") next = baseLevel.min;
    else if (e.key === "End") next = baseLevel.max;
    if (next === null) return;
    e.preventDefault();
    queueLevel(next);
  }

  /** Mostra na hora e manda depois de uma pausa (várias batidas seguidas viram um comando só). */
  function queueLevel(next: number) {
    if (!baseLevel) return;
    const v = Math.max(baseLevel.min, Math.min(baseLevel.max, next));
    setPend({ power: true, level: v });
    clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => commitLevel(v), 450);
  }

  /** −/+ do card: ar ±1 passo, luz ±10%, TV ±5 de volume. */
  function nudge(dir: -1 | 1) {
    if (!baseLevel || !level || blocked) return;
    const d = baseLevel.capability === "target_temp" ? baseLevel.step : baseLevel.capability === "volume" ? 5 : 10;
    const cur = isOn(shown) ? level.value : baseLevel.capability === "target_temp" ? level.value : baseLevel.min;
    queueLevel(cur + dir * d);
  }

  const isGroup = device.vendor === "grupo";
  const Icon = isGroup ? Layers : kindIcon(device.kind);
  const name = device.name;
  const size = look.size;
  /** Esta parte do card está ligada na personalização? (chave que não vale pro tipo = sempre true, e não desenha nada). */
  const show = (k: string) => look.show[k] !== false;
  const small = size === "s";
  const large = size === "l";
  const span = cardSpan(device, size);
  const isHero = device.kind === "ac";
  const isWide = device.kind === "vacuum" && !isGroup;
  const isTv = device.kind === "tv" && !isGroup;
  const plain = !isHero && !isTv && !keys.length && !isWide;
  const lit = on && !offline;
  const s = shown.state;
  const fem = device.kind === "light" || device.kind === "plug" || device.kind === "tv";
  const head = isOn(shown) ? (fem ? "Ligada" : "Ligado") : fem ? "Desligada" : "Desligado";

  // Subtítulo do card: cômodo; no grupo, quantos aparelhos e quantos ligados.
  const sub = isGroup ? (show("members") ? groupLine(shown) : null) : show("room") ? device.room : null;
  const partialOff = isGroup && !offline && show("offline") ? Number(device.state.group_offline ?? 0) : 0;
  const offText = device.last_seen ? `Sem resposta ${ago(device.last_seen * 1000, now)}` : "Sem resposta";

  const powerW = typeof s.power_w === "number" ? s.power_w : null;
  const battery = typeof s.battery === "number" ? s.battery : null;
  // Número grande do card: brilho (luz), consumo (tomada, só no grande), bateria (celular).
  const bigValue: { value: number; unit: string; off: boolean } | null =
    !plain || offline || !show("level")
      ? null
      : level?.capability === "brightness" && (on || large)
        ? { value: levelValue, unit: "%", off: !on }
        : large && !level && powerW !== null && on
          ? { value: Math.round(powerW), unit: "W", off: false }
          : device.kind === "phone" && battery !== null
            ? { value: battery, unit: "%", off: false }
            : null;

  // Linha de estado: cada pedaço liga/desliga na personalização.
  const parts: ReactNode[] = [];
  let colorDot: ReactNode = null;
  if (!offline) {
    if (keys.length) {
      // o rodapé do interruptor já conta as teclas
    } else if (isHero) {
      if (isOn(shown)) {
        const mode = optionLabel(shown, "ac_mode", s.ac_mode);
        if (show("mode") && mode) parts.push(mode);
        else if (show("status")) parts.push(head);
        const fan = optionLabel(shown, "fan_speed", s.fan_speed);
        if (show("fan") && fan) parts.push(`vent. ${fan.toLowerCase()}`);
      } else if (show("status")) parts.push(head);
      if (show("current") && typeof s.current_temp === "number") parts.push(`ambiente ${int.format(s.current_temp)} °C`);
    } else if (isWide) {
      if (show("status")) parts.push(vacuumStatus(shown));
      const fp = optionLabel(shown, "fan_power", s.fan_power);
      if (show("fan_power") && fp && device.capabilities.some((c) => c.id === "fan_power")) parts.push(`potência ${fp.toLowerCase()}`);
    } else if (device.kind === "phone") {
      if (show("home")) {
        if (s.at_home === true) parts.push("Em casa");
        else if (typeof s.distance_km === "number") parts.push(`A ${dec.format(s.distance_km)} km`);
      }
      if (show("charging") && s.charging === true) parts.push("carregando");
    } else {
      // Com o número grande à mostra, "Ligada" sobra.
      // No celular a TV com app à mostra dispensa o "Ligada" (cabe mais).
      const tvShort = compact && isTv && show("source") && isOn(shown) && s.source != null;
      if (show("status") && !(bigValue && !bigValue.off) && !tvShort) parts.push(head);
      if (isTv && show("source") && isOn(shown)) {
        const src = optionLabel(shown, "source", s.source);
        if (src) parts.push(src);
      }
      if (device.kind === "light" && show("color") && isOn(shown)) {
        if (typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) && device.capabilities.some((c) => c.id === "color")) {
          colorDot = <span className="dev-dot" style={{ background: s.color }} aria-hidden />;
          parts.push("cor");
        } else if (typeof s.color_temp === "number") {
          const t = s.color_temp;
          colorDot = <span className="dev-dot" style={{ "--ct": `${t}%` } as CSSProperties} aria-hidden />;
          parts.push(t <= 33 ? "quente" : t >= 67 ? "fria" : "neutra");
        }
      }
      if (device.kind === "plug" && show("level") && isOn(shown) && powerW && powerW > 0 && !bigValue) parts.push(`${int.format(powerW)} W`);
    }
  }
  const statusText = offline ? offText : parts.map((p) => (typeof p === "string" ? p : "")).join(" · ");
  const flash = useFlash(statusText);
  const xf = flash > 0 ? "ini-xf" : undefined;
  const timerChip = device.off_at && !offline && show("status") ? <TimerChip offAt={device.off_at} now={now} /> : null;
  const statusEl =
    offline || parts.length || timerChip || partialOff > 0 ? (
      <span className={cn("dev-st", xf)} key={flash}>
        {offline && <WifiOff className="i i-sm" aria-hidden />}
        {isHero && level && <span className="sr">{level.format(level.value)} · </span>}
        {colorDot}
        {offline ? offText : parts.join(" · ")}
        {timerChip}
        {partialOff > 0 && (
          <span className="chip warn">
            <WifiOff className="i i-sm" aria-hidden />
            {partialOff} sem resposta
          </span>
        )}
      </span>
    ) : null;

  const hex = <HexTile icon={Icon} variant={lit ? "on" : "neutral"} size="sm" />;
  const swLabel = stale !== null ? `${name} (sem conexão)` : offline ? `Ligar ${name} (sem resposta)` : `${on ? "Desligar" : "Ligar"} ${name}`;

  // Sensor (ex.: celular) não tem liga/desliga: sem chave no card.
  const canPower = isGroup || device.capabilities.some((c) => c.id === "power" && !c.readonly);
  const switchEl = canPower && (
    <button type="button" className="sw" role="switch" aria-checked={lit} aria-label={swLabel} disabled={blocked} onClick={toggle} />
  );
  const tvPower = (
    <button
      type="button"
      className="pwb"
      aria-pressed={lit}
      aria-label={stale !== null ? `${name} (sem conexão)` : `${on ? "Desligar" : "Ligar"} ${name}`}
      disabled={blocked}
      onClick={toggle}
    >
      <Power className="i" aria-hidden />
    </button>
  );

  const slider =
    level && !offline ? (
      <span
        className="dev-lvl"
        role="slider"
        tabIndex={draggable ? 0 : -1}
        aria-disabled={!draggable || undefined}
        aria-label={levelLabel(device, level)}
        aria-valuemin={level.min}
        aria-valuemax={level.max}
        aria-valuenow={levelValue}
        aria-valuetext={`${level.valueText(levelValue)}${on ? "" : device.kind === "ac" ? ", desligado" : ", desligada"}`}
        onKeyDown={onSliderKey}
      />
    ) : null;

  const nameLink = (
    <Link className="dev-name" to={`/aparelho/${device.id}`} draggable={false}>
      {name}
    </Link>
  );
  const staleEl = stale !== null ? <span className="stale">{stale}</span> : null;
  const litCount = keys.filter((k) => shown.state[k.id] === true).length;

  // O card do painel com tamanho próprio não troca o tamanho pelo menu (é na engrenagem do modo editar).
  const sizeLocked = Boolean(override?.size);
  const menuItems = <CardMenuItems device={device} look={look} sizeLocked={sizeLocked} onMenu={onMenu} now={now} />;
  const more = preview ? null : <MoreMenu label={name}>{menuItems}</MoreMenu>;

  const levelWhat = baseLevel?.capability === "target_temp" ? "temperatura" : baseLevel?.capability === "volume" ? "volume" : "brilho";
  const nudgeEl = (when: boolean) =>
    when && level && baseLevel ? (
      <Nudge label={`${levelWhat[0].toUpperCase()}${levelWhat.slice(1)} de ${name}`} unit={levelWhat} disabled={blocked} onStep={nudge} />
    ) : null;

  // Robô: iniciar/pausar (e, no grande, voltar pra base).
  const cleaning = s.vacuum_status === "cleaning";
  const canPause = device.capabilities.some((c) => c.id === "pause");
  const act = cleaning && canPause ? "pause" : "start";
  const ActIcon = busy ? Loader : act === "pause" ? Pause : Play;
  const actLabel = `${act === "pause" ? "Pausar" : "Iniciar"} limpeza do ${name}`;
  const runAct = () => void run([[act]], null, act === "pause" ? "pausar" : "iniciar");

  // Paleta rápida da luz (grande): temperatura e, se a luz tem cor, cores. Tudo em tokens --color-luz-*.
  const paletteEl =
    large && plain && device.kind === "light" && show("palette") && lit ? (
      <span className="dev-pal" role="group" aria-label={`Cor de ${name}`}>
        {device.capabilities.some((c) => c.id === "color_temp") &&
          TEMPS.map((t) => (
            <button key={t.label} type="button" className="dev-sw-c" style={{ "--ct": `${t.value}%` } as CSSProperties} aria-label={`Luz ${t.label}`}
              aria-pressed={s.color_temp === t.value} disabled={blocked} onClick={() => void run([["color_temp", t.value]], null, "mudar a cor de")} />
          ))}
        {device.capabilities.some((c) => c.id === "color") &&
          HUES.map((h) => (
            <button key={h.token} type="button" className="dev-sw-c is-hue" style={{ background: `var(${h.token})` }} aria-label={`Luz ${h.label}`}
              disabled={blocked} onClick={() => { const hex = tokenHex(h.token); if (hex) void run([["color", hex]], null, "mudar a cor de"); }} />
          ))}
      </span>
    ) : null;

  // Controle da TV (grande): setas, OK e voltar.
  const remoteEl =
    large && isTv && show("remote") && lit && device.remote?.length ? <MiniRemote device={device} disabled={blocked} /> : null;

  let body: ReactNode;
  if (small) {
    // Pílula: favo, nome, liga/desliga e (se ligado) o número principal pequeno.
    let control: ReactNode = null;
    if (keys.length) {
      control = (
        <button type="button" className="sw" role="switch" aria-checked={litCount > 0 && !offline}
          aria-label={stale !== null ? `${name} (sem conexão)` : `${litCount ? "Desligar" : "Ligar"} todas as teclas do ${name}`}
          disabled={blocked} onClick={toggleAll} />
      );
    } else if (isTv) {
      control = tvPower;
    } else if (isWide) {
      control = cap(device, act) ? (
        <button type="button" className="ibtn bd" aria-label={actLabel} aria-busy={busy || undefined} disabled={blocked || busy} onClick={runAct}>
          <ActIcon className={cn("i", busy && "spin")} aria-hidden />
        </button>
      ) : null;
    } else {
      control = switchEl || null;
    }
    const pillValue =
      offline || !show("level")
        ? null
        : isWide || device.kind === "phone"
          ? battery !== null ? `${battery}%` : null
          : level && on
            ? isTv && s.muted === true ? "mudo" : level.format(levelValue)
            : device.kind === "plug" && on && powerW
              ? `${int.format(powerW)} W`
              : null;
    body = (
      <div className="dev-pill">
        {hex}
        <div className="dev-tx">
          {nameLink}
          {offline ? (
            <span className={cn("dev-st", xf)} key={flash}>
              <WifiOff className="i i-sm" aria-hidden />
              Sem resposta
            </span>
          ) : (
            pillValue && !dragging && <span className="dev-pv num">{pillValue}</span>
          )}
          {staleEl}
          {dragging && level && <LevelNum level={level} value={drag} className="dev-lvl-num" />}
        </div>
        {offline && <OfflineTip id={device.id} group={isGroup} />}
        {more}
        {control}
      </div>
    );
  } else if (keys.length) {
    body = (
      <>
        <div className="dev-top">
          {hex}
          <div className="dev-tx dev-keys-tx">
            {nameLink}
            {sub && <span className="dev-room">{sub}</span>}
            {timerChip}
            {offline && (
              <span className={cn("dev-st", xf)} key={flash}>
                <WifiOff className="i i-sm" aria-hidden />
                {offText}
              </span>
            )}
            {staleEl}
          </div>
          {offline && <OfflineTip id={device.id} />}
          {more}
        </div>
        <div className={cn("dev-plate", !show("keynames") && "no-names")} role="group" aria-label={`Teclas do ${name}`}
          style={{ "--keys": keys.length, "--keys-narrow": Math.min(keys.length, 3) } as CSSProperties}>
          {keys.map((k) => {
            const keyLit = shown.state[k.id] === true && !offline;
            return (
              <button key={k.id} type="button" className="dev-rk" aria-pressed={keyLit} aria-label={`${keyLit ? "Desligar" : "Ligar"} ${k.label}`}
                disabled={blocked} onClick={() => toggleKey(k.id, k.label)}>
                <span className="dev-rk-led" aria-hidden />
                <span className="dev-rk-bar" aria-hidden />
                {show("keynames") && <span className="dev-rk-n">{k.label}</span>}
              </button>
            );
          })}
        </div>
        {!offline && (show("status") || show("all")) && (
          <div className="dev-sw-ft">
            {show("status") ? (
              <span className="dev-sw-n num">{litCount ? `${litCount} de ${keys.length} ligada${litCount === 1 ? "" : "s"}` : "Todas desligadas"}</span>
            ) : (
              <span />
            )}
            {show("all") && (
              <button type="button" className="btn btn-sec btn-sm btn-ico" aria-label={litCount ? "Desligar todas as teclas" : "Ligar todas as teclas"}
                disabled={blocked} onClick={toggleAll}>
                <Power className="i i-sm" aria-hidden />
                <span>
                  {litCount ? "Desligar" : "Ligar"}
                  <span className="dev-sw-all"> todas</span>
                </span>
              </button>
            )}
          </div>
        )}
      </>
    );
  } else if (isWide) {
    const ring = show("level") ? (
      <div
        className="ring robo-ring"
        // Tailwind gera um utilitário `.ring` (box-shadow) que colide com o anel do kit.
        style={{ boxShadow: "none" }}
        role="img" aria-label={battery === null ? "Bateria desconhecida" : `Bateria ${battery} por cento`}>
        <svg viewBox="0 0 120 120" fill="none" strokeWidth="6" strokeLinecap="round" aria-hidden>
          <circle className="trk" cx="60" cy="60" r="50" strokeDasharray="235.6 314.2" transform="rotate(135 60 60)" />
          <circle className="prg" cx="60" cy="60" r="50" strokeDasharray={`${(235.6 * (battery ?? 0)) / 100} 314.2`} transform="rotate(135 60 60)" />
        </svg>
        <b className="num">{battery === null ? "–" : `${battery}%`}</b>
      </div>
    ) : (
      hex
    );
    const tx = (
      <div className="dev-tx">
        {nameLink}
        {sub && <span className="dev-room">{sub}</span>}
        {statusEl}
        {staleEl}
      </div>
    );
    const actBtn = !offline && show("actions") && cap(device, act) && (
      <button type="button" className="btn btn-sec btn-sm btn-ico" aria-label={actLabel} aria-busy={busy || undefined} disabled={blocked || busy} onClick={runAct}>
        <ActIcon className={cn("i i-sm", busy && "spin")} aria-hidden />
        {act === "pause" ? "Pausar" : "Iniciar"}
      </button>
    );
    const dockBtn = !offline && show("dock") && cap(device, "dock") && (
      <button type="button" className="btn btn-ghost btn-sm btn-ico" aria-label={`Mandar ${name} pra base`} disabled={blocked || busy}
        onClick={() => void run([["dock"]], null, "mandar pra base")}>
        <House className="i i-sm" aria-hidden />
        Base
      </button>
    );
    body = large ? (
      <>
        <div className="dev-top">
          {ring}
          <span className="dev-top-end">
            {offline && <OfflineTip id={device.id} />}
            {more}
          </span>
        </div>
        {tx}
        {(actBtn || dockBtn) && (
          <div className="dev-q">
            {actBtn}
            {dockBtn}
          </div>
        )}
      </>
    ) : (
      <>
        {ring}
        {tx}
        {offline ? <OfflineTip id={device.id} /> : actBtn}
        {more}
      </>
    );
  } else {
    const control = isTv ? (show("power") ? tvPower : null) : switchEl;
    const top = (
      <div className="dev-top">
        {hex}
        <span className="dev-top-end">
          {isHero && nudgeEl(show("nudge") && lit)}
          {offline && <OfflineTip id={device.id} group={isGroup} />}
          {more}
          {control}
        </span>
      </div>
    );
    if (isHero) {
      const heroValue = dragging ? drag : (level?.value ?? null);
      body = (
        <>
          {top}
          <div className="dev-hero-b">
            {show("level") && heroValue !== null && level ? (
              <span className={cn("hero-num", !on && "ini-hero-off", !dragging && xf)} key={dragging ? "d" : flash} aria-hidden>
                {int.format(heroValue)}
                <small>°C</small>
              </span>
            ) : (
              <span />
            )}
            <div className="dev-tx">
              {nameLink}
              {sub && <span className="dev-room">{sub}</span>}
              {statusEl}
              {staleEl}
              {!show("level") && dragging && level && <LevelNum level={level} value={drag} className="dev-lvl-num" />}
            </div>
          </div>
        </>
      );
    } else {
      const tvMute = isTv && show("mute") && "muted" in device.state;
      const tvVol = isTv && show("level") && level;
      const tvFoot = isTv && lit && (tvMute || tvVol);
      body = (
        <>
          {top}
          {bigValue && (
            <span className={cn("ini-dev-v", bigValue.off && "ini-hero-off")} aria-hidden>
              {dragging ? int.format(levelValue) : <Swap value={bigValue.value}>{int.format(bigValue.value)}</Swap>}
              <small>{bigValue.unit}</small>
            </span>
          )}
          <div className="dev-tx">
            {nameLink}
            {sub && <span className="dev-room">{sub}</span>}
            {statusEl}
            {staleEl}
            {dragging && level && <LevelNum level={level} value={drag} className="dev-lvl-num" />}
          </div>
          {tvFoot && (
            <div className="dev-tv-ft">
              {tvMute ? (
                <button type="button" className="ibtn dev-mute" aria-pressed={s.muted === true}
                  aria-label={s.muted === true ? `Tirar o mudo de ${name}` : `Silenciar ${name}`} disabled={blocked} onClick={toggleMute}>
                  {s.muted === true ? <VolumeX className="i" aria-hidden /> : <Volume2 className="i" aria-hidden />}
                </button>
              ) : (
                <span />
              )}
              <span className="dev-tv-end">
                {tvVol && !dragging && <span className="dev-tv-vol num">{s.muted === true ? "mudo" : level.format(levelValue)}</span>}
                {large && nudgeEl(Boolean(tvVol))}
              </span>
            </div>
          )}
          {remoteEl}
          {large && plain && level?.capability === "brightness" && lit && (show("nudge") || paletteEl) && (
            <div className="dev-q">
              {paletteEl}
              {nudgeEl(show("nudge"))}
            </div>
          )}
        </>
      );
    }
  }

  const style = {
    ...(level ? { "--level": `${pct}%` } : {}),
    "--c": span.cols,
    "--r": span.rows,
  } as CSSProperties;

  return (
    <ContextMenu.Root disabled={stale !== null || Boolean(preview)}>
      <ContextMenu.Trigger
        render={<article />}
        className={cn(
          "dev",
          `sz-${size}`,
          lit && "on",
          level && !offline && "lvl",
          offline && "is-off",
          !small && isHero && "dev-hero",
          isWide && size === "m" && "dev-wide",
          isWide && large && "dev-robo-l",
          keys.length > 0 && !small && "dev-sw",
          isTv && "dev-tv",
          !draggable && level && !offline && "ini-nodrag",
        )}
        style={style}
        data-dev-id={device.id}
        aria-disabled={stale !== null || undefined}
        data-dragging={dragging ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, true)}
        onPointerCancel={(e) => endGesture(e, false)}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {slider}
        {body}
      </ContextMenu.Trigger>
      <ContextMenu.Portal className="mk">
        <ContextMenu.Positioner className="ini-menu-pos">
          <ContextMenu.Popup className="menu ini-menu" aria-label={name}>
            {menuItems}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
