// Sessão de edição do painel: o rascunho, as perguntas (personalizar, descartar, voltar ao automático, conflito) e o salvar.
// A edição trabalha numa cópia e só vira PUT em Concluir, com a versão (`rev`) em que começou.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { toast } from "@/components/toast";
import { ApiError, api } from "@/lib/api";
import { fromAuto, removeCard, sameViews } from "@/lib/dashboard";
import { dashboardStore, type DashState } from "@/lib/dashboardStore";
import type { DashView, Device, Routine, VirtualObject } from "@/lib/types";

export type Ask = "personalizar" | "descartar" | "voltar" | "conflito" | null;

interface Session {
  draft: DashView[];
  /** Como estava quando a edição começou (pra saber se mudou algo). */
  base: DashView[];
  /** Versão do painel na central quando a edição começou. */
  baseRev: number;
  /** Veio do painel automático: Concluir tem que salvar mesmo sem outra mudança. */
  fromAuto: boolean;
}

interface Source {
  devices: Device[];
  rooms: string[];
  routines: Routine[];
  virtuals: VirtualObject[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Dentro da Início (ela e o detalhe de um aparelho): ir pra lá não perde a edição. */
const staysHome = (pathname: string) => pathname === "/" || pathname.startsWith("/aparelho/");

export function useEditor(dash: DashState, src: Source) {
  const [session, setSession] = useState<Session | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  /** Versão de outro aparelho que a pessoa já viu e escolheu ignorar ("Continuar editando"). */
  const [dismissed, setDismissed] = useState<number | null>(null);

  const dirty = !!session && !sameViews(session.draft, session.base);
  const needsSave = !!session && (session.fromAuto || dirty);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const draftRef = useRef<DashView[]>([]);
  draftRef.current = session?.draft ?? [];

  const serverRev = dash.data?.rev ?? null;
  /** Outro aparelho salvou enquanto esta pessoa edita (não vale durante o próprio salvamento). */
  const changedElsewhere = !!session && !saving && serverRev !== null && serverRev !== session.baseRev && serverRev !== dismissed;

  const blocker = useBlocker(useCallback(({ nextLocation }: { nextLocation: { pathname: string } }) => dirtyRef.current && !staysHome(nextLocation.pathname), []));
  useEffect(() => {
    if (blocker.state === "blocked") setAsk("descartar");
  }, [blocker.state]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const end = useCallback(() => {
    setSession(null);
    setAsk(null);
    setConflictRev(null);
    setDismissed(null);
  }, []);

  const begin = useCallback(
    (auto: boolean) => {
      const data = dash.data;
      if (!data) return;
      const views = auto ? fromAuto(src.devices, src.rooms, src.routines, src.virtuals) : clone(data.views);
      setSession({ draft: views, base: clone(views), baseRev: data.rev, fromAuto: auto });
      setAsk(null);
    },
    [dash.data, src.devices, src.rooms, src.routines, src.virtuals],
  );

  /** Botão "Editar painel": painel automático pergunta antes; o personalizado entra direto. */
  const request = useCallback(() => {
    if (!dash.data) return;
    if (dash.data.auto) setAsk("personalizar");
    else begin(false);
  }, [dash.data, begin]);

  const patch = useCallback((fn: (views: DashView[]) => DashView[]) => {
    setSession((s) => (s ? { ...s, draft: fn(s.draft) } : s));
  }, []);

  const save = useCallback(
    async (overrideRev?: number) => {
      if (!session || saving) return;
      if (!needsSave) return end();
      setSaving(true);
      try {
        const res = await api.dashboard.save(session.draft, overrideRev ?? session.baseRev);
        dashboardStore.apply(res);
        end();
        toast({ tone: "ok", message: "Painel salvo" });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === "conflito") {
          setConflictRev(Number(e.data?.rev ?? 0));
          setAsk("conflito");
        } else {
          toast({
            id: "painel-salvar",
            tone: "error",
            message: "Não consegui salvar o painel",
            detail: e instanceof Error ? e.message : undefined,
            action: { label: "Tentar de novo", onClick: () => void save() },
            duration: 8000,
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [session, saving, needsSave, end],
  );

  const cancel = useCallback(() => {
    if (dirty) setAsk("descartar");
    else end();
  }, [dirty, end]);

  const discard = useCallback(() => {
    end();
    if (blocker.state === "blocked") blocker.proceed();
  }, [end, blocker]);

  /** "Continuar editando" (do descartar e do aviso de outro aparelho). */
  const keepEditing = useCallback(() => {
    setAsk(null);
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);

  /** Aviso de outro aparelho: segue com o meu rascunho. A versão nova não volta a avisar; salvar ainda vai dar conflito. */
  const ignoreRemote = useCallback(() => setDismissed(serverRev), [serverRev]);

  /** Aviso de outro aparelho: larga o rascunho e mostra o painel novo. */
  const seeNew = useCallback(async () => {
    await dashboardStore.load();
    end();
  }, [end]);

  const resetToAuto = useCallback(async () => {
    setResetting(true);
    try {
      dashboardStore.apply(await api.dashboard.reset());
      end();
      toast({ tone: "ok", message: "Painel automático de volta" });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui voltar ao automático", detail: e instanceof Error ? e.message : undefined });
    } finally {
      setResetting(false);
    }
  }, [end]);

  /** Conflito (409): descarta o meu e fica com o de lá. */
  const reload = useCallback(async () => {
    await dashboardStore.load();
    end();
  }, [end]);

  /** Conflito (409): salva por cima, na versão que a central tem agora. */
  const overwrite = useCallback(() => save(conflictRev ?? undefined), [save, conflictRev]);

  /** Modo normal: "Apagar card" de uma referência quebrada, direto no painel salvo. */
  const dropCard = useCallback(
    async (cardId: string) => {
      const data = dash.data;
      if (!data || data.auto) return;
      try {
        dashboardStore.apply(await api.dashboard.save(removeCard(data.views, cardId), data.rev));
        toast({ tone: "ok", message: "Card apagado" });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          void dashboardStore.load();
          toast({ tone: "error", message: "O painel mudou em outro aparelho", detail: "Tente de novo." });
        } else {
          toast({ tone: "error", message: "Não consegui apagar o card", detail: e instanceof Error ? e.message : undefined });
        }
      }
    },
    [dash.data],
  );

  return {
    editing: session !== null,
    views: session?.draft ?? null,
    draftRef,
    dirty,
    saving,
    resetting,
    ask,
    setAsk,
    changedElsewhere,
    request,
    begin,
    patch,
    save,
    cancel,
    discard,
    keepEditing,
    ignoreRemote,
    seeNew,
    resetToAuto,
    reload,
    overwrite,
    dropCard,
    end,
  };
}

export type Editor = ReturnType<typeof useEditor>;
