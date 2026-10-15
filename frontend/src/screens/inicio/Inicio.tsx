// Tela Início · visual "Sete Favos" (mock exploracao-favos, tela 1): bloco mel com a saudação, tempo sobreposto,
// cômodos em favo, rotinas/objetos rápidos e os cards de aparelho (ligados em tinta latão com nível arrastável).
// O Detalhe do aparelho é rota filha (aparelho/:id) e abre por cima desta tela via <Outlet /> (fora do HoneyPage:
// nos 220 ms da entrada o painel tem transform e prenderia o fixed).
import { Pencil, Plus, Search, WifiOff } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, Outlet } from "react-router";
import { HoneyPage, Swap } from "@/components/favos";
import { Loader, Logo } from "@/components/Logo";
import { openSearch } from "@/app/search";
import { cardSpan, resolveLook, sectionSpan, tracksFor } from "@/lib/cardLook";
import { settleCardPrefs, useCardOf } from "@/lib/cardPrefsStore";
import { useDensity } from "@/lib/density";
import { stateText } from "@/lib/devices";
import { useDashboard } from "@/lib/dashboardStore";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MoveDialog, RenameDialog, TimerDialog } from "./CardDialogs";
import { CardLookSheet } from "./CardLookSheet";
import { EnvCtx, type Env } from "./dashboard/env";
import { EditDialogs } from "./dashboard/EditDialogs";
import { PanelEdit } from "./dashboard/PanelEdit";
import { PanelView } from "./dashboard/PanelView";
import { useEditor } from "./dashboard/useEditor";
import { DeviceCard, type CardMenuAction } from "./DeviceCard";
import { countsOn, greeting, groupByRoom, orderRooms, roomStats, useMedia, useStickyOn, useTick } from "./home";
import { Routines, Virtuals } from "./Quick";
import { RoomTiles } from "./Rooms";
import { useWeather, WeatherCard, weatherShown } from "./Weather";
import "./inicio.css";
import "./painel.css";

const ALL = "Todos";
/** Mudança feita por este painel nos últimos 6 s não é anunciada como "veio de fora". */
const LOCAL_WINDOW = 6000;

function Skeleton() {
  const card = (w1: string, w2: string, k: number) => (
    <div className="card skc" key={k}>
      <div className="r">
        <span className="sk ini-sk-hx" />
        <span className="sk ini-sk-sw" />
      </div>
      <span className="sk" style={{ width: w1, height: 14, marginTop: "auto" }} />
      <span className="sk" style={{ width: w2, height: 12 }} />
    </div>
  );
  return (
    <div className="ini-sk" aria-busy="true" aria-label="Carregando a casa">
      <div className="ini-sk-l">
        <Loader className="i i-lg spin" aria-hidden />
        <span>Carregando os aparelhos…</span>
      </div>
      <div className="ini-sk-cm" aria-hidden>
        {[0, 1, 2, 3].map((k) => (
          <span className="sk" key={k} />
        ))}
      </div>
      <div className="devs">
        {card("70%", "45%", 1)}
        {card("62%", "50%", 2)}
        {card("66%", "40%", 3)}
        {card("58%", "48%", 4)}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty ini-empty">
      <span className="ini-empty-l" aria-hidden>
        <Logo className="i" vazio />
      </span>
      <h3>A colmeia está vazia</h3>
      <p>Adicione o primeiro aparelho: cada um vira um favo que você controla daqui.</p>
      <Link className="btn btn-ico" to="/dispositivos/novo">
        <Plus className="i" aria-hidden />
        Adicionar aparelho
      </Link>
    </div>
  );
}

/** Quantas colunas a grade de cards tem agora (mesma conta do auto-fill do CSS); celular estreito = 2. */
function useTracks(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  const { density } = useDensity();
  const [tracks, setTracks] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const min = Number.parseFloat(cs.getPropertyValue("--density-card-min"));
      const gap = Number.parseFloat(cs.getPropertyValue("--density-card-gap"));
      const w = el.clientWidth;
      setTracks(w < 600 ? 2 : tracksFor(w, min, gap));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, density]);
  return tracks;
}

/** Ordem dentro de um grupo: fixados, depois o herói (ar), depois o resto por cômodo. */
function flatOrder(devices: Device[], rooms: string[]) {
  const roomIdx = (d: Device) => (d.room && rooms.includes(d.room) ? rooms.indexOf(d.room) : rooms.length);
  return [...devices].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      Number(b.kind === "ac") - Number(a.kind === "ac") ||
      roomIdx(a) - roomIdx(b),
  );
}

function SecHead({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="ini-sh">
      <h2>
        {title}
        {count !== undefined && (
          <span className="cnt num">
            <Swap value={count} />
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function Inicio() {
  const { devices, rooms, virtuals, routines, connection, offlineSince, loaded } = useLive();
  const desktop = useMedia("(min-width: 1024px)");
  const now = useTick(20_000);
  const [room, setRoom] = useState(() => sessionStorage.getItem("inicio.room") ?? ALL);
  const [dlg, setDlg] = useState<{ device: Device; action: CardMenuAction } | null>(null);
  const [lookId, setLookId] = useState<string | null>(null);
  const openMenu = useCallback((device: Device, action: CardMenuAction) => {
    if (action === "customize") setLookId(device.id);
    else setDlg({ device, action });
  }, []);
  const [announce, setAnnounce] = useState("");
  const local = useRef(new Map<string, number>());
  const lastTexts = useRef<Map<string, string> | null>(null);
  const weather = useWeather(connection === "online");

  const dash = useDashboard();
  const editor = useEditor(dash, { devices, rooms, routines, virtuals });
  const ready = loaded && dash.status !== "loading";
  /** Painel que a pessoa montou (null = vale o automático, um bloco por cômodo). */
  const custom = dash.data && !dash.data.auto && dash.data.views.length > 0 ? dash.data.views : null;

  const out = connection === "offline" && loaded;
  const stale = out ? (offlineSince ? ago(offlineSince, now) : "último valor") : null;
  const ordered = useMemo(() => orderRooms(rooms, devices), [rooms, devices]);
  const stats = useMemo(() => roomStats(ordered, devices), [ordered, devices]);
  // Cômodo salvo que ficou sem aparelho não tem favo: volta pra "Casa toda" (senão nenhum favo é focável).
  const current = room === ALL || stats.some((r) => r.name === room) ? room : ALL;
  const stickyOn = useStickyOn(devices, current);

  const cardOf = useCardOf();
  const gridRef = useRef<HTMLDivElement>(null);
  // Rascunho do card (tamanho/o que mostra) confirmado pela colmeia: solta.
  useEffect(() => settleCardPrefs(devices), [devices]);

  const pickRoom = (r: string) => {
    setRoom(r);
    sessionStorage.setItem("inicio.room", r);
  };

  const markLocal = useCallback((id: string) => local.current.set(id, Date.now()), []);

  // Leitor de tela: anuncia o que mudou por fora (app do fabricante, automação, outro aparelho).
  useEffect(() => {
    if (!loaded) return;
    const texts = new Map(devices.map((d) => [d.id, stateText(d)]));
    const prev = lastTexts.current;
    lastTexts.current = texts;
    if (!prev) return;
    const t = Date.now();
    const changed = devices.filter((d) => {
      const before = prev.get(d.id);
      return before !== undefined && before !== texts.get(d.id) && t - (local.current.get(d.id) ?? 0) > LOCAL_WINDOW;
    });
    if (changed.length) setAnnounce(changed.map((d) => `${d.name}: ${texts.get(d.id) || "atualizado"}`).join(". "));
  }, [devices, loaded]);

  const fixedRoutines = useMemo(() => routines.filter((r) => r.pinned).slice(0, 6), [routines]);
  const fixedVirtuals = useMemo(() => virtuals.filter((v) => v.pinned), [virtuals]);
  const onCount = devices.filter(countsOn).length;
  const hello = greeting(new Date(now));

  const card = (d: Device) => (
    <DeviceCard
      key={d.id}
      device={d}
      stale={stale}
      compact={!desktop}
      onLocal={markLocal}
      onMenu={openMenu}
      now={now}
    />
  );

  const hive =
    connection === "online"
      ? "colmeia conectada"
      : connection === "offline"
        ? `colmeia fora (${stale ?? "último valor"})`
        : connection === "unauthorized"
          ? "sem acesso à colmeia"
          : "conectando à colmeia…";
  const subtitle = !ready ? (
    hive
  ) : (
    <>
      {onCount === 0 ? (
        "Tudo desligado"
      ) : (
        <>
          <Swap value={onCount} /> {onCount === 1 ? "ligado" : "ligados"}
        </>
      )}
      {" · "}
      <span className={cn(connection === "offline" && "ini-s-warn")}>{hive}</span>
    </>
  );

  const banner = out ? (
    <div className="banner ini-banner" role="status">
      <WifiOff className="i" aria-hidden />
      <span>Sem conexão com a colmeia. Tentando reconectar…</span>
      <Loader className="i spin ini-banner-spin" aria-hidden />
    </div>
  ) : null;

  const env = useMemo<Env>(
    () => ({
      devices,
      routines,
      virtuals,
      rooms: ordered,
      stale,
      online: connection === "online",
      compact: !desktop,
      now,
      onLocal: markLocal,
      onMenu: openMenu,
      dropCard: (id) => void editor.dropCard(id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices, routines, virtuals, ordered, stale, connection, desktop, now, markLocal, openMenu, editor.dropCard],
  );

  const canEdit = ready && Boolean(dash.data);
  const actions = (
    <>
      {canEdit &&
        (desktop ? (
          <button type="button" className="btn btn-sm btn-ico ini-edit" onClick={editor.request}>
            <Pencil className="i i-sm" aria-hidden />
            Editar painel
          </button>
        ) : (
          <button type="button" className="ibtn bd" aria-label="Editar painel" onClick={editor.request}>
            <Pencil className="i" aria-hidden />
          </button>
        ))}
      {!desktop && (
        <button type="button" className="ibtn bd" aria-label="Buscar" onClick={openSearch}>
          <Search className="i" aria-hidden />
        </button>
      )}
    </>
  );

  const quickDisabled = connection !== "online";

  // ---- lista de aparelhos (painel automático) ----
  // Grade que se adapta: colunas de --density-card-min; cada bloco de cômodo ocupa a soma dos seus cards (subgrid),
  // então cômodos pequenos dividem a linha e todos os cards ficam alinhados na mesma grade.
  const autoGrid = ready && !custom && devices.length > 0;
  const tracks = useTracks(gridRef, autoGrid);
  const spanOfGroup = (list: Device[], lead: boolean): CSSProperties => {
    if (lead || !desktop) return { gridColumn: "1 / -1" };
    const spans = list.map((d) => cardSpan(d, resolveLook(cardOf(d)).size).cols);
    return { gridColumn: `span ${sectionSpan(spans, tracks)}` };
  };
  let content: ReactNode = null;
  if (ready && !custom) {
    if (devices.length === 0) {
      content = <Empty />;
    } else if (current !== ALL) {
      const list = flatOrder(
        devices.filter((d) => d.room === current),
        ordered,
      );
      content = (
        <div className="ini-grps" ref={gridRef} style={{ "--tracks": tracks } as CSSProperties}>
          <section className="ini-grp" aria-label={current} style={{ gridColumn: "1 / -1" }}>
            <SecHead title={current} count={list.length} />
            {list.length ? <div className="devs">{list.map(card)}</div> : <p className="ini-none">Nenhum aparelho em {current}.</p>}
          </section>
        </div>
      );
    } else {
      const pinned = flatOrder(
        devices.filter((d) => d.pinned),
        ordered,
      );
      const lit = flatOrder(
        devices.filter((d) => !d.pinned && stickyOn.has(d.id)),
        ordered,
      );
      const rest = devices.filter((d) => !d.pinned && !stickyOn.has(d.id));
      const groups = [
        ...(pinned.length ? [{ name: "Fixados", devices: pinned, count: pinned.length, lead: true }] : []),
        ...(lit.length ? [{ name: "Ligados", devices: lit, count: lit.filter(countsOn).length, lead: true }] : []),
        ...groupByRoom(ordered, rest).map((g) => ({ ...g, devices: flatOrder(g.devices, ordered), count: g.devices.length, lead: false })),
      ];
      content = (
        <div className="ini-grps" ref={gridRef} style={{ "--tracks": tracks } as CSSProperties}>
          {groups.map((g) => {
            return (
              <section className="ini-grp" style={spanOfGroup(g.devices, g.lead)} key={g.name} aria-label={g.name}>
                <SecHead
                  title={g.name}
                  count={g.count}
                  action={
                    g.name === "Ligados" ? (
                      <Link className="btn-link" to="/dispositivos">
                        Ver todos
                      </Link>
                    ) : undefined
                  }
                />
                <div className="devs">{g.devices.map(card)}</div>
              </section>
            );
          })}
        </div>
      );
    }
  }

  const hasQuick = fixedRoutines.length > 0 || fixedVirtuals.length > 0;
  const showWx = ready && !editor.editing && weatherShown(weather);

  const body = !ready ? (
    <Skeleton />
  ) : custom ? (
    <>
      {showWx && <WeatherCard st={weather} now={now} className="fv-lift" />}
      {banner}
      <PanelView views={custom} desktop={desktop} />
    </>
  ) : (
    <>
      {showWx && <WeatherCard st={weather} now={now} className="fv-lift" />}
      {banner}
      {hasQuick && (
        <section className="ini-quick" aria-label="Atalhos">
          {fixedRoutines.length > 0 && (
            <div className="ini-q">
              <SecHead
                title="Rotinas"
                action={
                  <Link className="btn-link" to="/automacoes">
                    Ver todas
                  </Link>
                }
              />
              <Routines routines={fixedRoutines} disabled={quickDisabled} />
            </div>
          )}
          {fixedVirtuals.length > 0 && (
            <div className="ini-q">
              <SecHead title="Objetos" />
              <Virtuals virtuals={fixedVirtuals} disabled={quickDisabled} />
            </div>
          )}
        </section>
      )}
      {devices.length > 0 && (
        <section className="ini-cms" aria-label="Cômodos">
          <SecHead
            title="Cômodos"
            action={
              <Link className="btn-link" to="/dispositivos">
                Ver todos
              </Link>
            }
          />
          <RoomTiles all={ALL} stats={stats} total={devices.length} totalOn={onCount} value={current} onChange={pickRoom} />
        </section>
      )}
      {content}
    </>
  );

  const page = editor.editing ? (
    <PanelEdit editor={editor} desktop={desktop} canReset={dash.data ? !dash.data.auto : false} />
  ) : (
    <HoneyPage
      variant="hero"
      brand
      title={hello}
      subtitle={subtitle}
      liveSubtitle
      actions={actions}
      lift={showWx}
      width="wide"
      className="ini-page"
      bodyClassName={cn("ini", desktop ? "ini-d" : "ini-m")}
    >
      {body}
    </HoneyPage>
  );

  return (
    <EnvCtx.Provider value={env}>
      {page}
      <p className="sr" aria-live="polite">
        {announce}
      </p>
      <RenameDialog device={dlg?.action === "rename" ? dlg.device : null} onClose={() => setDlg(null)} />
      <MoveDialog device={dlg?.action === "move" ? dlg.device : null} rooms={ordered} onClose={() => setDlg(null)} />
      <TimerDialog device={dlg?.action === "timer" ? dlg.device : null} onClose={() => setDlg(null)} />
      <CardLookSheet device={lookId ? (devices.find((d) => d.id === lookId) ?? null) : null} desktop={desktop} now={now} onClose={() => setLookId(null)} />
      <EditDialogs editor={editor} />
      <Outlet />
    </EnvCtx.Provider>
  );
}

