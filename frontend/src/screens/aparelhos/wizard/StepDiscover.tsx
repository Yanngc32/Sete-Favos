import { Check, Radar, RefreshCw, X } from "lucide-react";
import { HexTile } from "@/components/favos";
import { Loader } from "@/components/Logo";
import { useEffect, useState } from "react";
import { kindIcon } from "@/lib/devices";
import type { Vendor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrHint, ErrNote, FirewallHelp, SecretInput, TextField } from "./fields";
import { isFirewall, manualFields, PAIR_SECONDS, plural, type Err, type Found, type PairState } from "./model";

const C = 2 * Math.PI * 50; // circunferência do anel (r=50 no viewBox 120)

export interface DiscoverProps {
  vendor: Vendor;
  running: boolean;
  done: boolean;
  error: Err | null;
  found: Found[];
  selected: Set<string>;
  pairs: Record<string, PairState>;
  onToggle: (key: string) => void;
  onCancelPair: (key: string) => void;
  onRetryPair: (key: string) => void;
  onExpirePair: (key: string, attempt: number) => void;
  onRescan: () => void;
  manualOpen: boolean;
  onManualOpen: (open: boolean) => void;
  onManual: (body: { ip: string; device_id?: string; secret?: string }) => Promise<Err | null>;
}

export function StepDiscover(p: DiscoverProps) {
  const n = p.found.length;
  const manual = manualFields(p.vendor);
  const empty = p.done && !p.error && n === 0;

  return (
    <>
      {p.error ? (
        <ErrNote err={p.error} retry={p.onRescan} retryLabel="Procurar de novo" />
      ) : empty ? null : (
        <div className="scan" role="status" aria-live="polite">
          {p.running ? (
            <>
              <Loader className="i spin" aria-hidden />
              Procurando… <span>{plural(n, "encontrado", "encontrados")}</span>
            </>
          ) : (
            <>
              <Check className="i ok" aria-hidden />
              Busca concluída · {plural(n, "encontrado", "encontrados")}
            </>
          )}
          {p.done && n > 0 && (
            <button type="button" className="btn btn-ghost btn-sm btn-ico" onClick={p.onRescan}>
              <RefreshCw className="i i-sm" aria-hidden />
              Procurar de novo
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="empty">
          <HexTile icon={Radar} variant="soft" size="xl" />
          <h3>Nenhum aparelho achado</h3>
          <p>Ele está no mesmo Wi-Fi do PC?</p>
          <div className="acts">
            <button type="button" className="btn btn-sec btn-sm btn-ico" onClick={p.onRescan}>
              <RefreshCw className="i i-sm" aria-hidden />
              Procurar de novo
            </button>
            {manual && !p.manualOpen && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => p.onManualOpen(true)}>
                Adicionar pelo IP
              </button>
            )}
          </div>
        </div>
      ) : (
        n > 0 && (
          <div className="list fl" role="group" aria-label="Aparelhos encontrados">
            {p.found.map((f) => (
              <Item key={f.c.key} f={f} {...p} />
            ))}
          </div>
        )
      )}

      {manual &&
        (p.manualOpen ? (
          <ManualIp vendor={p.vendor} onClose={() => p.onManualOpen(false)} onSubmit={p.onManual} />
        ) : (
          !empty && (
            <button type="button" className="btn-link" style={{ alignSelf: "flex-start" }} onClick={() => p.onManualOpen(true)}>
              Não achou? Adicionar pelo IP
            </button>
          )
        ))}
    </>
  );
}

function Item({ f, ...p }: { f: Found } & DiscoverProps) {
  const { c } = f;
  const pair = p.pairs[c.key];
  const sel = p.selected.has(c.key);
  const dis = c.already_added || !!c.problem;
  const Icon = kindIcon(c.kind);
  const isTv = c.kind === "tv";
  const probId = `prob-${c.key}`;
  return (
    <>
      <label className={cn("fi", dis && "is-dis", sel && "is-sel", "is-new")}>
        <input
          type="checkbox"
          className="sr"
          checked={sel}
          disabled={dis}
          onChange={() => p.onToggle(c.key)}
          aria-describedby={c.problem ? probId : undefined}
        />
        <span className={cn("cbx", sel && "on")} aria-hidden>
          <Check className="i" />
        </span>
        <HexTile icon={Icon} size="sm" variant={sel ? "on" : "neutral"} />
        <span className="tx">
          <span className="nmx">{c.name}</span>
          {(c.model || c.ip) && (
            <span className="meta">
              {c.model && <span className="mono">{c.model}</span>}
              {c.ip && <span className="mono">{c.ip}</span>}
            </span>
          )}
          {c.problem && !c.already_added && (
            <span className="prob" id={probId}>
              {c.problem}
            </span>
          )}
        </span>
        {c.already_added && <span className="chip">Já adicionado</span>}
        {sel && pair?.status === "ok" && (
          <span className="chip ok">
            <Check className="i i-sm" aria-hidden />
            {isTv ? "Aceito" : "Conferido"}
          </span>
        )}
      </label>

      {sel && pair?.status === "waiting" &&
        (isTv ? (
          <PairPanel
            name={c.name}
            startedAt={pair.startedAt}
            onCancel={() => p.onCancelPair(c.key)}
            onExpire={() => p.onExpirePair(c.key, pair.attempt)}
          />
        ) : (
          <div className="chk" role="status">
            <Loader className="i i-sm spin" aria-hidden />
            Conferindo se {c.name} responde pela rede local…
          </div>
        ))}
      {sel && pair?.status === "miss" && (
        <div className="miss-w">
          <div className="miss" role="alert">
            <div className="ring" aria-hidden>
              <svg viewBox="0 0 120 120" fill="none" strokeWidth="5" strokeLinecap="round">
                <circle className="trk" cx="60" cy="60" r="50" />
              </svg>
              <b className="num">
                0<small>segundos</small>
              </b>
            </div>
            <p>{pair.message}</p>
            <button type="button" className="btn btn-sec btn-sm btn-ico" onClick={() => p.onRetryPair(c.key)}>
              <RefreshCw className="i i-sm" aria-hidden />
              Tentar de novo
            </button>
          </div>
        </div>
      )}
      {sel && pair?.status === "fail" && <ErrNote err={pair.err} retry={() => p.onRetryPair(c.key)} />}
    </>
  );
}

/** Aviso grande "Aceite o pedido na tela da TV" com timer de 60 s. */
function PairPanel({ name, startedAt, onCancel, onExpire }: {
  name: string;
  startedAt: number;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, PAIR_SECONDS - Math.floor((now - startedAt) / 1000));
  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);
  return (
    <div className="pair" role="alert">
      <div className="ring" role="timer" aria-label={`${left} segundos restantes`}>
        <svg viewBox="0 0 120 120" fill="none" strokeWidth="5" strokeLinecap="round" aria-hidden>
          <circle className="trk" cx="60" cy="60" r="50" />
          <circle
            className="prg"
            cx="60"
            cy="60"
            r="50"
            strokeDasharray={`${((C * left) / PAIR_SECONDS).toFixed(1)} ${C.toFixed(1)}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <b className="num" aria-hidden>
          {left}
          <small>segundos</small>
        </b>
      </div>
      <div className="pair-tx">
        <h2>Aceite o pedido na tela da TV</h2>
        <p>A {name} está mostrando um pedido de conexão. Use o controle remoto pra aceitar.</p>
        <span className="wait">
          <Loader className="i i-sm spin" aria-hidden />
          Esperando a TV…
        </span>
      </div>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** "Adicionar pelo IP" (avançado): IP + ID/chave conforme o fabricante. */
function ManualIp({ vendor, onClose, onSubmit }: {
  vendor: Vendor;
  onClose: () => void;
  onSubmit: DiscoverProps["onManual"];
}) {
  const cfg = manualFields(vendor)!;
  const [ip, setIp] = useState("");
  const [devId, setDevId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ ip?: string; id?: string; secret?: string; api?: Err }>({});
  const [help, setHelp] = useState(false);

  const submit = async () => {
    const next: typeof errs = {};
    if (!IP_RE.test(ip.trim())) next.ip = "Digite um IP como 192.168.0.48.";
    if (cfg.deviceId && !devId.trim()) next.id = "Informe o ID do aparelho.";
    if (cfg.secret === "required" && !secret.trim()) next.secret = `Informe o ${cfg.secretLabel}.`;
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const err = await onSubmit({
      ip: ip.trim(),
      device_id: cfg.deviceId ? devId.trim() : undefined,
      secret: cfg.secret !== "none" ? secret.trim() || undefined : undefined,
    });
    setBusy(false);
    if (err) setErrs({ api: err });
    else {
      setIp("");
      setDevId("");
      setSecret("");
    }
  };

  const apiId = "man-err";
  return (
    <div
      className="man"
      role="group"
      aria-labelledby="man-t"
      onKeyDown={(e) => {
        // Enter aqui procura no IP (e não dispara o Continuar do assistente).
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="man-h">
        <h2 id="man-t">Adicionar pelo IP</h2>
        <button type="button" className="ibtn" aria-label="Fechar Adicionar pelo IP" onClick={onClose}>
          <X className="i" aria-hidden />
        </button>
      </div>
      <TextField
        id="man-ip"
        label="IP do aparelho"
        value={ip}
        onChange={setIp}
        mono
        inputMode="decimal"
        placeholder="192.168.0.48"
        error={errs.ip}
        invalid={!!errs.api}
        describedBy={errs.api ? apiId : undefined}
        autoFocus
      />
      {cfg.deviceId && (
        <TextField
          id="man-id"
          label="ID do aparelho"
          value={devId}
          onChange={setDevId}
          mono
          error={errs.id}
          hint="No app Smart Life: aparelho › editar › informações do aparelho."
        />
      )}
      {cfg.secret !== "none" && (
        <div className="fld">
          <label htmlFor="man-k">
            {cfg.secretLabel}
            {cfg.secret === "optional" && <span className="muted"> · opcional</span>}
          </label>
          <SecretInput
            id="man-k"
            value={secret}
            onChange={setSecret}
            label={cfg.secretLabel}
            invalid={!!errs.secret}
            describedBy={errs.secret ? "man-k-err" : undefined}
            required={cfg.secret === "required"}
            mono
          />
          {errs.secret && <ErrHint id="man-k-err">{errs.secret}</ErrHint>}
        </div>
      )}
      {errs.api && (
        <ErrHint id={apiId}>
          {errs.api.message}
          {isFirewall(errs.api) && (
            <button type="button" className="btn-link" onClick={() => setHelp(true)}>
              Como fazer
            </button>
          )}
        </ErrHint>
      )}
      <button type="button" className="btn btn-sec btn-sm" onClick={() => submit()} disabled={busy} aria-busy={busy}>
        {busy && <Loader className="i i-sm spin" aria-hidden />}
        {busy ? "Procurando…" : "Procurar neste IP"}
      </button>
      <FirewallHelp open={help} onOpenChange={setHelp} />
    </div>
  );
}
