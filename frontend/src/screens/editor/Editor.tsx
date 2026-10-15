// Editor de automação/rotina · Sete Favos: bloco mel compacto (voltar · título · salvar) com o nome no bloco;
// no painel, a frase Quando · Se · Então em blocos com favo, resumo ao vivo e Testar agora.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Check, ChevronLeft, CircleAlert, CloudAlert, Pencil, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { HoneyPage } from "@/components/favos";
import { Loader } from "@/components/Logo";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { Action, RunResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { automationParts, Frase, routineSentenceParts } from "@/screens/automacoes/frase";
import { useIsMobile } from "@/screens/automacoes/media";
import { actionSpoken, EntaoBlock, QuandoBlock, SeBlock } from "./blocks";
import {
  automationBody,
  blank,
  changesText,
  firstError,
  fromAutomation,
  fromRoutine,
  hasErrors,
  routineBody,
  snapshot,
  validate,
  type Draft,
} from "./model";
import "./editor.css";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Algo deu errado. Tente de novo.");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Editor() {
  const { id = "" } = useParams();
  const live = useLive();
  const navigate = useNavigate();
  const mobile = useIsMobile();

  const isNew = id === "nova-rotina" || id === "nova-automacao";
  const routine = live.routines.find((r) => r.id === id);
  const automation = live.automations.find((a) => a.id === id);
  const source = routine ?? automation;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ res: RunResult; names: string[] | null; at: number } | null>(null);
  const [conflict, setConflict] = useState(false);
  const allowNav = useRef(false);

  // Rascunho nasce uma vez (atualizações ao vivo do mesmo item não apagam o que está sendo editado).
  useEffect(() => {
    if (draft) return;
    let d: Draft | null = null;
    if (id === "nova-rotina") d = blank("routine");
    else if (id === "nova-automacao") d = blank("automation");
    else if (routine) d = fromRoutine(routine);
    else if (automation) d = fromAutomation(automation);
    if (d) {
      setDraft(d);
      setBase(structuredClone(d));
    }
  }, [id, routine, automation, draft]);

  // Conflito: o item mudou em outro aparelho. Sem mudança local, pega a versão nova calado; com mudança, avisa.
  const remote = useMemo(
    () => (routine ? snapshot(fromRoutine(routine)) : automation ? snapshot(fromAutomation(automation)) : null),
    [routine, automation],
  );
  useEffect(() => {
    if (!remote || !draft || !base || isNew || saving) return;
    if (remote === snapshot(base)) {
      setConflict(false);
      return;
    }
    if (remote === snapshot(draft)) {
      setBase(structuredClone(draft));
      setConflict(false);
      return;
    }
    if (snapshot(draft) === snapshot(base)) adoptRemote();
    else setConflict(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, base, saving]);
  function adoptRemote() {
    const d = routine ? fromRoutine(routine) : automation ? fromAutomation(automation) : null;
    if (!d) return;
    setDraft(d);
    setBase(structuredClone(d));
    setConflict(false);
  }
  /** Foi excluída em outro aparelho enquanto estava aberta: salvar cria de novo. */
  const gone = !isNew && live.loaded && !source && !!draft;

  const look = useMemo(
    () => ({ devices: live.devices, virtuals: live.virtuals, routines: live.routines }),
    [live.devices, live.virtuals, live.routines],
  );
  const selfId = isNew ? null : id;
  const errors = useMemo(() => (draft ? validate(draft, look, selfId) : null), [draft, look, selfId]);
  const dirty = !!draft && !!base && snapshot(draft) !== snapshot(base);
  const invalid = !!errors && hasErrors(errors);
  const show = dirty; // erros aparecem no campo depois da primeira mudança
  const kind = draft?.kind ?? (id === "nova-rotina" || routine ? "routine" : "automation");
  const backTo = `/automacoes?aba=${kind === "routine" ? "rotinas" : "automacoes"}`;

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !allowNav.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Celular: o rodapé fixo (resumo + Testar) empurra os toasts para cima.
  const footRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = footRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--edt-foot");
      return;
    }
    const ro = new ResizeObserver(() => root.style.setProperty("--edt-foot", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--edt-foot");
    };
  }, [mobile, draft === null]);

  const back = (
    <Link className="ibtn bd" to={backTo} aria-label="Voltar para Automações">
      <ChevronLeft className="i" aria-hidden />
    </Link>
  );
  const heading = isNew ? (kind === "routine" ? "Nova rotina" : "Nova automação") : kind === "routine" ? "Rotina" : "Automação";

  if (!draft) {
    if (live.loaded && !isNew && !source)
      return (
        <HoneyPage variant="detalhe" title="Automação" leading={back} bodyClassName="edt">
          <div className="edt-empty">
            <h3>Não encontrei essa automação</h3>
            <p>Ela pode ter sido excluída.</p>
            <Link className="btn btn-sec" to="/automacoes">
              Voltar para Automações
            </Link>
          </div>
        </HoneyPage>
      );
    return (
      <HoneyPage
        variant="detalhe"
        title={heading}
        leading={back}
        headerContent={<span className="sk edt-nm-sk" aria-hidden />}
        bodyClassName="edt"
        bodyProps={{ "aria-busy": true }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="blk card" aria-hidden>
            <span className="sk" style={{ width: 120, height: 20 }} />
            <span className="sk" style={{ width: "100%", height: 44 }} />
          </div>
        ))}
      </HoneyPage>
    );
  }

  const upd = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));
  const placeholder = draft.kind === "routine" ? "Nova rotina" : "Nova automação";
  const label = draft.kind === "routine" ? "Nome da rotina" : "Nome da automação";
  const createMode = isNew || gone;

  async function save() {
    if (!draft || saving) return;
    const current = draft;
    setSaving(true);
    try {
      const [saved] = await Promise.all([
        current.kind === "routine"
          ? createMode
            ? api.routines.create(routineBody(current))
            : api.routines.update(id, routineBody(current))
          : createMode
            ? api.automations.create(automationBody(current))
            : api.automations.update(id, automationBody(current)),
        wait(350),
      ]);
      setBase(structuredClone(current));
      setConflict(false);
      const wasIncomplete = !!(automation?.incomplete && current.kind === "automation" && !current.enabled);
      toast({
        tone: "ok",
        message: "Salva",
        detail: wasIncomplete ? "Ela segue desativada. Ative na lista quando quiser." : undefined,
      });
      if (createMode) {
        allowNav.current = true;
        navigate(`/automacoes/${saved.id}`, { replace: true });
        requestAnimationFrame(() => (allowNav.current = false));
      }
    } catch (e) {
      toast({
        id: "save-err",
        tone: "error",
        message: "Não consegui salvar.",
        detail: errMsg(e),
        duration: 0,
        action: { label: "Tentar de novo", onClick: () => save() },
      });
    } finally {
      setSaving(false);
    }
  }

  /** Descartar na hora (volta ao salvo), com Desfazer. */
  function discard() {
    if (!draft || !base) return;
    const was = draft;
    const hadConflict = conflict;
    // Com conflito, "descartar" é ficar com a versão nova (senão salvar depois gravaria a velha por cima).
    if (conflict) adoptRemote();
    else setDraft(structuredClone(base));
    const undo = () => {
      setDraft(was);
      if (hadConflict) setConflict(true);
    };
    toast({ id: "discard", tone: "info", message: "Alterações descartadas", action: { label: "Desfazer", onClick: undo } });
  }

  const testable = draft.actions.filter((a) => !errors?.actions[a._k]);
  async function runTest() {
    if (!testable.length || testing) return;
    setTesting(true);
    try {
      const acts = testable.map(({ _k, ...rest }) => rest as Action);
      const [res] = await Promise.all([api.actions.test(acts), wait(350)]);
      // Sem rotina no meio, cada passo é uma ação (esperas são puladas): usa o nome da frase ("Luz da sala · Desligar").
      const plain = acts.filter((a) => a.type !== "delay");
      const names =
        !plain.some((a) => a.type === "routine") && plain.length === res.steps.length ? plain.map((a) => actionSpoken(a, look)) : null;
      setTest({ res, names, at: Date.now() });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui testar", detail: errMsg(e) });
    } finally {
      setTesting(false);
    }
  }

  const parts =
    draft.kind === "routine"
      ? routineSentenceParts(draft.actions, look)
      : automationParts(draft, { ...look, incomplete: automation?.incomplete });
  const why = show && invalid && errors ? firstError(errors) : null;
  const saveDisabled = !dirty || invalid || saving;
  const testBtn = (
    <button type="button" className="btn btn-sec btn-ico" onClick={runTest} disabled={!testable.length} aria-busy={testing}
      title={testable.length ? undefined : "Adicione uma ação completa pra testar"}>
      <span className="edt-ic" key={testing ? "t" : "i"}>
        {testing ? <Loader className="i spin" aria-hidden /> : <Play className="i" aria-hidden />}
      </span>
      {testing ? "Testando" : "Testar agora"}
    </button>
  );
  const summary = (
    <p aria-live="polite">
      <span className="k">Resumo</span>
      <Frase parts={parts} />
    </p>
  );

  return (
    <HoneyPage
      variant="detalhe"
      title={heading}
      leading={back}
      actions={
        <button
          type="button"
          className={cn("btn", mobile && "btn-sm", "edt-save")}
          disabled={saveDisabled && !saving}
          aria-disabled={saving || undefined}
          aria-busy={saving}
          aria-describedby={show && errors?.name ? "nm-err" : why ? "why" : undefined}
          onClick={save}
        >
          {saving && <Loader className="i i-sm spin" aria-hidden />}
          {saving ? "Salvando" : "Salvar"}
        </button>
      }
      headerContent={
        <>
          <label className={cn("edt-nm", show && errors?.name && "is-err")}>
            <span className="sr">{label}</span>
            <input
              value={draft.name}
              placeholder={placeholder}
              maxLength={80}
              aria-invalid={(show && !!errors?.name) || undefined}
              aria-describedby={show && errors?.name ? "nm-err" : undefined}
              onChange={(e) => upd((d) => ({ ...d, name: e.target.value }))}
            />
            <Pencil className="i i-sm" aria-hidden />
          </label>
          <div className="edt-st" aria-live="polite">
            {show && errors?.name ? (
              <span className="why" id="nm-err">
                <CircleAlert className="i i-sm" aria-hidden />
                {errors.name}
              </span>
            ) : why ? (
              <span className="why" id="why">
                <CircleAlert className="i i-sm" aria-hidden />
                {why}
              </span>
            ) : dirty ? (
              <span>Alterações não salvas</span>
            ) : (
              <span>{isNew ? "Dê um nome e monte a frase" : "Tudo salvo"}</span>
            )}
            {dirty && (
              <button type="button" className="btn-link edt-disc" onClick={discard}>
                <RotateCcw className="i i-sm" aria-hidden />
                Descartar
              </button>
            )}
          </div>
        </>
      }
      bodyClassName={cn("edt", mobile && "is-m")}
    >
      {gone && (
        <p className="banner edt-b">
          <CloudAlert className="i i-sm" aria-hidden />
          <span>Foi excluída em outro aparelho. Salvar cria de novo.</span>
        </p>
      )}
      {conflict && !gone && (
        <div className="banner edt-b" role="status">
          <CloudAlert className="i i-sm" aria-hidden />
          <span>Mudou em outro aparelho enquanto você editava.</span>
          <span className="edt-b-a">
            <button type="button" className="btn btn-sec btn-sm" onClick={adoptRemote}>
              Usar a versão nova
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConflict(false)}>
              Manter a minha
            </button>
          </span>
        </div>
      )}
      {automation?.incomplete && (
        <p className="banner inc-b">
          <TriangleAlert className="i i-sm" aria-hidden />
          {automation.incomplete}. Troque o aparelho e salve.
        </p>
      )}
      {routine?.incomplete && (
        <p className="banner inc-b">
          <TriangleAlert className="i i-sm" aria-hidden />
          {routine.incomplete}. Troque o aparelho e salve.
        </p>
      )}

      {draft.kind === "automation" && (
        <>
          <QuandoBlock d={draft} upd={upd} look={look} err={show ? errors?.trigger : undefined} />
          <SeBlock d={draft} upd={upd} look={look} errs={show ? errors!.conditions : null} />
        </>
      )}
      <EntaoBlock d={draft} upd={upd} look={look} errs={show ? errors!.actions : null}
        noActions={show ? errors?.noActions : undefined} selfId={selfId} />

      {!mobile && (
        <div className="sumbar">
          {summary}
          {testBtn}
        </div>
      )}

      {/* Fixos ficam fora do painel (a entrada do painel usa transform). */}
      {mobile &&
        createPortal(
          <div className="edt-foot" ref={footRef}>
            {summary}
            {testBtn}
          </div>,
          document.body,
        )}
      {test && createPortal(<TestToast key={test.at} res={test.res} names={test.names} onClose={() => setTest(null)} />, document.body)}

      <DiscardDialog
        open={blocker.state === "blocked"}
        text={draft && base ? changesText(draft, base) : ""}
        onStay={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    </HoneyPage>
  );
}

/** Toast do "Testar agora": uma linha por ação, ✓/✗. */
function TestToast({ res, names, onClose }: { res: RunResult; names: string[] | null; onClose: () => void }) {
  const allOk = res.errors.length === 0;
  useEffect(() => {
    const t = setTimeout(onClose, allOk ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [allOk, onClose]);
  return (
    <div className="edt-toast">
      <div className="toast tst" role={allOk ? "status" : "alert"}>
        <div className="tst-h">
          {allOk ? <Check className="i ok" aria-hidden /> : <TriangleAlert className="i bad" aria-hidden />}
          <p className="msg num">
            Teste: {res.succeeded} de {res.total} ok
          </p>
          <button type="button" className="act x" aria-label="Fechar" onClick={onClose}>
            <X className="i i-sm" aria-hidden />
          </button>
        </div>
        {res.steps.length > 0 && (
          <ul>
            {res.steps.map((s, i) => {
              const name = s.label.split(" · ")[0];
              const why = s.error?.startsWith(`${name} `) ? s.error.slice(name.length + 1) : s.error;
              return (
                <li key={i} className={cn(!s.ok && "no")}>
                  {s.ok ? <Check className="i ok" aria-hidden /> : <X className="i" aria-hidden />}
                  <span className="tl">{names?.[i] ?? s.label}</span>
                  {s.ok ? <span className="sr">ok</span> : <small>{why}</small>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DiscardDialog({ open, text, onStay, onDiscard }: { open: boolean; text: string; onStay: () => void; onDiscard: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal open={open} onOpenChange={(o) => !o && onStay()} alert initialFocus={stayRef}>
      <AlertDialog.Title render={<h3 />}>Descartar alterações?</AlertDialog.Title>
      <AlertDialog.Description render={<p />}>{text}</AlertDialog.Description>
      <div className="dlg-act">
        <button type="button" ref={stayRef} className="btn btn-sec" onClick={onStay}>
          Continuar editando
        </button>
        <button type="button" className="btn btn-danger" onClick={onDiscard}>
          Descartar
        </button>
      </div>
    </Modal>
  );
}
