import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Logo, Splash } from "@/components/Logo";
import { api } from "@/lib/api";
import { live, useLive } from "@/lib/live";
import type { Session } from "@/lib/types";
import { NaoAutorizado } from "@/screens/acesso/NaoAutorizado";

type GateState = { status: "loading" } | { status: "ready"; session: Session } | { status: "error" };

const SessionContext = { current: null as Session | null };
export const currentSession = () => SessionContext.current;

/**
 * Sem token → só a tela "não autorizado" (Parte B do pareamento); nada da casa é carregado.
 * Com acesso → liga o estado ao vivo e mostra o app. Revogado no meio do uso → volta pra Parte B.
 */
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const { connection } = useLive();
  const location = useLocation();

  const check = useCallback(async () => {
    try {
      const session = await api.session();
      SessionContext.current = session;
      setState({ status: "ready", session });
      if (session.access !== "none") {
        live.start();
        if (live.get().connection === "unauthorized") live.reconnectNow();
      }
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (connection === "unauthorized") void check();
  }, [connection, check]);

  if (state.status === "loading") return <Splash />;
  if (state.status === "error") {
    return (
      <div className="mk ua-page">
        <div className="empty" role="alert">
          <span className="tile lg">
            <Logo className="i i-lg" vazio />
          </span>
          <h3>Não consegui falar com a colmeia</h3>
          <p>Confira se o PC está ligado e se o Tailscale está ativo neste aparelho.</p>
          <button type="button" className="btn btn-sec" onClick={() => void check()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (state.session.access === "none" || connection === "unauthorized") {
    const code = new URLSearchParams(location.search).get("codigo") ?? "";
    return <NaoAutorizado initialCode={location.pathname === "/parear" ? code : ""} onPaired={check} />;
  }
  return <>{children}</>;
}
