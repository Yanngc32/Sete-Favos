import { Check, Hourglass, QrCode, RefreshCw, Timer, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HexTile } from "@/components/favos";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "@/components/Modal";
import { api, ApiError } from "@/lib/api";
import { mmss } from "@/lib/format";
import { Qr } from "./Qr";

type View =
  | { s: "loading" }
  | { s: "waiting"; code: string; url: string; expiresAt: number }
  | { s: "expired"; code: string; url: string }
  | { s: "paired"; device: string }
  | { s: "error"; message: string };

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** Dialog "Parear novo aparelho": QR + código de 6 dígitos que vale 5 min e serve uma vez. */
export function PairDialog({ open, onOpenChange, onPaired }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired: () => void;
}) {
  const [view, setView] = useState<View>({ s: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const pairedRef = useRef(false);

  const generate = useCallback(async () => {
    setView({ s: "loading" });
    pairedRef.current = false;
    try {
      const r = await api.access.startPairing();
      const base = r.urls.tailnet ?? r.urls.lan ?? `${location.origin}/parear`;
      setView({ s: "waiting", code: r.code, url: `${base}?codigo=${r.code}`, expiresAt: r.expires_at * 1000 });
    } catch (e) {
      setView({ s: "error", message: e instanceof ApiError ? e.message : "Não consegui gerar o código." });
    }
  }, []);

  useEffect(() => {
    if (open) void generate();
  }, [open, generate]);

  // Contagem regressiva + consulta do status enquanto espera o celular.
  useEffect(() => {
    if (!open || view.s !== "waiting") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const st = await api.access.pairingStatus();
        if (st.state === "paired") {
          pairedRef.current = true;
          setView({ s: "paired", device: st.device ?? "Aparelho" });
          onPaired();
        } else if (st.state === "expired") {
          setView((v) => (v.s === "waiting" ? { s: "expired", code: v.code, url: v.url } : v));
        }
      } catch {
        /* a próxima consulta tenta de novo */
      }
    }, 1500);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [open, view.s, onPaired]);

  useEffect(() => {
    if (view.s === "waiting" && now >= view.expiresAt) setView({ s: "expired", code: view.code, url: view.url });
  }, [now, view]);

  // Pareado: mostra o ✓ e fecha sozinho em 2 s.
  useEffect(() => {
    if (view.s !== "paired") return;
    const t = setTimeout(() => onOpenChange(false), 2000);
    return () => clearTimeout(t);
  }, [view.s, onOpenChange]);

  const close = (next: boolean) => {
    if (!next && !pairedRef.current) void api.access.cancelPairing().catch(() => undefined);
    onOpenChange(next);
  };

  return (
    <Modal open={open} onOpenChange={close} className="qd">
      {view.s === "paired" ? (
        <div className="done" role="status">
          <span className="ok-t">
            <Check className="i" aria-hidden />
          </span>
          <ModalTitle render={<h3 />}>{view.device} pareado</ModalTitle>
          <p>Fecha em 2 s</p>
        </div>
      ) : (
        <>
          <div className="qd-h">
            <HexTile icon={QrCode} variant="soft" size="sm" />
            <ModalTitle render={<h3 />}>Parear novo aparelho</ModalTitle>
            <ModalClose className="ibtn" aria-label="Fechar">
              <X className="i" aria-hidden />
            </ModalClose>
          </div>

          {view.s === "loading" && (
            <>
              <ModalDescription render={<p />}>Leia o QR com a câmera do celular ou digite o código no aparelho novo.</ModalDescription>
              <div className="qr-box"><span className="sk qr-sk" /></div>
              <p className="or">ou digite</p>
              <p className="code" aria-hidden><span className="sk" style={{ width: "6ch", height: "1em" }} /></p>
            </>
          )}

          {view.s === "waiting" && (
            <>
              <ModalDescription render={<p />}>Leia o QR com a câmera do celular ou digite o código no aparelho novo.</ModalDescription>
              <div className="qr-box">
                <Qr value={view.url} label="QR code para parear" />
              </div>
              <p className="or">ou digite</p>
              <p className="code" aria-label={`Código: ${view.code.split("").join(" ")}`}>{spaced(view.code)}</p>
              <p className="cd">
                <Timer className="i i-sm" aria-hidden />
                Vale por {mmss(view.expiresAt - now)}
              </p>
            </>
          )}

          {view.s === "expired" && (
            <>
              <div className="qr-box qr-exp">
                <Qr value={view.url} />
                <span className="chip warn">
                  <Hourglass className="i i-sm" aria-hidden />
                  Expirou
                </span>
              </div>
              <p className="code old" aria-hidden>{spaced(view.code)}</p>
              <p className="cd exp" role="status">
                <Hourglass className="i i-sm" aria-hidden />
                Expirou
              </p>
              <button type="button" className="btn btn-ico btn-full" onClick={() => void generate()}>
                <RefreshCw className="i" aria-hidden />
                Gerar outro
              </button>
            </>
          )}

          {view.s === "error" && (
            <>
              <p className="hint err" role="alert">{view.message}</p>
              <button type="button" className="btn btn-ico btn-full" onClick={() => void generate()}>
                <RefreshCw className="i" aria-hidden />
                Tentar de novo
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
