import { ChevronLeft, Laptop, Lock, Monitor, Pencil, Plus, QrCode, Smartphone, Tablet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { HexTile, HoneyPage, Swap } from "@/components/favos";
import { Confirm } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { whenShort } from "@/lib/format";
import { live } from "@/lib/live";
import type { AccessDevice } from "@/lib/types";
import { PairDialog } from "./PairDialog";
import "./acesso.css";

function deviceIcon(name: string) {
  const n = name.toLowerCase();
  return /ipad|tablet/.test(n) ? Tablet : /notebook|mac|laptop|pc/.test(n) ? Laptop : Smartphone;
}

function lastAccess(d: AccessDevice) {
  if (!d.last_seen) return "Ainda não entrou";
  const where = d.last_via === "tailscale" ? "fora de casa" : "em casa";
  return `Último acesso: ${whenShort(d.last_seen)} · ${where}`;
}

function Row({ device, onRevoke, onRenamed }: {
  device: AccessDevice;
  onRevoke: (d: AccessDevice) => void;
  onRenamed: (d: AccessDevice) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const next = name.trim();
    if (!next || next === device.name) {
      setName(device.name);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      onRenamed(await api.access.rename(device.id, next));
      setEditing(false);
    } catch (err) {
      toast({ tone: "error", message: err instanceof ApiError ? err.message : "Não consegui renomear." });
    } finally {
      setBusy(false);
      requestAnimationFrame(() => editRef.current?.focus());
    }
  };

  return (
    <li className="aj-r">
      <HexTile icon={deviceIcon(device.name)} variant={device.last_seen ? "soft" : "neutral"} size="sm" />
      <div className="tx">
        {editing ? (
          <form className="li-tr" onSubmit={save}>
            <div className="inp ren-in">
              <input
                autoFocus
                aria-label={`Novo nome de ${device.name}`}
                value={name}
                maxLength={60}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setName(device.name);
                    setEditing(false);
                  }
                }}
              />
            </div>
          </form>
        ) : (
          <div className="li-tr">
            <p className="t">{device.name}</p>
            <button
              ref={editRef}
              type="button"
              className="ren"
              aria-label={`Renomear ${device.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil className="i i-sm" aria-hidden />
            </button>
          </div>
        )}
        <p className="s num">{lastAccess(device)}</p>
      </div>
      <button type="button" className="btn btn-sec btn-sm" onClick={() => onRevoke(device)}>
        Revogar
      </button>
    </li>
  );
}

/** Ajustes → Acesso (Parte A do pareamento): só o PC gerencia quem tem acesso. */
export function AjustesAcesso() {
  const [devices, setDevices] = useState<AccessDevice[] | null>(null);
  const [onlyPc, setOnlyPc] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState<AccessDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api.access.devices());
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setOnlyPc(true);
      else toast({ tone: "error", message: "Não consegui carregar os aparelhos.", action: { label: "Tentar de novo", onClick: () => void load() } });
    }
  }, []);

  useEffect(() => {
    void load();
    return live.onEvent((e) => {
      if (e.t === "access_paired" || e.t === "access_revoked") void load();
    });
  }, [load]);

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.access.revoke(revoking.id);
      setDevices((list) => list?.filter((d) => d.id !== revoking.id) ?? null);
      toast({ tone: "ok", message: `${revoking.name} perdeu o acesso` });
      setRevoking(null);
    } catch (e) {
      toast({ tone: "error", message: e instanceof ApiError ? e.message : "Não consegui revogar. Tente de novo." });
    } finally {
      setBusy(false);
    }
  };

  const n = devices?.length ?? null;
  return (
    <HoneyPage
      variant="detalhe"
      title="Acesso"
      leading={
        <Link className="ibtn bd" to="/ajustes" aria-label="Voltar para Ajustes">
          <ChevronLeft className="i" aria-hidden />
        </Link>
      }
      actions={
        !onlyPc && (
          <button type="button" className="ibtn bd" aria-label="Parear novo aparelho" onClick={() => setPairing(true)}>
            <QrCode className="i" aria-hidden />
          </button>
        )
      }
      subtitle={
        onlyPc ? (
          "Gerenciado no PC da casa"
        ) : n === null ? (
          "Carregando…"
        ) : (
          <>
            Este PC e mais <Swap value={n} /> {n === 1 ? "aparelho" : "aparelhos"}
          </>
        )
      }
      liveSubtitle
      bodyClassName="acc aj"
    >
      <p className="aj-intro">Celular ou notebook pareado uma vez entra direto, em casa ou fora pelo Tailscale.</p>
      {onlyPc ? (
        <div className="aj-empty">
          <HexTile icon={Monitor} variant="soft" size="xl" />
          <h3>Só no PC</h3>
          <p>Os acessos são gerenciados no PC da casa: abra o painel nele em Ajustes → Acesso.</p>
        </div>
      ) : (
        <>
          <section className="aj-sec" aria-labelledby="ac-t">
            <h2 id="ac-t" className="aj-t">
              Aparelhos com acesso
            </h2>
            <ul className="aj-card" aria-labelledby="ac-t" aria-busy={devices === null}>
              <li className="aj-r">
                <HexTile icon={Monitor} variant="on" size="sm" />
                <div className="tx">
                  <p className="t">Este PC</p>
                  <p className="s">Sempre liberado</p>
                </div>
                <span className="fix">
                  <Lock className="i i-sm" aria-hidden />
                  <span>Não pode ser revogado</span>
                </span>
              </li>
              {devices === null ? (
                <li className="aj-r" aria-hidden>
                  <span className="sk aj-sk-hx" />
                  <div className="tx">
                    <span className="sk" style={{ width: "40%", height: 14 }} />
                    <span className="sk" style={{ width: "62%", height: 12 }} />
                  </div>
                </li>
              ) : (
                devices.map((d) => (
                  <Row
                    key={d.id}
                    device={d}
                    onRevoke={setRevoking}
                    onRenamed={(nd) => setDevices((list) => list?.map((x) => (x.id === nd.id ? nd : x)) ?? null)}
                  />
                ))
              )}
            </ul>
          </section>
          <button type="button" className="aj-add" onClick={() => setPairing(true)}>
            <Plus className="i" aria-hidden />
            Parear novo aparelho
          </button>
        </>
      )}

      <PairDialog open={pairing} onOpenChange={setPairing} onPaired={() => void load()} />
      <Confirm
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revogar ${revoking?.name ?? ""}?`}
        description="Ele perde o acesso na hora."
        confirmLabel="Revogar"
        onConfirm={() => void revoke()}
        busy={busy}
        cancelRef={cancelRef}
      />
    </HoneyPage>
  );
}
