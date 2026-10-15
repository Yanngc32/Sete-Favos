import { Check, CircleAlert, Lock, LogIn, QrCode, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { HexTile, HoneyPage } from "@/components/favos";
import { api, ApiError } from "@/lib/api";
import { OtpInput } from "./OtpInput";
import "./acesso.css";

/** Nome inicial do aparelho (dá pra renomear no PC depois). */
function guessName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Celular Android" : "Tablet Android";
  if (/Macintosh/.test(ua)) return "Mac";
  return "Notebook";
}

type Status = { s: "idle" } | { s: "busy" } | { s: "invalid"; message: string } | { s: "blocked"; message: string } | { s: "done" };

/** Parte B do pareamento: aparelho sem acesso. Sem navegação; nada da casa aparece aqui. */
export function NaoAutorizado({ initialCode, onPaired }: { initialCode: string; onPaired: () => void }) {
  const fromQr = /^\d{6}$/.test(initialCode);
  const [code, setCode] = useState(fromQr ? initialCode : "");
  const [status, setStatus] = useState<Status>({ s: "idle" });

  // O código não fica na barra de endereço depois de lido.
  useEffect(() => {
    if (location.search) history.replaceState(null, "", location.pathname === "/parear" ? "/" : location.pathname);
  }, []);

  const submit = async (e?: FormEvent, value = code) => {
    e?.preventDefault();
    if (value.length !== 6 || status.s === "busy" || status.s === "blocked") return;
    setStatus({ s: "busy" });
    try {
      await api.access.pair(value, guessName());
      setStatus({ s: "done" });
      setTimeout(onPaired, 900);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Não consegui falar com a colmeia. Tente de novo.";
      setStatus(err instanceof ApiError && err.code === "tentativas" ? { s: "blocked", message } : { s: "invalid", message });
    }
  };

  if (status.s === "done") {
    return (
      <HoneyPage variant="hero" brand title="Pronto!" subtitle="Este aparelho já tem acesso" bodyClassName="ua-pg">
        <div className="ua ua-done" role="status">
          <HexTile icon={Check} variant="on" size="xl" />
          <h2>Abrindo a casa…</h2>
        </div>
      </HoneyPage>
    );
  }

  const blocked = status.s === "blocked";
  const message =
    status.s === "invalid" ? (
      <p className="otp-m err" id="otp-msg" role="alert">
        <CircleAlert className="i i-sm" aria-hidden />
        {status.message}
      </p>
    ) : blocked ? (
      <p className="otp-m warn" id="otp-msg" role="alert">
        <ShieldAlert className="i i-sm" aria-hidden />
        {status.message}
      </p>
    ) : fromQr && code === initialCode ? (
      <p className="otp-m" id="otp-msg">
        <QrCode className="i i-sm" aria-hidden />
        Preenchido pelo QR
      </p>
    ) : (
      <p className="otp-m" id="otp-msg">Dá pra colar o código inteiro</p>
    );

  return (
    <HoneyPage
      variant="hero"
      brand
      title="Este aparelho ainda não tem acesso"
      subtitle="No PC, abra Ajustes → Acesso → Parear novo aparelho e leia o QR com a câmera, ou digite o código abaixo."
      className="ua-wrap"
      bodyClassName="ua-pg"
    >
      <form className="ua" onSubmit={submit}>
        <HexTile icon={Lock} variant={blocked ? "neutral" : "soft"} size="xl" />
        <h2 className="ua-t">Código de 6 dígitos</h2>
        <div className="otp-w">
          <OtpInput
            value={blocked ? "" : code}
            onChange={(v) => {
              setCode(v);
              if (status.s === "invalid") setStatus({ s: "idle" });
            }}
            onComplete={(v) => {
              if (!fromQr) void submit(undefined, v);
            }}
            status={status.s === "invalid" ? "error" : undefined}
            disabled={blocked || status.s === "busy"}
            describedBy="otp-msg"
          />
          {message}
        </div>
        <button
          type="submit"
          className="btn btn-lg btn-ico"
          disabled={code.length !== 6 || blocked}
          aria-busy={status.s === "busy"}
        >
          <LogIn className="i" aria-hidden />
          Entrar
        </button>
      </form>
    </HoneyPage>
  );
}
