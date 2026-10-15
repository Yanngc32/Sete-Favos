// Tela: Detalhe do aparelho · visual "Sete Favos" (mock exploracao-favos, tela 2).
// Rota filha da Início (/aparelho/:id): sheet lateral no desktop, folha de baixo em tela cheia no celular
// (fecha arrastando ou com Esc). Em cima, o bloco mel com o herói do tipo; embaixo, o painel com os demais
// controles, "Horários" e as automações. Fechar = animação de saída e depois volta pra origem
// (`location.state.back`, se quem abriu mandou) ou pra Início.
import { Drawer } from "@base-ui/react/drawer";
import { Menu } from "@base-ui/react/menu";
import { ChevronLeft, ChevronRight, Ellipsis, Info, Layers, Pencil, MapPin, Star, StarOff, Timer, Trash2, Ungroup, WifiOff, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { HoneyHeader } from "@/components/favos";
import { Confirm } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { groupCounts, has, isGroup, isOffline, isOn, usedBy } from "@/lib/devices";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Device, Kind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AcBody, LightBody, noWol, PowerBody, TvBody, VacuumBody, type BodyProps } from "./bodies";
import { GroupSession } from "@/screens/grupos/GroupEditor";
import { plural } from "@/screens/aparelhos/wizard/model";
import { RenameDialog, RoomDialog, TimerDialog } from "./dialogs";
import { Hero, HeroArt, heroLevel, TimerChip, timerText } from "./Hero";
import { Schedules } from "./Schedules";
import { GroupBody } from "./GroupBody";
import { PhoneBody } from "./PhoneBody";
import { SwitchBody } from "./SwitchBody";
import { useControl } from "./useControl";
import "./detalhe.css";
import "./detalhe-favos.css";

const DESKTOP = "(min-width: 1024px)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}

/** Relógio de 1 s para o "Atualizado há 3 s". */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Dica do aviso de offline, por tipo. */
const OFFLINE_HINT: Record<Kind, string> = {
  light: "A luz pode estar desligada no interruptor",
  plug: "A tomada pode estar sem energia ou fora do Wi-Fi",
  switch: "O interruptor pode estar sem energia ou fora do Wi-Fi",
  ac: "O ar pode estar desligado no disjuntor",
  tv: "A TV pode estar desligada da tomada",
  vacuum: "O robô pode estar sem bateria ou fora do Wi-Fi",
  phone: "O app do celular não manda notícias há mais de 45 min",
  other: "Confira se o aparelho está ligado e no Wi-Fi",
};

const BODY: Partial<Record<Kind, (p: BodyProps) => ReactNode>> = {
  light: LightBody,
  plug: PowerBody,
  switch: SwitchBody,
  phone: PhoneBody,
  ac: AcBody,
  tv: TvBody,
  vacuum: VacuumBody,
};

/** O card da Início que abriu o detalhe (o foco volta pra ele ao fechar). */
function cardOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`a[href="/aparelho/${CSS.escape(id)}"]`);
}

export function Detalhe() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back;
  const live = useLive();
  const desktop = useMedia(DESKTOP);
  // Nasce fechado e abre no primeiro efeito: assim o Base UI aplica o data-starting-style (entrada animada).
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const found = live.devices.find((d) => d.id === id);
  const lastRef = useRef<Device | undefined>(found);
  if (found) lastRef.current = found;
  const removedRef = useRef(false);
  // Fechando (ou acabou de remover): segura o último retrato para a saída não piscar "não encontrado".
  const device = found ?? (!open || removedRef.current ? lastRef.current : undefined);

  // Abriu outro aparelho por cima (Ctrl+K): reabre se estava fechando.
  useEffect(() => {
    removedRef.current = false;
    setOpen(true);
  }, [id]);

  // Foco no título ao abrir. O FloatingFocusManager do Base UI deixa o foco no próprio popup quando o
  // drawer já nasce aberto (rota aberta direto); então, se o foco ficou no popup ou no body, leva pro título.
  const hasDevice = !!found;
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const a = document.activeElement;
        if (!a || a === document.body || a.classList.contains("dsh")) titleRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [id, hasDevice, live.loaded]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next, details) => {
        // Toque no toast ("Tentar de novo") ou no editor de grupo (aninhado) não é "clicar fora": o painel fica aberto.
        const target = details.event?.target;
        if (!next && details.reason === "outside-press" && target instanceof Element && target.closest(".toasts, .gp, .gp-scrim, .gp-vp")) {
          details.cancel();
          return;
        }
        if (!next) setOpen(false);
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        // Veio navegando dentro do app: volta no histórico (o Voltar do celular não reabre o detalhe
        // e a lista de origem volta com busca/filtro). Link direto: troca pela página de origem.
        if (location.key !== "default") navigate(-1);
        else navigate(back ?? "/", { replace: true });
      }}
      swipeDirection={desktop ? "right" : "down"}
    >
      <Drawer.Portal className="mk" container={portalHost()}>
        <Drawer.Backdrop className="scrim dsh-scrim" />
        <Drawer.Viewport className="dsh-vp">
          <Drawer.Popup
            className={cn("dsh", desktop ? "dsh-side" : "dsh-bt")}
            initialFocus={titleRef}
            finalFocus={() => cardOf(id) ?? true}
          >
            {!desktop && <span className="dt-grab" aria-hidden />}
            {device ? (
              <Panel key={device.id} device={device} desktop={desktop} titleRef={titleRef} onClose={close} onRemoved={() => (removedRef.current = true)} />
            ) : live.loaded ? (
              <NotFound desktop={desktop} titleRef={titleRef} onClose={close} />
            ) : (
              <Loading desktop={desktop} titleRef={titleRef} />
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* ---------------- painel de um aparelho ---------------- */

interface PanelProps {
  device: Device;
  desktop: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onRemoved: () => void;
}

/** Voltar/Fechar do bloco: seta no celular (a folha é a tela toda), X no sheet lateral. */
function CloseBtn({ desktop }: { desktop: boolean }) {
  return (
    <Drawer.Close className="ibtn bd" aria-label={desktop ? "Fechar" : "Voltar"}>
      {desktop ? <X className="i" aria-hidden /> : <ChevronLeft className="i" aria-hidden />}
    </Drawer.Close>
  );
}

function Title({ titleRef, children }: { titleRef: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  return (
    <Drawer.Title ref={titleRef} render={<span className="dt-title" tabIndex={-1} />}>
      {children}
    </Drawer.Title>
  );
}

function Panel({ device, desktop, titleRef, onClose, onRemoved }: PanelProps) {
  const live = useLive();
  const now = useNow();
  const ctl = useControl(device);
  const [dialog, setDialog] = useState<"rename" | "room" | "remove" | "timer" | "schedule" | null>(null);
  const [removing, setRemoving] = useState(false);
  // Editar grupo: o editor mora aqui dentro (aninhado no sheet) para o Esc e o clique fora valerem só pra ele.
  const [edit, setEdit] = useState<{ key: number; active: boolean } | null>(null);
  const editKey = useRef(0);
  const menuRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const group = isGroup(device);
  const offline = isOffline(device);
  const central = live.connection !== "online";
  const loading = device.online === null && !offline;
  const disabled = offline || central;
  const used = usedBy(device.id, live.automations, live.routines).total;

  // Liga/desliga fica no bloco mel, ao lado do cômodo (o robô não tem; o celular é só sensor).
  const hasPower = device.kind !== "vacuum" && device.kind !== "phone" && has(device, "power");
  const on = hasPower ? ctl.value("power") === true : isOn(device);
  const wol = noWol(device);
  const powerLocked = !!wol && !on;
  const seen = device.last_seen ? ago(device.last_seen * 1000, now) : null;
  const Body = group ? GroupBody : (BODY[device.kind] ?? (has(device, "power") ? PowerBody : null));
  const notes = device.notes.filter((n) => n !== wol);
  const canTimer = hasPower && !powerLocked && (on || !!device.off_at);
  const timerOn = !!device.off_at && !offline;
  const place = group ? `Grupo · ${plural(groupCounts(device).total, "aparelho", "aparelhos")}` : (device.room ?? "Sem cômodo");

  const togglePin = async () => {
    try {
      await api.devices.update(device.id, { pinned: !device.pinned });
      toast({ tone: "ok", message: device.pinned ? `${device.name} saiu dos fixados` : `${device.name} fixado na Início` });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui fixar", detail: e instanceof Error ? e.message : undefined });
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await api.devices.remove(device.id);
      onRemoved();
      setDialog(null);
      toast({ tone: "ok", message: group ? `Grupo ${device.name} desfeito` : `${device.name} removido` });
      onClose();
    } catch (e) {
      toast({ tone: "error", message: group ? `Não consegui desfazer ${device.name}` : `Não consegui remover ${device.name}`, detail: e instanceof Error ? e.message : undefined });
    } finally {
      setRemoving(false);
    }
  };

  const removeText = group
    ? used === 0
      ? "Os aparelhos continuam como estão."
      : "Os aparelhos continuam como estão. Rotinas e automações que usam o grupo ficam incompletas."
    : used === 0
      ? "Ele sai da casa e do painel. Dá para adicionar de novo depois."
      : used === 1
        ? "A automação que usa ele vai ficar incompleta."
        : `As ${used} automações que usam ele vão ficar incompletas.`;

  const menu = loading ? null : (
    <Menu.Root>
      <Menu.Trigger ref={menuRef} className="ibtn bd" aria-label="Mais opções">
        <Ellipsis className="i" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal className="mk">
        <Menu.Positioner className="dsh-menu-pos" side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu dsh-menu" aria-label={device.name}>
            <Menu.Item nativeButton render={<button type="button" />} onClick={() => setDialog("rename")}>
              <Pencil className="i" aria-hidden />
              Renomear
            </Menu.Item>
            <Menu.Item nativeButton render={<button type="button" />} onClick={() => setDialog("room")}>
              <MapPin className="i" aria-hidden />
              Mudar de cômodo
            </Menu.Item>
            <Menu.Item nativeButton render={<button type="button" />} onClick={() => void togglePin()}>
              {device.pinned ? <StarOff className="i" aria-hidden /> : <Star className="i" aria-hidden />}
              {device.pinned ? "Desafixar" : "Fixar"}
            </Menu.Item>
            {canTimer && (
              <Menu.Item nativeButton render={<button type="button" />} disabled={disabled} onClick={() => setDialog("timer")}>
                <Timer className="i" aria-hidden />
                {timerOn && device.off_at ? `Timer: ${timerText(device.off_at, now)}` : "Desligar em…"}
              </Menu.Item>
            )}
            {group && (
              <Menu.Item nativeButton render={<button type="button" />} onClick={() => setEdit({ key: ++editKey.current, active: true })}>
                <Layers className="i" aria-hidden />
                Editar grupo
              </Menu.Item>
            )}
            <Menu.Separator render={<hr />} />
            <Menu.Item nativeButton render={<button type="button" />} className="dz" onClick={() => setDialog("remove")}>
              {group ? <Ungroup className="i" aria-hidden /> : <Trash2 className="i" aria-hidden />}
              {group ? "Desfazer grupo" : "Remover aparelho"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  const lead = (
    <>
      <span className="fv-s dt-room">{place}</span>
      {hasPower &&
        (loading ? (
          <span className="sk dt-sk-sw" aria-hidden />
        ) : (
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={on && !offline}
            aria-busy={ctl.pending("power") || undefined}
            aria-label={`${on && !offline ? "Desligar" : "Ligar"} ${device.name}${offline ? " (sem resposta)" : ""}`}
            aria-describedby={powerLocked ? `wol-${device.id}` : undefined}
            disabled={disabled || powerLocked}
            onClick={() => void ctl.send("power", !on)}
          />
        ))}
      {timerOn && device.off_at && canTimer && <TimerChip offAt={device.off_at} now={now} onClick={() => setDialog("timer")} />}
    </>
  );

  const offlineText = offline ? `Sem resposta${seen && seen !== "agora" ? ` ${seen}` : ""}` : null;
  const lit = on && !disabled && !loading;

  return (
    <>
      <HoneyHeader
        variant="detalhe"
        className={cn("dt-fv", lit && "is-on")}
        title={<Title titleRef={titleRef}>{device.name}</Title>}
        leading={<CloseBtn desktop={desktop} />}
        actions={menu}
        art={<HeroArt device={device} level={lit ? heroLevel(device, ctl, on) : 0} />}
      >
        {loading ? (
          <HeroSkeleton />
        ) : (
          <Hero device={device} ctl={ctl} disabled={disabled} on={on && !offline} offline={offline} offlineText={offlineText} lead={lead} />
        )}
      </HoneyHeader>

      <Drawer.Content className="fv-pg dt-pg" aria-busy={loading || undefined}>
        <div className={cn("fv-in fv-pg-in fv-enter fv-enter-2 dt-bd", disabled && "is-dis")}>
          {offline ? (
            <div className="off" role="status">
              <WifiOff className="i" aria-hidden />
              <p>
                <b>{offlineText}</b>
                <span>{group ? "Nenhum aparelho do grupo responde" : OFFLINE_HINT[device.kind]}</span>
              </p>
            </div>
          ) : central ? (
            <div className="off" role="status">
              <WifiOff className="i" aria-hidden />
              <p>
                <b>Sem conexão com a colmeia</b>
                <span>Mostrando o último estado conhecido</span>
              </p>
            </div>
          ) : null}
          {wol && !on && (
            <p className="note" id={`wol-${device.id}`}>
              <Info className="i i-sm" aria-hidden />
              {wol.replace(/\.$/, "")}
            </p>
          )}
          {notes.map((n) => (
            <p className="note" key={n}>
              <Info className="i i-sm" aria-hidden />
              {n}
            </p>
          ))}
          {loading ? <Skeleton /> : Body && <Body device={device} ctl={ctl} disabled={disabled} inHero />}

          {!loading && device.kind !== "phone" && (
            <Schedules device={device} automations={live.automations} onDialog={(o) => setDialog(o ? "schedule" : null)} />
          )}

          <div className="dt-ft">
            <Link className="auto-lk" to={`/automacoes?aparelho=${encodeURIComponent(device.id)}`}>
              <Workflow className="i" aria-hidden />
              <span>{group ? "Automações que usam este grupo" : "Automações que usam este aparelho"}</span>
              <span className="cnt">{used}</span>
              <ChevronRight className="i i-sm" aria-hidden />
            </Link>
            <p className="upd">
              {[!group && device.vendor_label, seen ? `Atualizado ${seen}` : "Ainda sem resposta desde que a colmeia ligou"].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </Drawer.Content>

      {/* Diálogo aninhado: o Base UI não desenha o véu do diálogo dentro de outro modal; o sheet escurece aqui. */}
      {dialog && <span className="dsh-veil" aria-hidden />}
      <RenameDialog device={device} open={dialog === "rename"} onOpenChange={(o) => setDialog(o ? "rename" : null)} />
      <RoomDialog device={device} rooms={live.rooms} open={dialog === "room"} onOpenChange={(o) => setDialog(o ? "room" : null)} />
      <TimerDialog device={device} open={dialog === "timer"} onOpenChange={(o) => setDialog(o ? "timer" : null)} />
      <Confirm
        open={dialog === "remove"}
        onOpenChange={(o) => setDialog(o ? "remove" : null)}
        title={group ? `Desfazer o grupo ${device.name}?` : `Remover ${device.name}?`}
        description={removeText}
        confirmLabel={group ? "Desfazer grupo" : "Remover"}
        onConfirm={() => void remove()}
        busy={removing}
        cancelRef={cancelRef}
      />
      {edit && (
        <GroupSession
          key={edit.key}
          request={{ edit: device.id }}
          active={edit.active}
          onClose={() => setEdit((e) => e && { ...e, active: false })}
          onGone={() => setEdit(null)}
          onUndoStart={onRemoved}
          onUndone={() => {
            onRemoved();
            onClose();
          }}
          finalFocus={() => menuRef.current}
        />
      )}
    </>
  );
}

/* ---------------- estados ---------------- */

function HeroSkeleton() {
  return (
    <div className="dt-hero" aria-hidden>
      <div className="dt-lead">
        <span className="sk" style={{ width: 64, height: 14 }} />
        <span className="sk dt-sk-sw" />
      </div>
      <span className="sk dt-sk-num" />
      <span className="sk" style={{ width: 120, height: 14 }} />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="dsh-sk" aria-hidden>
      <div className="skc">
        <span className="sk" style={{ width: 64, height: 14 }} />
        <span className="sk sk-ctl" />
      </div>
      <div className="skc">
        <span className="sk" style={{ width: 48, height: 14 }} />
        <span className="sk sk-ctl" />
      </div>
    </div>
  );
}

function Loading({ desktop, titleRef }: { desktop: boolean; titleRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <>
      <HoneyHeader
        variant="detalhe"
        className="dt-fv"
        title={
          <Title titleRef={titleRef}>
            <span className="sr">Carregando aparelho</span>
            <span className="sk dt-sk-t" aria-hidden />
          </Title>
        }
        leading={<CloseBtn desktop={desktop} />}
        actions={<span className="dt-bar-sp" aria-hidden />}
      >
        <HeroSkeleton />
      </HoneyHeader>
      <div className="fv-pg dt-pg" aria-busy>
        <div className="fv-in fv-pg-in dt-bd">
          <Skeleton />
        </div>
      </div>
    </>
  );
}

function NotFound({ desktop, titleRef, onClose }: { desktop: boolean; titleRef: RefObject<HTMLHeadingElement | null>; onClose: () => void }) {
  return (
    <>
      <HoneyHeader
        variant="detalhe"
        className="dt-fv"
        title={<Title titleRef={titleRef}>Aparelho não encontrado</Title>}
        leading={<CloseBtn desktop={desktop} />}
        actions={<span className="dt-bar-sp" aria-hidden />}
      />
      <div className="fv-pg dt-pg">
        <div className="fv-in fv-pg-in dt-bd">
          <div className="empty">
            <p>Ele pode ter sido removido ou o link está errado.</p>
            <button type="button" className="btn btn-sec" onClick={onClose}>
              Voltar ao Início
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * O sheet vai pra dentro do #root (e não do body): o #root isola o empilhamento (isolation: isolate), e o
 * Toaster mora lá dentro. No body, o véu do sheet cobriria o toast de "Tentar de novo".
 */
function portalHost(): HTMLElement | null {
  return document.getElementById("root");
}
