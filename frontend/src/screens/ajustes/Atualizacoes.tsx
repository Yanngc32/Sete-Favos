// Ajustes > Sobre: estado da atualização automática e o token opcional do GitHub (este só no PC).
import { KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { HexTile } from "@/components/favos";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import type { UpdateStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const BUSY = new Set<UpdateStatus["state"]>(["verificando", "baixando", "instalando"]);
const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function statusText(u: UpdateStatus): string {
  const when = u.checked_at ? ` · verificado às ${hhmm.format(u.checked_at * 1000)}` : "";
  switch (u.state) {
    case "verificando":
      return "Verificando…";
    case "baixando":
      return `Baixando a versão ${u.latest ?? ""}…`;
    case "instalando":
      return `Instalando a versão ${u.latest ?? ""}; a colmeia volta em instantes`;
    case "disponivel":
      return `Versão ${u.latest} disponível (só a colmeia instalada se atualiza)${when}`;
    case "erro":
      return `${u.message ?? "Falhou"}${when}`;
    default:
      return `Em dia${when}`;
  }
}

export function Atualizacoes({ pc }: { pc: boolean }) {
  const [u, setU] = useState<UpdateStatus | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = !!u && BUSY.has(u.state);

  useEffect(() => {
    let alive = true;
    const load = () => api.update.status().then((s) => alive && setU(s), () => {});
    void load();
    // Enquanto verifica/baixa/instala, acompanha de perto; parado, uma vez por minuto basta.
    const t = setInterval(load, busy ? 2000 : 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [busy]);

  const run = async (fn: () => Promise<UpdateStatus>, fail: string) => {
    setSaving(true);
    try {
      setU(await fn());
      setToken("");
    } catch (e) {
      toast({ tone: "error", message: fail, detail: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim()) void run(() => api.update.setToken(token.trim()), "Não consegui salvar o token");
  };

  return (
    <>
      <li className="aj-r">
        <HexTile
          icon={<RefreshCw className={cn("i", busy && "spin")} aria-hidden />}
          variant={u?.state === "disponivel" ? "soft" : "neutral"}
          size="sm"
        />
        <div className="tx">
          <p className="t">Atualização automática</p>
          <p className={cn("s", u?.state === "erro" && "aj-err")} aria-live="polite">
            {u ? statusText(u) : "…"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sec btn-sm"
          disabled={!u || busy || saving}
          onClick={() => void run(api.update.check, "Não consegui verificar")}
        >
          Verificar agora
        </button>
      </li>
      {pc && u && (
        <li className="aj-r">
          <HexTile icon={KeyRound} size="sm" />
          {!u.has_token ? (
            <form className="tx aj-tok" onSubmit={save}>
              <p className="t">Token do GitHub (opcional)</p>
              <p className="s">Sem token a atualização já funciona. Use só se o repositório for privado ou se o GitHub
                limitar as consultas. Fica no cofre do Windows e nunca volta pra tela.</p>
              <div className="aj-tok-row">
                <span className="inp">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Token do GitHub"
                    placeholder="github_pat_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </span>
                <button type="submit" className="btn btn-sm" disabled={!token.trim() || saving} aria-busy={saving || undefined}>
                  Salvar
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="tx">
                <p className="t">Token do GitHub</p>
                <p className="s">Guardado no cofre do Windows</p>
              </div>
              <button
                type="button"
                className="btn btn-sec btn-sm"
                disabled={saving}
                onClick={() => void run(api.update.clearToken, "Não consegui remover o token")}
              >
                Remover
              </button>
            </>
          )}
        </li>
      )}
    </>
  );
}
