// Cards do painel personalizado, no modo normal e no modo editar (moldura tracejada, alça e engrenagem).
// O card de aparelho é o DeviceCard da Início (não se mexe nele): em edição ele fica inerte e a alça e a engrenagem
// são desenhadas por cima. Os outros tipos são desenhados aqui e já nascem sem controles quando em edição.
import { Swap } from "@/components/favos";
import { Check, GripVertical, Layers, Plus, Settings, TriangleAlert, WifiOff } from "lucide-react";
import { Loader } from "@/components/Logo";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { toast } from "@/components/toast";
import { toastPartial } from "@/components/partialToast";
import { api } from "@/lib/api";
import { cardSpan, resolveLook } from "@/lib/cardLook";
import { useCardOf } from "@/lib/cardPrefsStore";
import { isComplete, isBroken } from "@/lib/dashboard";
import { has, isOffline, isOn, kindIcon, stateText } from "@/lib/devices";
import type { DashCard, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HexTile } from "@/components/favos";
import { DeviceCard } from "../DeviceCard";
import { cardText, houseCounts, routineIcon, virtualIcon } from "../home";
import { useRoutineRunner, useVirtualFlip } from "../Quick";
import { cardLabel, useEdit, useEnv } from "./env";

const TIMEOUT = 5000;

/* ---------------- alça e engrenagem ---------------- */

export function Grip({ kind, id, label }: { kind: "card" | "section"; id: string; label: string }) {
  const edit = useEdit();
  if (!edit) return null;
  return (
    <button
      type="button"
      className={cn("ep-h ep-grip", kind === "section" && "ep-grip-s")}
      aria-label={kind === "card" ? `Mover ${label}` : `Mover seção ${label}`}
      aria-roledescription="item arrastável"
      aria-describedby="ep-ajuda"
      {...edit.gripProps(kind, id)}
    >
      <GripVertical className="i" aria-hidden />
    </button>
  );
}

function Gear({ cardId, label }: { cardId: string; label: string }) {
  const edit = useEdit();
  if (!edit) return null;
  return (
    <button
      type="button"
      className="ep-h ep-gear"
      aria-label={`Configurar ${label}`}
      aria-haspopup="dialog"
      data-gear={cardId}
      onClick={() => edit.configure(cardId)}
    >
      <Settings className="i" aria-hidden />
    </button>
  );
}

/* ---------------- aparelho ---------------- */

function DeviceBody({ card, device }: { card: DashCard; device: Device }) {
  const env = useEnv();
  const edit = useEdit();
  // "Nome exibido": o DeviceCard desenha device.name (rótulos, toasts), então ele recebe o aparelho com o nome trocado.
  const shown = useMemo(() => (card.name ? { ...device, name: card.name } : device), [device, card.name]);
  const el = (
    <DeviceCard
      device={shown}
      stale={env.stale}
      compact={env.compact}
      onLocal={env.onLocal}
      onMenu={(_, action) => env.onMenu(device, action)}
      now={env.now}
      override={card.size || card.show ? { size: card.size, show: card.show } : null}
    />
  );
  if (!edit) return el;
  return (
    <>
      <div className="ep-inert" inert>
        {el}
      </div>
      <Grip kind="card" id={card.id} label={shown.name} />
      <Gear cardId={card.id} label={shown.name} />
    </>
  );
}

/* ---------------- lista compacta ---------------- */

function GlanceRow({ device, editing }: { device: Device; editing: boolean }) {
  const env = useEnv();
  const [pend, setPend] = useState<boolean | null>(null);
  const offline = isOffline(device);
  const real = isOn(device);
  const on = pend ?? real;
  const canToggle = device.kind !== "vacuum" && has(device, "power");
  const blocked = editing || env.stale !== null || offline;
  const Icon = device.vendor === "grupo" ? Layers : kindIcon(device.kind);

  useEffect(() => {
    if (pend !== null && real === pend) setPend(null);
  }, [real, pend]);

  async function send(next: boolean) {
    setPend(next);
    env.onLocal(device.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
      });
      timeout.catch(() => {});
      toastPartial(await Promise.race([api.devices.command(device.id, "power", next), timeout]));
      setTimeout(() => setPend(null), 1500);
    } catch {
      setPend(null);
      toast({
        id: `dev-${device.id}`,
        tone: "error",
        message: `Não consegui ${next ? "ligar" : "desligar"} ${device.name}`,
        action: { label: "Tentar de novo", onClick: () => void send(next) },
        duration: 8000,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const text = offline ? "Sem resposta" : cardText(device, stateText(device), true);
  return (
    <div className={cn("ep-gl-r", on && !offline && "on", offline && "off")}>
      <HexTile icon={Icon} variant={on && !offline ? "on" : "neutral"} size="sm" />
      <span className="ep-gl-t">
        {editing ? (
          <b>{device.name}</b>
        ) : (
          <Link className="ep-gl-n" to={`/aparelho/${device.id}`} draggable={false}>
            {device.name}
          </Link>
        )}
        <small>
          {offline && <WifiOff className="i i-sm" aria-hidden />}
          {text}
        </small>
      </span>
      {canToggle && (
        <button
          type="button"
          className="sw"
          role="switch"
          aria-checked={on && !offline}
          aria-label={env.stale !== null ? `${device.name} (sem conexão)` : offline ? `Ligar ${device.name} (sem resposta)` : `${on ? "Desligar" : "Ligar"} ${device.name}`}
          disabled={blocked}
          tabIndex={editing ? -1 : undefined}
          onClick={() => void send(!on)}
        />
      )}
    </div>
  );
}

function GlanceBody({ card }: { card: DashCard }) {
  const env = useEnv();
  const edit = useEdit();
  const rows = (card.device_ids ?? []).flatMap((id) => env.devices.find((d) => d.id === id) ?? []);
  const title = card.name?.trim();
  const label = cardLabel(card, env);
  return (
    <article className={cn("ep-gl", !edit && "n")} aria-label={title || "Lista compacta"}>
      {(edit || title) && (
        <div className="ep-gl-h">
          {edit && <Grip kind="card" id={card.id} label={label} />}
          <span>{title}</span>
          {edit && <Gear cardId={card.id} label={label} />}
        </div>
      )}
      {rows.map((d) => (
        <GlanceRow key={d.id} device={d} editing={!!edit} />
      ))}
    </article>
  );
}

/* ---------------- rotina ---------------- */

function RoutineBody({ card }: { card: DashCard }) {
  const env = useEnv();
  const edit = useEdit();
  const { busy, done, run } = useRoutineRunner();
  const routine = env.routines.find((r) => r.id === card.routine_id)!;
  const name = card.name || routine.name;
  const Icon = busy === routine.id ? Loader : done === routine.id ? Check : routineIcon(routine.name);
  if (edit) {
    return (
      <div className="ep-rot">
        <Grip kind="card" id={card.id} label={name} />
        <HexTile icon={<Icon className="i i-sm" aria-hidden />} variant="soft" size="sm" />
        <span className="ep-nm">{name}</span>
        <Gear cardId={card.id} label={name} />
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn("rot ini-rot ep-rotb", done === routine.id && "is-done")}
      aria-busy={busy === routine.id || undefined}
      disabled={!env.online || Boolean(routine.incomplete) || busy !== null}
      title={routine.incomplete ?? undefined}
      onClick={() => void run(routine)}
    >
      <HexTile icon={<Icon className={cn("i i-sm", busy === routine.id && "spin")} aria-hidden />} variant={done === routine.id ? "on" : "soft"} size="sm" />
      <span className="ep-nm">{name}</span>
    </button>
  );
}

/* ---------------- objeto virtual ---------------- */

function VirtualBody({ card }: { card: DashCard }) {
  const env = useEnv();
  const edit = useEdit();
  const virtual = env.virtuals.find((v) => v.id === card.virtual_id)!;
  const { valueOf, flip } = useVirtualFlip(env.virtuals);
  const value = valueOf(virtual);
  const name = card.name || virtual.name;
  const Icon = virtualIcon(virtual.name);
  if (edit) {
    // O switch some em edição: a engrenagem ocupa o canto (o estado aparece pela tinta latão).
    return (
      <div className={cn("ep-rot", value && "on")}>
        <Grip kind="card" id={card.id} label={name} />
        <HexTile icon={<Icon className="i i-sm" aria-hidden />} variant={value ? "on" : "neutral"} size="sm" />
        <span className="ep-nm">{name}</span>
        <Gear cardId={card.id} label={name} />
      </div>
    );
  }
  return (
    <span className={cn("obj ini-obj ep-obj", value && "on")}>
      <HexTile icon={<Icon className="i i-sm" aria-hidden />} variant={value ? "on" : "neutral"} size="sm" />
      <span className="ep-nm">{name}</span>
      <button
        type="button"
        className="sw"
        role="switch"
        aria-checked={value}
        aria-label={`${value ? "Desligar" : "Ligar"} ${name}`}
        disabled={!env.online}
        onClick={() => void flip(virtual, !value)}
      />
    </span>
  );
}

/* ---------------- resumo ---------------- */

function SummaryBody({ card }: { card: DashCard }) {
  const env = useEnv();
  const edit = useEdit();
  const c = houseCounts(env.devices, env.routines);
  // A saudação já está no bloco mel: aqui o destaque é o que está ligado, sem repetir "Boa tarde".
  const head = c.on === 0 ? "Tudo desligado" : `${c.on} ${c.on === 1 ? "ligado" : "ligados"}`;
  const part = (n: number, one: string, many: string) => (
    <span>
      <b>{n}</b> {n === 1 ? one : many}
    </span>
  );
  const items = [
    ...(c.offline > 0 ? [<span key="off">{part(c.offline, "sem resposta", "sem resposta")}</span>] : []),
    <span key="rot">{part(c.routines, "rotina", "rotinas")}</span>,
  ];
  return (
    <article className={cn("ep-sum", !edit && "n")} aria-label="Resumo da casa">
      {edit && (
        <div className="ep-ch">
          <Grip kind="card" id={card.id} label="Resumo da casa" />
          <Gear cardId={card.id} label="Resumo da casa" />
        </div>
      )}
      <h2 className="ep-hi">
        <Swap value={head} />
      </h2>
      <p className="ep-cn" aria-live={edit ? undefined : "polite"}>
        {items.flatMap((it, i) => (i === 0 ? [it] : [<span key={`s${i}`} aria-hidden>·</span>, it]))}
      </p>
    </article>
  );
}

/* ---------------- sem referência / sem escolha ---------------- */

function Hollow({
  card,
  title,
  text,
  action,
  incomplete,
}: {
  card: DashCard;
  title: string;
  text: string;
  action?: { label: string; run: () => void };
  incomplete?: boolean;
}) {
  const edit = useEdit();
  const Icon = incomplete ? Plus : TriangleAlert;
  return (
    <article className={cn("dev ep-bk", incomplete && "ep-new", edit && "ep-c", !edit && "n")}>
      <div className="dev-top">
        {edit ? (
          <span className="ep-hl">
            <Grip kind="card" id={card.id} label={title} />
            <HexTile icon={Icon} size="sm" />
          </span>
        ) : (
          <HexTile icon={Icon} size="sm" />
        )}
        {edit && <Gear cardId={card.id} label={title} />}
      </div>
      <div className="dev-tx">
        <span className="dev-name">{title}</span>
        <span className="dev-st">{text}</span>
        {action && (
          <button type="button" className="btn-link" onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
    </article>
  );
}

const MISSING: Record<DashCard["type"], string> = {
  device: "Este aparelho não existe mais.",
  glance: "Estes aparelhos não existem mais.",
  routine: "Esta rotina não existe mais.",
  virtual: "Este objeto não existe mais.",
  summary: "",
};

const CHOOSE: Record<DashCard["type"], string> = {
  device: "Escolha um aparelho",
  glance: "Escolha os aparelhos",
  routine: "Escolha uma rotina",
  virtual: "Escolha um objeto",
  summary: "",
};

/* ---------------- encaixe na grade ---------------- */

interface SlotProps {
  card: DashCard;
  /** Colunas da grade: 4 no PC, 2 no celular. */
  columns: 2 | 4;
}

export const Slot = memo(function Slot({ card, columns }: SlotProps) {
  const env = useEnv();
  const edit = useEdit();
  const incomplete = !isComplete(card);
  const broken = !incomplete && isBroken(card, env.devices, env.routines, env.virtuals);
  const cardOf = useCardOf();
  // No celular, 3 e 4 colunas ocupam a linha toda. No PC a grade se adapta à tela; "4" = a linha toda.
  const span = Math.min(card.cols, columns);
  const mine = edit?.dragging?.kind === "card" && edit.dragging.id === card.id ? edit.dragging : null;
  const style: CSSProperties = { gridColumn: card.cols === 4 ? "1 / -1" : `span ${span}` };
  const device = card.type === "device" && !incomplete && !broken ? env.devices.find((d) => d.id === card.device_id) : undefined;
  // Card de aparelho: altura em linhas pelo tamanho (pequeno 1, médio 2, grande 3); a largura continua a do card.
  if (device) style.gridRow = `span ${cardSpan(device, resolveLook(cardOf(device), card).size).rows}`;
  // Resumo estreito no PC pega duas linhas (como as rotinas ao lado, de 56 px).
  if (card.type === "summary" && columns === 4 && card.cols < 4) style.gridRow = "span 2";

  let body;
  if (incomplete) {
    body = <Hollow card={card} title="Novo card" text={CHOOSE[card.type]} incomplete />;
  } else if (broken) {
    const run = edit ? () => edit.removeCard(card.id) : () => env.dropCard(card.id);
    body = <Hollow card={card} title="Removido" text={MISSING[card.type]} action={{ label: "Apagar card", run }} />;
  } else if (card.type === "device") {
    body = <DeviceBody card={card} device={env.devices.find((d) => d.id === card.device_id)!} />;
  } else if (card.type === "glance") {
    body = <GlanceBody card={card} />;
  } else if (card.type === "routine") {
    body = <RoutineBody card={card} />;
  } else if (card.type === "virtual") {
    body = <VirtualBody card={card} />;
  } else {
    body = <SummaryBody card={card} />;
  }

  return (
    <div
      className="ep-slot"
      data-card-id={card.id}
      data-type={card.type}
      data-span={span}
      data-size={device ? resolveLook(cardOf(device), card).size : undefined}
      data-edit={edit ? "" : undefined}
      data-sel={mine || edit?.selectedId === card.id ? "" : undefined}
      data-ghost={mine?.mode === "pointer" ? "" : undefined}
      style={style}
    >
      {body}
    </div>
  );
});
