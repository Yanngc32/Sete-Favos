// Tela Automações · Sete Favos (mock exploracao-favos, telas 4 e 5): bloco mel com resumo ao vivo e abas
// Rotinas · Automações · Objetos (FilterPills em modo tabs); cards por tipo de gatilho.
import { Menu } from "@base-ui/react/menu";
import {
  Check,
  CirclePlay,
  Clock,
  Copy,
  Ellipsis,
  House,
  Pencil,
  Play,
  Plus,
  Star,
  Sunrise,
  Sunset,
  ToggleRight,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FilterPills, HexTile, HoneyPage, Swap } from "@/components/favos";
import { Loader } from "@/components/Logo";
import { Confirm, Modal, ModalClose, ModalDescription, ModalTitle } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { kindIcon } from "@/lib/devices";
import { whenShort } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Action, Automation, Device, Routine, RunResult, VirtualObject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { daysPhrase, Frase, partsText, routineSummaryParts, sunOffsetText, triggerParts, type FraseCtx } from "./frase";
import { routineIcon, virtualIcon } from "./icons";
import { useIsMobile } from "./media";
import { automationUsesDevice, fromMin, nextOf, routineUsesDevice, span, whenLabel, type SunTimes } from "./proxima";
import "./automacoes.css";

type Aba = "rotinas" | "automacoes" | "objetos";
const ABAS: Aba[] = ["rotinas", "automacoes", "objetos"];
const ABA_LABEL: Record<Aba, string> = { rotinas: "Rotinas", automacoes: "Automações", objetos: "Objetos virtuais" };

const errMsg = (e: unknown, fallback = "Algo deu errado. Tente de novo.") =>
  e instanceof ApiError ? e.message : fallback;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Some com o valor otimista quando o estado ao vivo alcança. */
function prune(ov: Record<string, boolean>, actual: (id: string) => boolean | undefined) {
  const next = { ...ov };
  let changed = false;
  for (const id of Object.keys(ov)) {
    const a = actual(id);
    if (a === undefined || a === ov[id]) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : ov;
}

function usesOf(v: VirtualObject, automations: Automation[], routines: Routine[]) {
  const inActions = (acts: Action[]) => acts.some((a) => a.type === "virtual" && a.virtual_id === v.id);
  const autos = automations.filter(
    (a) =>
      inActions(a.actions) ||
      (a.trigger.type === "virtual" && a.trigger.virtual_id === v.id) ||
      a.conditions.some((c) => c.type === "virtual_is" && c.virtual_id === v.id),
  );
  const rots = routines.filter((r) => inActions(r.actions));
  return [
    ...autos.map((a) => ({ id: a.id, name: a.name, Icon: Workflow })),
    ...rots.map((r) => ({ id: r.id, name: r.name, Icon: CirclePlay })),
  ];
}

type DelTarget =
  | { kind: "routine"; item: Routine }
  | { kind: "automation"; item: Automation }
  | { kind: "virtual"; item: VirtualObject };

type Grupo = "horario" | "sol" | "presenca" | "estado";
const GRUPOS: { id: Grupo; title: string }[] = [
  { id: "horario", title: "Por horário" },
  { id: "sol", title: "Nascer e pôr do sol" },
  { id: "presenca", title: "Presença" },
  { id: "estado", title: "Quando algo muda" },
];

function grupoOf(a: Automation, devices: Device[]): Grupo {
  const t = a.trigger;
  if (t.type === "time") return "horario";
  if (t.type === "sun") return "sol";
  if (t.type === "device" && devices.find((d) => d.id === t.device_id)?.kind === "phone") return "presenca";
  return "estado";
}

export function Automacoes() {
  const live = useLive();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const raw = params.get("aba") as Aba | null;
  const aba: Aba = raw && ABAS.includes(raw) ? raw : "rotinas";
  const devFilter = params.get("aparelho");
  const fDev = devFilter ? live.devices.find((d) => d.id === devFilter) : undefined;
  const setAba = (v: Aba) => {
    const p = new URLSearchParams(params);
    p.set("aba", v);
    setParams(p, { replace: true });
  };
  const clearFilter = () => {
    const p = new URLSearchParams(params);
    p.delete("aparelho");
    setParams(p, { replace: true });
  };

  const ctx: FraseCtx = { devices: live.devices, virtuals: live.virtuals, routines: live.routines };

  // Valores otimistas (switch, estrela) até o WebSocket confirmar.
  const [enabledOv, setEnabledOv] = useState<Record<string, boolean>>({});
  const [valueOv, setValueOv] = useState<Record<string, boolean>>({});
  const [pinOv, setPinOv] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<Record<string, "run" | "ok">>({});
  const [del, setDel] = useState<DelTarget | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [nameDlg, setNameDlg] = useState<{ mode: "new" } | { mode: "rename"; v: VirtualObject } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Nascer/pôr do sol de hoje (pra "próxima" e pro card de sol) e relógio do resumo.
  const [sun, setSun] = useState<SunTimes | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    api.home.get().then((h) => alive && setSun({ sunrise: h.sunrise, sunset: h.sunset }), () => {});
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setEnabledOv((ov) => prune(ov, (id) => live.automations.find((a) => a.id === id)?.enabled));
  }, [live.automations]);
  useEffect(() => {
    setValueOv((ov) => prune(ov, (id) => live.virtuals.find((v) => v.id === id)?.value));
  }, [live.virtuals]);
  useEffect(() => {
    setPinOv((ov) => prune(ov, (id) => live.routines.find((r) => r.id === id)?.pinned));
  }, [live.routines]);

  const drop = (set: typeof setEnabledOv, id: string) =>
    set((ov) => {
      const next = { ...ov };
      delete next[id];
      return next;
    });

  async function toggleAutomation(a: Automation, next: boolean) {
    setEnabledOv((ov) => ({ ...ov, [a.id]: next }));
    try {
      await api.automations.enable(a.id, next);
      toast({
        id: `en-${a.id}`,
        tone: "ok",
        message: `${a.name} ${next ? "ativada" : "desativada"}`,
        action: { label: "Desfazer", onClick: () => toggleAutomation(a, !next) },
      });
    } catch (e) {
      drop(setEnabledOv, a.id);
      toast({ tone: "error", message: `Não consegui ${next ? "ativar" : "desativar"}`, detail: errMsg(e) });
    }
  }

  async function setVirtual(v: VirtualObject, next: boolean) {
    setValueOv((ov) => ({ ...ov, [v.id]: next }));
    try {
      await api.virtuals.set(v.id, next);
    } catch (e) {
      drop(setValueOv, v.id);
      toast({ tone: "error", message: `Não consegui ${next ? "ligar" : "desligar"} ${v.name}`, detail: errMsg(e) });
    }
  }

  async function pin(r: Routine, next: boolean) {
    setPinOv((ov) => ({ ...ov, [r.id]: next }));
    try {
      await api.routines.pin(r.id, next);
    } catch (e) {
      drop(setPinOv, r.id);
      toast({ tone: "error", message: "Não consegui fixar", detail: errMsg(e) });
    }
  }

  async function pinVirtual(v: VirtualObject) {
    try {
      await api.virtuals.update(v.id, { pinned: !v.pinned });
      toast({ tone: "ok", message: v.pinned ? `${v.name} saiu da Início` : `${v.name} fixado na Início` });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui mudar", detail: errMsg(e) });
    }
  }

  const clearRun = (id: string) =>
    setRunning((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });

  async function run(r: Routine) {
    setRunning((s) => ({ ...s, [r.id]: "run" }));
    try {
      // Um mínimo de spinner: rotina rápida não pisca.
      const [res] = await Promise.all([api.routines.run(r.id), wait(400)]);
      const ok = runToast(r.name, res, `run-${r.id}`);
      if (ok) {
        setRunning((s) => ({ ...s, [r.id]: "ok" }));
        setTimeout(() => clearRun(r.id), 1600);
      } else clearRun(r.id);
    } catch (e) {
      clearRun(r.id);
      toast({
        id: `run-${r.id}`,
        tone: "error",
        message: `Não consegui executar ${r.name}`,
        detail: errMsg(e),
        action: { label: "Tentar de novo", onClick: () => void run(r) },
        duration: 8000,
      });
    }
  }

  async function duplicate(t: { kind: "routine"; item: Routine } | { kind: "automation"; item: Automation }) {
    const name = `${t.item.name} (cópia)`;
    try {
      const created =
        t.kind === "routine"
          ? await api.routines.create({ name, actions: t.item.actions, pinned: false })
          : await api.automations.create({
              name,
              enabled: false,
              trigger: t.item.trigger,
              conditions: t.item.conditions,
              actions: t.item.actions,
            });
      toast({
        tone: "ok",
        message: "Cópia criada",
        detail: t.kind === "automation" ? `${name} · desativada` : name,
        action: { label: "Abrir", onClick: () => navigate(`/automacoes/${created.id}`) },
      });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui duplicar", detail: errMsg(e) });
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setDelBusy(true);
    try {
      if (del.kind === "routine") await api.routines.remove(del.item.id);
      else if (del.kind === "automation") await api.automations.remove(del.item.id);
      else await api.virtuals.remove(del.item.id);
      toast({ tone: "ok", message: `${del.item.name} ${del.kind === "virtual" ? "excluído" : "excluída"}` });
      setDel(null);
    } catch (e) {
      toast({ tone: "error", message: `Não consegui excluir ${del.item.name}`, detail: errMsg(e) });
    } finally {
      setDelBusy(false);
    }
  }

  // Filtro ?aparelho= (vem do detalhe do aparelho): só o que mexe nele, depende dele ou dispara por ele.
  const routines = devFilter ? live.routines.filter((r) => routineUsesDevice(r, devFilter)) : live.routines;
  const automations = devFilter ? live.automations.filter((a) => automationUsesDevice(a, devFilter)) : live.automations;
  const virtuals = live.virtuals;
  const counts: Record<Aba, number> = { rotinas: routines.length, automacoes: automations.length, objetos: virtuals.length };

  // Resumo do bloco: conta todas (não só as do filtro), com o valor otimista do switch.
  const effective = live.automations.map((a) => (a.id in enabledOv ? { ...a, enabled: enabledOv[a.id] } : a));
  const active = effective.filter((a) => a.enabled && !a.incomplete).length;
  const nowD = new Date(now);
  const next = nextOf(effective, nowD, sun);
  const subtitle = !live.loaded ? (
    "Carregando…"
  ) : active === 0 ? (
    "Nenhuma automação ativa"
  ) : (
    <>
      <Swap value={active} /> {active === 1 ? "automação ativa" : "automações ativas"}
      {next && (
        <>
          {" · próxima "}
          <Swap value={whenLabel(next.at, nowD)} />
        </>
      )}
    </>
  );

  const novaRotina = () => navigate("/automacoes/nova-rotina");
  const novaAutomacao = () => navigate("/automacoes/nova-automacao");
  const novoObjeto = () => setNameDlg({ mode: "new" });

  const grouped = GRUPOS.map((g) => ({ ...g, items: automations.filter((a) => grupoOf(a, live.devices) === g.id) })).filter(
    (g) => g.items.length,
  );
  const filterName = fDev?.name ?? "esse aparelho";

  return (
    <HoneyPage
      title="Automações"
      subtitle={subtitle}
      liveSubtitle
      actions={
        <Menu.Root>
          <Menu.Trigger className="ibtn bd" aria-label="Nova">
            <Plus className="i" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="mk aut-pos" align="end" sideOffset={6}>
              <Menu.Popup className="menu aut-menu">
                <MenuBtn Icon={CirclePlay} onClick={novaRotina}>
                  Rotina<small>à mão</small>
                </MenuBtn>
                <MenuBtn Icon={Workflow} onClick={novaAutomacao}>
                  Automação<small>sozinha</small>
                </MenuBtn>
                <MenuBtn Icon={ToggleRight} onClick={novoObjeto}>
                  Objeto virtual<small>liga/desliga</small>
                </MenuBtn>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      }
      headerContent={
        <>
          <FilterPills
            mode="tabs"
            panelId="aut-painel"
            label="Tipo"
            value={aba}
            onChange={setAba}
            options={[
              { value: "rotinas", label: "Rotinas", count: live.loaded ? counts.rotinas : undefined },
              { value: "automacoes", label: "Automações", count: live.loaded ? counts.automacoes : undefined },
              { value: "objetos", label: "Objetos", ariaLabel: "Objetos virtuais", count: live.loaded ? counts.objetos : undefined },
            ]}
          />
          {devFilter && (
            <p className="aut-flt">
              <span>
                Só com <b>{filterName}</b>
              </span>
              <button type="button" className="aut-flt-x" aria-label={`Mostrar tudo, não só ${filterName}`} onClick={clearFilter}>
                <X className="i i-sm" aria-hidden />
              </button>
            </p>
          )}
        </>
      }
      bodyClassName={cn("aut", mobile && "is-m")}
      bodyProps={{ id: "aut-painel", role: "tabpanel", "aria-label": ABA_LABEL[aba] }}
    >
      <div className="aut-pnl" key={aba}>
        {aba === "rotinas" &&
          (!live.loaded ? (
            <Skeleton />
          ) : routines.length === 0 ? (
            devFilter ? (
              <Empty Icon={CirclePlay} title="Nenhuma rotina usa" name={filterName} cta="Nova rotina" onClick={novaRotina} />
            ) : (
              <Empty Icon={CirclePlay} title="Nenhuma rotina" text="Crie uma pra fazer várias coisas com 1 toque." cta="Nova rotina" onClick={novaRotina} />
            )
          ) : (
            <>
              <SecH title="Rotinas" count={routines.length} />
              <div className="aut-lst">
                {routines.map((r) => (
                  <RoutineCard
                    key={r.id}
                    r={r}
                    ctx={ctx}
                    mobile={mobile}
                    pinned={pinOv[r.id] ?? r.pinned}
                    running={running[r.id]}
                    onRun={() => run(r)}
                    onPin={(p) => pin(r, p)}
                    onDuplicate={() => duplicate({ kind: "routine", item: r })}
                    onDelete={() => setDel({ kind: "routine", item: r })}
                  />
                ))}
              </div>
              {!devFilter && virtuals.length > 0 && (
                <>
                  <SecH
                    title="Objetos virtuais"
                    count={virtuals.length}
                    more={
                      <button type="button" className="btn-link" onClick={() => setAba("objetos")}>
                        Ver todos
                      </button>
                    }
                  />
                  <div className="aut-objs">
                    {virtuals.slice(0, 2).map((v) => {
                      const on = valueOv[v.id] ?? v.value;
                      return (
                        <div key={v.id} className={cn("aut-c aut-obj2", on && "on")}>
                          <span className="tx">
                            <b>{v.name}</b>
                            <span>{v.used_by === 0 ? "Não usado" : `Usado em ${v.used_by}`}</span>
                          </span>
                          <button
                            type="button"
                            className="sw"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${on ? "Desligar" : "Ligar"} ${v.name}`}
                            onClick={() => setVirtual(v, !on)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <AddButton onClick={novaRotina}>Nova rotina</AddButton>
            </>
          ))}

        {aba === "automacoes" &&
          (!live.loaded ? (
            <Skeleton tall />
          ) : automations.length === 0 ? (
            devFilter ? (
              <Empty Icon={Workflow} title="Nenhuma automação usa" name={filterName} cta="Nova automação" onClick={novaAutomacao} />
            ) : (
              <Empty
                Icon={Workflow}
                title="Nenhuma automação"
                text="Crie uma pra casa agir sozinha num horário, no pôr do sol ou quando algo mudar."
                cta="Nova automação"
                onClick={novaAutomacao}
              />
            )
          ) : (
            <>
              {grouped.map((g) => (
                <Fragment key={g.id}>
                  <SecH title={g.title} count={g.items.length} />
                  <div className="aut-lst">
                    {g.items.map((a) => (
                      <AutomationCard
                        key={a.id}
                        a={a}
                        ctx={ctx}
                        sun={sun}
                        mobile={mobile}
                        enabled={enabledOv[a.id] ?? a.enabled}
                        onToggle={(v) => toggleAutomation(a, v)}
                        onDuplicate={() => duplicate({ kind: "automation", item: a })}
                        onDelete={() => setDel({ kind: "automation", item: a })}
                      />
                    ))}
                  </div>
                </Fragment>
              ))}
              <AddButton onClick={novaAutomacao}>Nova automação</AddButton>
            </>
          ))}

        {aba === "objetos" &&
          (!live.loaded ? (
            <Skeleton />
          ) : virtuals.length === 0 ? (
            <Empty
              Icon={ToggleRight}
              title="Nenhum objeto virtual"
              text="Crie um liga/desliga, como Modo visita, pra usar nas automações."
              cta="Novo objeto virtual"
              onClick={novoObjeto}
            />
          ) : (
            <>
              <SecH title="Objetos virtuais" count={virtuals.length} />
              <div className="aut-lst">
                {virtuals.map((v) => (
                  <VirtualCard
                    key={v.id}
                    v={v}
                    mobile={mobile}
                    value={valueOv[v.id] ?? v.value}
                    onSet={(x) => setVirtual(v, x)}
                    onRename={() => setNameDlg({ mode: "rename", v })}
                    onPin={() => pinVirtual(v)}
                    onDelete={() => setDel({ kind: "virtual", item: v })}
                  />
                ))}
              </div>
              <AddButton onClick={novoObjeto}>Novo objeto virtual</AddButton>
            </>
          ))}
      </div>

      {/* Excluir: confirmação; objeto em uso não pode ser excluído. */}
      {del?.kind === "virtual" && del.item.used_by > 0 ? (
        <InUse v={del.item} uses={usesOf(del.item, live.automations, live.routines)} onClose={() => setDel(null)} />
      ) : (
        <Confirm
          open={!!del}
          onOpenChange={(o) => !o && !delBusy && setDel(null)}
          title={del ? `Excluir ${del.item.name}?` : ""}
          description={
            del?.kind === "routine"
              ? "A rotina some daqui e da Início. Não dá pra desfazer."
              : del?.kind === "automation"
                ? "A automação para de rodar e some daqui. Não dá pra desfazer."
                : "O objeto some daqui e da Início. Não dá pra desfazer."
          }
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          busy={delBusy}
          cancelRef={cancelRef}
        />
      )}

      <NameDialog state={nameDlg} onClose={() => setNameDlg(null)} onCreated={() => setAba("objetos")} />
    </HoneyPage>
  );
}

/** Toast de rotina executada, com Desfazer por 5 s. Devolve se algo deu certo. */
export function runToast(name: string, res: RunResult, id?: string): boolean {
  const undo = res.succeeded > 0 ? { label: "Desfazer", onClick: () => void undoRun(name, res.id, id) } : undefined;
  if (res.skipped) {
    toast({ id, tone: "info", message: `${name} não rodou`, detail: res.skipped });
    return false;
  }
  if (res.errors.length === 0) {
    toast({
      id,
      tone: "ok",
      message: `${name} executada`,
      detail: res.pending
        ? `${res.succeeded} de ${res.total} ok até agora · o resto roda depois da espera`
        : `${res.succeeded} de ${res.total} ok`,
      action: undo,
      duration: 5000,
    });
    return true;
  }
  const more = res.errors.length > 1 ? ` e mais ${res.errors.length - 1}` : "";
  toast({ id, tone: "error", message: `${res.succeeded} de ${res.total} ok`, detail: `${res.errors[0]}${more}`, action: undo, duration: 8000 });
  return res.succeeded > 0;
}

async function undoRun(name: string, runId: string, id?: string) {
  try {
    const r = await api.runs.undo(runId);
    toast({
      id,
      tone: r.errors.length ? "error" : "ok",
      message: r.errors.length ? `Desfeito em parte` : `${name} desfeita`,
      detail: r.errors[0],
    });
  } catch (e) {
    toast({ id, tone: "error", message: "Não consegui desfazer", detail: errMsg(e) });
  }
}

function MenuBtn({ Icon, onClick, children, danger }: { Icon: LucideIcon; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <Menu.Item render={<button type="button" />} nativeButton className={cn(danger && "dz")} onClick={onClick}>
      <Icon className="i" aria-hidden />
      {children}
    </Menu.Item>
  );
}

function SecH({ title, count, more }: { title: string; count: number; more?: ReactNode }) {
  return (
    <div className="aut-sec">
      <h2>
        {title}
        <span className="cnt">
          <Swap value={count} />
        </span>
      </h2>
      {more}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="aut-add" onClick={onClick}>
      <Plus className="i" aria-hidden />
      {children}
    </button>
  );
}

function Skeleton({ tall }: { tall?: boolean }) {
  const rows = [
    [46, 78],
    [34, 64],
    [52, 70],
  ];
  return (
    <div className="aut-lst" aria-busy="true" aria-label="Carregando">
      <span className="sk aut-sk-h" aria-hidden />
      {rows.map(([a, b], i) => (
        <div className={cn("aut-c aut-sk", tall && "tall")} key={i} aria-hidden>
          <span className="sk aut-sk-hx" />
          <span className="tx">
            <span className="sk" style={{ width: `${a}%`, height: 14 }} />
            <span className="sk" style={{ width: `${b}%`, height: 12 }} />
          </span>
          <span className="sk aut-sk-sw" />
        </div>
      ))}
    </div>
  );
}

function Empty({
  Icon,
  title,
  text,
  name,
  cta,
  onClick,
}: {
  Icon: LucideIcon;
  title: string;
  text?: string;
  name?: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="aut-empty">
      <HexTile icon={Icon} variant="soft" size="xl" />
      <h3>
        {title}
        {name && (
          <>
            {" "}
            <b>{name}</b>
          </>
        )}
      </h3>
      {text && <p>{text}</p>}
      <button type="button" className="btn btn-ico" onClick={onClick}>
        <Plus className="i" aria-hidden />
        {cta}
      </button>
    </div>
  );
}

// Card com deslizar pra excluir (celular) e toque longo / botão direito abrindo o menu ⋯ ----------------

const REVEAL = 80;

interface RowItem {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  sep?: boolean;
}

/** Área que não começa o deslizar/toque longo (botões, switch, ⋯). */
const NO_GESTURE = ".li-a, .swp-x, .inc .btn";

function Row({
  name,
  mobile,
  className,
  menu,
  onDelete,
  children,
  showMore = true,
}: {
  name: string;
  mobile: boolean;
  className?: string;
  menu: RowItem[];
  onDelete: () => void;
  /** Recebe o botão ⋯ pra card colocar onde quiser. */
  children: (more: ReactNode) => ReactNode;
  /** No celular o ⋯ some (toque longo abre o menu), mas segue acessível pelo teclado. */
  showMore?: boolean;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRow, setAnchorRow] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(0);
  xRef.current = x;
  const g = useRef<{ x0: number; y0: number; start: number; mode: "?" | "swipe" | "scroll"; long: boolean; timer: number } | null>(null);
  const suppress = useRef(false);
  const opened = x <= -REVEAL;

  useEffect(() => {
    if (!opened) return;
    const off = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setX(0);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [opened]);

  const openMenu = (fromRow: boolean) => {
    setAnchorRow(fromRow);
    setMenuOpen(true);
  };

  const end = () => {
    const s = g.current;
    if (!s) return;
    clearTimeout(s.timer);
    // Toque longo: abre o menu depois que o dedo sai (senão o próprio soltar conta como "tocar fora").
    if (s.long) window.setTimeout(() => openMenu(true), 60);
    if (s.mode === "swipe") {
      suppress.current = true;
      setX(xRef.current < -REVEAL / 2 ? -REVEAL : 0);
    } else if (s.mode === "?" && !s.long && xRef.current < 0) {
      suppress.current = true;
      setX(0);
    }
    g.current = null;
    setDragging(false);
  };

  const more = (
    <RowMenu
      name={name}
      items={menu}
      open={menuOpen}
      onOpenChange={(o) => {
        setMenuOpen(o);
        if (!o) setAnchorRow(false);
      }}
      anchor={anchorRow ? rowRef : undefined}
      hidden={mobile && !showMore}
      onTrigger={() => setAnchorRow(false)}
    />
  );

  return (
    <div
      ref={rowRef}
      className={cn("rw", opened && "is-open")}
      onPointerDown={(e) => {
        suppress.current = false;
        if (e.pointerType === "mouse") return;
        if ((e.target as HTMLElement).closest(NO_GESTURE)) return;
        g.current = {
          x0: e.clientX,
          y0: e.clientY,
          start: xRef.current,
          mode: "?",
          long: false,
          timer: window.setTimeout(() => {
            const s = g.current;
            if (s && s.mode === "?") {
              s.long = true;
              suppress.current = true;
              navigator.vibrate?.(10);
            }
          }, 500),
        };
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (!s) return;
        const dx = e.clientX - s.x0;
        const dy = e.clientY - s.y0;
        if (s.mode === "?") {
          if (mobile && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            s.mode = "swipe";
            clearTimeout(s.timer);
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            s.mode = "scroll";
            clearTimeout(s.timer);
          }
        }
        if (s.mode === "swipe") setX(Math.max(-REVEAL, Math.min(0, s.start + dx)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={(e) => {
        if (suppress.current) {
          e.preventDefault();
          e.stopPropagation();
          suppress.current = false;
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".li-a")) return;
        e.preventDefault();
        openMenu(true);
      }}
    >
      <div className={cn("aut-c", className, dragging && "is-drag")} style={x ? { transform: `translateX(${x}px)` } : undefined}>
        {children(more)}
      </div>
      {mobile && (
        <button
          type="button"
          className="swp-x"
          tabIndex={opened ? 0 : -1}
          aria-hidden={!opened}
          aria-label={`Excluir ${name}`}
          onClick={() => {
            setX(0);
            onDelete();
          }}
        >
          <Trash2 className="i" aria-hidden />
          Excluir
        </button>
      )}
    </div>
  );
}

function RowMenu({
  name,
  items,
  open,
  onOpenChange,
  anchor,
  hidden,
  onTrigger,
}: {
  name: string;
  items: RowItem[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchor?: RefObject<HTMLElement | null>;
  hidden: boolean;
  onTrigger: () => void;
}) {
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger className={cn("ibtn more", hidden && "more-h")} aria-label={`Mais opções de ${name}`} onPointerDown={onTrigger}>
        <Ellipsis className="i i-sm" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="mk aut-pos" anchor={anchor} align="end" sideOffset={anchor ? -8 : 4}>
          <Menu.Popup className="menu" aria-label={name} finalFocus={anchor ? false : undefined}>
            {items.map((it) => (
              <Fragment key={it.label}>
                {it.sep && <Menu.Separator render={<hr />} />}
                <MenuBtn Icon={it.Icon} onClick={it.onClick} danger={it.danger}>
                  {it.label}
                </MenuBtn>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function RoutineCard({
  r,
  ctx,
  mobile,
  pinned,
  running,
  onRun,
  onPin,
  onDuplicate,
  onDelete,
}: {
  r: Routine;
  ctx: FraseCtx;
  mobile: boolean;
  pinned: boolean;
  running?: "run" | "ok";
  onRun: () => void;
  onPin: (p: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const Icon = routineIcon(r.name);
  const to = `/automacoes/${r.id}`;
  const busy = running === "run";
  return (
    <Row
      name={r.name}
      mobile={mobile}
      showMore={false}
      className={cn("aut-rot", r.incomplete && "is-inc")}
      onDelete={onDelete}
      menu={[
        { label: "Editar", Icon: Pencil, onClick: () => navigate(to) },
        { label: "Duplicar", Icon: Copy, onClick: onDuplicate },
        { label: "Excluir", Icon: Trash2, onClick: onDelete, danger: true, sep: true },
      ]}
    >
      {(more) => (
        <>
          <div className="aut-r">
            <HexTile icon={Icon} variant="soft" size="sm" />
            <div className="tx">
              <Link className="nm" to={to}>
                {r.name}
              </Link>
              <span className="s">
                <Frase parts={routineSummaryParts(r.actions, { ...ctx, incomplete: r.incomplete })} />
              </span>
            </div>
            <div className="li-a">
              <button
                type="button"
                className="ibtn pin"
                aria-pressed={pinned}
                aria-label={pinned ? `Tirar ${r.name} da Início` : `Fixar ${r.name} na Início`}
                title={pinned ? "Fixada na Início" : "Fixar na Início"}
                onClick={() => onPin(!pinned)}
              >
                <Star className="i i-sm" aria-hidden />
              </button>
              <button
                type="button"
                className={cn("aut-run", running === "ok" && "is-ok")}
                aria-busy={busy}
                aria-label={busy ? `Executando ${r.name}` : `Executar ${r.name}`}
                onClick={() => !running && onRun()}
              >
                <span className="ic" key={running ?? "idle"}>
                  {busy ? (
                    <Loader className="i i-sm spin" aria-hidden />
                  ) : running === "ok" ? (
                    <Check className="i i-sm" aria-hidden />
                  ) : (
                    <Play className="i i-sm play" aria-hidden />
                  )}
                </span>
              </button>
              {more}
            </div>
          </div>
          {r.incomplete && <Incomplete text={r.incomplete} to={to} />}
        </>
      )}
    </Row>
  );
}

function Incomplete({ text, to }: { text: string; to: string }) {
  return (
    <div className="inc">
      <span className="t">
        <TriangleAlert className="i i-sm" aria-hidden />
        {text}
      </span>
      <Link className="btn btn-sec btn-sm btn-ico" to={to}>
        <Pencil className="i i-sm" aria-hidden />
        Editar pra corrigir
      </Link>
    </div>
  );
}

/** Última execução (o "desativada" já vai no subtítulo do card). */
function LastRun({ a }: { a: Automation }) {
  const r = a.last_run;
  if (!r) return <p className="li-m">Ainda não rodou</p>;
  if (r.pending) return <p className="li-m num">Rodando desde {whenShort(r.at)}</p>;
  if (r.errors.length || r.skipped) {
    return (
      <p className="li-m num">
        <span className="bad-t">
          <X className="i bad-i" aria-hidden />
          Falhou {whenShort(r.at)}
        </span>
        <span className="why">{r.errors[0] ?? r.skipped}</span>
      </p>
    );
  }
  return (
    <p className="li-m num">
      <span className="ok-t">
        <Check className="i ok-i" aria-hidden />
        Última vez {whenShort(r.at)}
      </span>
      <span className="sr">deu certo</span>
    </p>
  );
}

interface Cell {
  k: string;
  v: string;
  /** Texto (não número): fonte do corpo, sem tabular. */
  w?: boolean;
}

/** Como o gatilho aparece no card: "das 18:30 · até 23:00", "às 7:00 · seg a sex", "do pôr do sol · até 23:30". */
function faceOf(a: Automation, ctx: FraseCtx, sun: SunTimes | null): { Icon: LucideIcon; cells: Cell[]; days: string | null } {
  const t = a.trigger;
  const firstDev = a.actions.find((x) => x.type === "device");
  const dev = firstDev?.type === "device" ? ctx.devices.find((d) => d.id === firstDev.device_id) : undefined;
  if (t.type === "time") {
    const s = span(t, a.actions, sun);
    const start = s.start !== null ? fromMin(s.start) : t.at;
    const Icon = dev ? kindIcon(dev.kind) : Clock;
    if (s.end !== null)
      return { Icon, cells: [{ k: "das", v: start }, { k: "até", v: fromMin(s.end) }], days: daysPhrase(t.days) };
    return { Icon, cells: [{ k: "às", v: start }, { k: "dias", v: daysPhrase(t.days), w: true }], days: null };
  }
  if (t.type === "sun") {
    const ev = t.event === "sunset" ? "pôr do sol" : "nascer do sol";
    const Icon = t.event === "sunset" ? Sunset : Sunrise;
    const s = span(t, a.actions, sun);
    const k = t.offset === 0 ? "no" : `${sunOffsetText(t.offset)} do`;
    const first: Cell = { k: s.end !== null && t.offset === 0 ? "do" : k, v: ev, w: true };
    if (s.end !== null) return { Icon, cells: [first, { k: "até", v: fromMin(s.end) }], days: daysPhrase(t.days) };
    return {
      Icon,
      cells: s.start !== null ? [first, { k: "hoje", v: fromMin(s.start) }] : [first],
      days: daysPhrase(t.days),
    };
  }
  const phrase = partsText(triggerParts(t, ctx)).replace(/^Quando /, "");
  const trigDev = t.type === "device" ? ctx.devices.find((d) => d.id === t.device_id) : undefined;
  const Icon = t.type === "virtual" ? ToggleRight : trigDev?.kind === "phone" ? House : trigDev ? kindIcon(trigDev.kind) : Zap;
  return { Icon, cells: [{ k: "quando", v: phrase, w: true }], days: null };
}

function AutomationCard({
  a,
  ctx,
  sun,
  mobile,
  enabled,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  a: Automation;
  ctx: FraseCtx;
  sun: SunTimes | null;
  mobile: boolean;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const to = `/automacoes/${a.id}`;
  const inc = !!a.incomplete;
  const on = enabled && !inc;
  const face = faceOf(a, ctx, sun);
  const failed = !inc && !!a.last_run && !a.last_run.pending && (a.last_run.errors.length > 0 || !!a.last_run.skipped);
  return (
    <Row
      name={a.name}
      mobile={mobile}
      showMore={false}
      className={cn("aut-ag", on && "on", inc && "is-inc", failed && "is-bad")}
      onDelete={onDelete}
      menu={[
        { label: "Editar", Icon: Pencil, onClick: () => navigate(to) },
        { label: "Duplicar", Icon: Copy, onClick: onDuplicate },
        { label: "Excluir", Icon: Trash2, onClick: onDelete, danger: true, sep: true },
      ]}
    >
      {(more) => (
        <>
          <div className="ag-h">
            <HexTile icon={inc ? TriangleAlert : face.Icon} variant={on ? "on" : "neutral"} size="sm" />
            <div className="tx">
              <Link className="nm" to={to}>
                {a.name}
              </Link>
              <span className="s">
                <Frase parts={routineSummaryParts(a.actions, { ...ctx, incomplete: a.incomplete })} />
                {face.days && ` · ${face.days}`}
                {!enabled && !inc && " · desativada"}
              </span>
            </div>
            <div className="li-a">
              <button
                type="button"
                className="sw"
                role="switch"
                aria-checked={inc ? false : enabled}
                disabled={inc}
                aria-label={inc ? `Ativar ${a.name} (incompleta)` : `${enabled ? "Desativar" : "Ativar"} ${a.name}`}
                onClick={() => onToggle(!enabled)}
              />
            </div>
          </div>
          <div className="ag-b">
            {face.cells.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="ag-vr" aria-hidden />}
                <div className={cn("ag-t", c.w && "w")}>
                  <span>{c.k}</span>
                  <b>{c.v}</b>
                </div>
              </Fragment>
            ))}
            <div className="ag-a li-a">
              <Link className="ibtn" to={to} aria-label={`Editar ${a.name}`}>
                <Pencil className="i i-sm" aria-hidden />
              </Link>
              <button type="button" className="ibtn" aria-label={`Apagar ${a.name}`} onClick={onDelete}>
                <Trash2 className="i i-sm" aria-hidden />
              </button>
              {more}
            </div>
          </div>
          {inc ? <Incomplete text={a.incomplete!} to={to} /> : <LastRun a={a} />}
        </>
      )}
    </Row>
  );
}

function VirtualCard({
  v,
  mobile,
  value,
  onSet,
  onRename,
  onPin,
  onDelete,
}: {
  v: VirtualObject;
  mobile: boolean;
  value: boolean;
  onSet: (x: boolean) => void;
  onRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const Icon = virtualIcon(v.name);
  const used = v.used_by === 0 ? "Não usado" : `Usado em ${v.used_by}`;
  return (
    <Row
      name={v.name}
      mobile={mobile}
      className={cn("aut-vo", value && "on")}
      onDelete={onDelete}
      menu={[
        { label: "Renomear", Icon: Pencil, onClick: onRename },
        { label: v.pinned ? "Tirar da Início" : "Fixar na Início", Icon: Star, onClick: onPin },
        { label: "Excluir", Icon: Trash2, onClick: onDelete, danger: true, sep: true },
      ]}
    >
      {(more) => (
        <div className="aut-r">
          <HexTile icon={Icon} variant={value ? "on" : "neutral"} size="sm" />
          <div className="tx">
            <button type="button" className="nm" onClick={onRename}>
              {v.name}
            </button>
            <span className="s">
              {used}
              {v.pinned && " · na Início"}
            </span>
          </div>
          <div className="li-a">
            {more}
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={value}
              aria-label={`${value ? "Desligar" : "Ligar"} ${v.name}`}
              onClick={() => onSet(!value)}
            />
          </div>
        </div>
      )}
    </Row>
  );
}

function InUse({ v, uses, onClose }: { v: VirtualObject; uses: { id: string; name: string; Icon: LucideIcon }[]; onClose: () => void }) {
  const first = uses[0];
  const n = v.used_by;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalTitle render={<h3 />}>{v.name} não pode ser excluído</ModalTitle>
      <ModalDescription render={<p />}>
        Usado em {plural(n, "automação", "automações")}. Remova antes.
      </ModalDescription>
      {first && (
        <div className="aut-used">
          <Link to={`/automacoes/${first.id}`} onClick={onClose}>
            <first.Icon className="i i-sm" aria-hidden />
            {first.name}
          </Link>
          {uses.length > 1 && <span className="muted">e mais {uses.length - 1}</span>}
        </div>
      )}
      <div className="dlg-act">
        <ModalClose className="btn btn-sec">Entendi</ModalClose>
      </div>
    </Modal>
  );
}

function NameDialog({
  state,
  onClose,
  onCreated,
}: {
  state: { mode: "new" } | { mode: "rename"; v: VirtualObject } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state) {
      setName(state.mode === "rename" ? state.v.name : "");
      setErr(null);
    }
  }, [state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setErr("Dê um nome");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (state?.mode === "rename") {
        await api.virtuals.update(state.v.id, { name: n });
        toast({ tone: "ok", message: "Nome salvo" });
      } else {
        await api.virtuals.create({ name: n });
        toast({ tone: "ok", message: `${n} criado` });
        onCreated();
      }
      onClose();
    } catch (e) {
      setErr(errMsg(e, "Não consegui salvar. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!state} onOpenChange={(o) => !o && !busy && onClose()} initialFocus={inputRef}>
      <form className="aut-nmf" onSubmit={submit} noValidate>
        <div className="aut-nmf-h">
          <HexTile icon={ToggleRight} variant="soft" size="sm" />
          <ModalTitle render={<h3 />}>{state?.mode === "rename" ? "Renomear objeto virtual" : "Novo objeto virtual"}</ModalTitle>
        </div>
        <ModalDescription render={<p />}>Um liga/desliga pra usar nas automações, como Modo visita.</ModalDescription>
        <div className="fld">
          <label htmlFor="vo-nome">Nome</label>
          <div className={cn("inp", err && "is-err")}>
            <input
              id="vo-nome"
              ref={inputRef}
              value={name}
              maxLength={80}
              autoComplete="off"
              placeholder="Ex.: Modo visita"
              aria-invalid={!!err}
              aria-describedby={err ? "vo-err" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
            />
          </div>
          {err && (
            <p className="hint err" id="vo-err">
              <TriangleAlert className="i i-sm" aria-hidden />
              {err}
            </p>
          )}
        </div>
        <div className="dlg-act">
          <ModalClose className="btn btn-sec" type="button">
            Cancelar
          </ModalClose>
          <button type="submit" className="btn btn-ico" disabled={busy} aria-busy={busy}>
            {busy && <Loader className="i i-sm spin" aria-hidden />}
            {state?.mode === "rename" ? "Salvar" : "Criar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
