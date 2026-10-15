// Assistente "Adicionar aparelho" (/dispositivos/novo): Fabricante → Conta → Descobrir → Nome e cômodo.
// Mock aprovado: design-fontes/src/adicionar.html, no visual Sete Favos (bloco mel com o passo + painel com a curva).
// No celular ocupa a tela inteira, com Voltar/Continuar fixos.
import { ArrowLeft, X } from "lucide-react";
import { Loader } from "@/components/Logo";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { HoneyHeader } from "@/components/favos";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { live, useLive } from "@/lib/live";
import type { Candidate, DiscoveryJob, LiveEvent, Vendor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrHint, ErrNote } from "./wizard/fields";
import {
  accountCopy,
  ACCOUNT_ERRORS,
  discoverSub,
  hasAccountStep,
  NEW_ROOM,
  plural,
  STEP_LABEL,
  toErr,
  type Draft,
  type Err,
  type Found,
  type PairState,
  type Step,
} from "./wizard/model";
import { StepAccount } from "./wizard/StepAccount";
import { StepDiscover } from "./wizard/StepDiscover";
import { StepName } from "./wizard/StepName";
import { StepVendor } from "./wizard/StepVendor";
import "./aparelhos.css";

const TV_MISS = "A TV não confirmou. Tente de novo e aceite na tela.";
const IDLE_SCAN = { running: false, done: false, error: null as Err | null };

/** Valores iniciais do formulário: selects já vêm com a 1ª opção (ex.: Região América). */
function initialValues(v: Vendor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...v.account_fields, ...v.transient_fields]) out[f.name] = f.options?.[0]?.value ?? "";
  return out;
}

/** Cômodo citado no nome ("Luz do escritório" → Escritório). */
function guessRoom(name: string, rooms: string[]): string {
  const n = name.toLocaleLowerCase("pt-BR");
  return rooms.find((r) => n.includes(r.toLocaleLowerCase("pt-BR"))) ?? "";
}

export function Adicionar() {
  const navigate = useNavigate();
  const { rooms } = useLive();

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [loadErr, setLoadErr] = useState<Err | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [pickErr, setPickErr] = useState(false);

  // Passo 2
  const [values, setValues] = useState<Record<string, string>>({});
  const [swapping, setSwapping] = useState(false);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [accErr, setAccErr] = useState<Err | null>(null);
  const [saving, setSaving] = useState(false);

  // Passo 3
  const [scan, setScan] = useState(IDLE_SCAN);
  const [found, setFound] = useState<Found[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pairs, setPairs] = useState<Record<string, PairState>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const runRef = useRef(0);
  const stopRef = useRef<(() => void) | null>(null);
  const pairAttempt = useRef<Record<string, number>>({});
  const pairSeq = useRef(0);

  // Passo 4
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [finishing, setFinishing] = useState(false);

  const foundRef = useRef(found);
  foundRef.current = found;

  const vendor = vendors?.find((v) => v.vendor === vendorId) ?? null;
  const connected = !!vendor && vendor.account_fields.length > 0 && vendor.account_configured && !swapping;

  const loadVendors = useCallback(() => {
    setLoadErr(null);
    api.vendors.list().then(setVendors, (e) => setLoadErr(toErr(e)));
  }, []);
  useEffect(loadVendors, [loadVendors]);

  // Para a busca ao sair da tela.
  useEffect(() => () => stopScan(), []);

  // A cada passo: foco no título (leitor de tela anuncia) e topo da página.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Descoberta -------------------------------------------------------------------

  function stopScan() {
    runRef.current++;
    stopRef.current?.();
    stopRef.current = null;
  }

  const addFound = useCallback((job: string, c: Candidate, manual = false) => {
    setFound((prev) => {
      const i = prev.findIndex((f) => f.c.key === c.key);
      if (i === -1) return [...prev, { job, c, manual }];
      if (!manual) return prev;
      const next = prev.slice();
      next[i] = { job, c, manual };
      return next;
    });
  }, []);

  const startScan = useCallback(
    async (v: Vendor, creds: Record<string, string>) => {
      stopScan();
      const run = runRef.current;
      setScan({ running: true, done: false, error: null });
      setFound((prev) => prev.filter((f) => f.manual));
      setSelected((prev) => new Set([...prev].filter((k) => foundRef.current.some((f) => f.manual && f.c.key === k))));
      setManualOpen(false);

      let jobId: string | null = null;
      let finished = false;
      const buffer: LiveEvent[] = [];
      let poll: ReturnType<typeof setInterval> | undefined;

      const finish = (job: DiscoveryJob) => {
        if (finished || runRef.current !== run) return;
        finished = true;
        stopRef.current?.();
        for (const c of job.candidates) addFound(job.id, c);
        const err: Err | null = job.error
          ? { message: job.error, code: job.error_code ?? undefined, data: job.error_data }
          : null;
        if (err && hasAccountStep(v) && ACCOUNT_ERRORS.has(err.code ?? "")) {
          setAccErr(err);
          // Cada imagem nova pede um código novo.
          if (err.code === "captcha") setValues((vals) => ({ ...vals, captcha: "" }));
          setScan(IDLE_SCAN);
          setStep(2);
          return;
        }
        setScan({ running: false, done: true, error: err });
      };
      const handle = (e: LiveEvent) => {
        if (runRef.current !== run) return;
        if (e.t === "discovery" && e.job === jobId) addFound(e.job, e.candidate);
        else if (e.t === "discovery_done" && e.job === jobId) finish(e);
      };
      // Escuta antes do POST: os primeiros candidatos podem chegar antes da resposta.
      const off = live.onEvent((e) => (jobId === null ? buffer.push(e) : handle(e)));
      stopRef.current = () => {
        off();
        if (poll) clearInterval(poll);
      };

      try {
        const job = await api.vendors.discover(v.vendor, creds);
        if (runRef.current !== run) return;
        jobId = job.id;
        for (const c of job.candidates) addFound(job.id, c);
        if (job.done) return finish(job);
        buffer.splice(0).forEach(handle);
        // Rede de segurança se o WebSocket cair no meio da busca.
        poll = setInterval(() => {
          api.discovery.get(job.id).then((j) => {
            if (runRef.current !== run) return;
            for (const c of j.candidates) addFound(j.id, c);
            if (j.done) finish(j);
          }, () => {});
        }, 2500);
      } catch (e) {
        if (runRef.current !== run) return;
        stopRef.current?.();
        const err = toErr(e);
        if (hasAccountStep(v) && ACCOUNT_ERRORS.has(err.code ?? "")) {
          setAccErr(err);
          setScan(IDLE_SCAN);
          setStep(2);
          return;
        }
        setScan({ running: false, done: true, error: err });
      }
    },
    [addFound],
  );

  // Pareamento (TV aceita na tela; Xiaomi confere o controle local) ------------------

  const startPair = (f: Found) => {
    const key = f.c.key;
    const attempt = ++pairSeq.current;
    pairAttempt.current[key] = attempt;
    setPairs((p) => ({ ...p, [key]: { status: "waiting", startedAt: Date.now(), attempt } }));
    api.discovery.pair(f.job, key).then(
      (c) => {
        if (pairAttempt.current[key] !== attempt) return;
        // Aceitou, mesmo que depois do timer: vale.
        setPairs((p) => ({ ...p, [key]: { status: "ok" } }));
        setFound((prev) => prev.map((x) => (x.c.key === key ? { ...x, c: { ...x.c, ...c, needs_pairing: false } } : x)));
      },
      (e) => {
        if (pairAttempt.current[key] !== attempt) return;
        const err = toErr(e);
        setPairs((p) => {
          const cur = p[key];
          if (cur?.status !== "waiting") return p;
          const miss = err.code === "tv_recusou" || err.code === "tempo_esgotado";
          return { ...p, [key]: miss ? { status: "miss", message: err.message } : { status: "fail", err } };
        });
      },
    );
  };

  const cancelPair = (key: string) => {
    pairAttempt.current[key] = -1;
    setPairs(({ [key]: _, ...rest }) => rest);
  };

  const toggle = (key: string) => {
    const f = found.find((x) => x.c.key === key);
    if (!f) return;
    if (selected.has(key)) {
      setSelected((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      cancelPair(key);
      return;
    }
    setSelected((s) => new Set(s).add(key));
    if (f.c.needs_pairing && pairs[key]?.status !== "ok") startPair(f);
  };

  const expirePair = useCallback((key: string, attempt: number) => {
    setPairs((p) => {
      const cur = p[key];
      if (cur?.status !== "waiting" || cur.attempt !== attempt) return p;
      return { ...p, [key]: { status: "miss", message: TV_MISS } };
    });
  }, []);

  const manualAdd = async (body: { ip: string; device_id?: string; secret?: string }) => {
    if (!vendor) return null;
    try {
      const { job, candidate } = await api.vendors.manual(vendor.vendor, body);
      addFound(job, candidate, true);
      setManualOpen(false);
      if (!candidate.already_added && !candidate.problem) {
        setSelected((s) => new Set(s).add(candidate.key));
        if (candidate.needs_pairing) startPair({ job, c: candidate, manual: true });
      }
      return null;
    } catch (e) {
      return toErr(e);
    }
  };

  // Passo 4 ----------------------------------------------------------------------

  const chosen = useMemo(() => found.filter((f) => selected.has(f.c.key)), [found, selected]);

  const patchDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((d) => (d[key] ? { ...d, [key]: { ...d[key], ...patch } } : d));

  const validate = (keys: string[]) => {
    let ok = true;
    const next = { ...drafts };
    for (const key of keys) {
      const d = next[key];
      const nameErr = d.name.trim() ? undefined : "Dê um nome ao aparelho.";
      const roomErr = d.room === NEW_ROOM && !d.newRoom.trim() ? "Dê um nome ao cômodo novo." : undefined;
      if (nameErr || roomErr) ok = false;
      next[key] = { ...d, nameErr, roomErr };
    }
    setDrafts(next);
    if (!ok) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".devf [aria-invalid=true]")?.focus());
    }
    return ok;
  };

  /** Cadastra (se ainda não) ou atualiza nome/cômodo. Devolve o id do aparelho. */
  const ensureAdded = async (key: string, d: Draft): Promise<string> => {
    const f = found.find((x) => x.c.key === key)!;
    let room: string | null = d.room || null;
    if (d.room === NEW_ROOM) {
      room = d.newRoom.trim();
      if (!rooms.some((r) => r.toLocaleLowerCase("pt-BR") === room!.toLocaleLowerCase("pt-BR"))) await api.rooms.add(room);
    }
    const name = d.name.trim();
    if (d.deviceId) {
      const s = d.saved;
      if (s && (s.name !== name || s.room !== room || s.kind !== d.kind)) {
        await api.devices.update(d.deviceId, {
          ...(s.name !== name && { name }),
          ...(s.room !== room && (room ? { room } : { clear_room: true })),
          ...(s.kind !== d.kind && { kind: d.kind }),
        });
        patchDraft(key, { saved: { name, room, kind: d.kind } });
      }
      return d.deviceId;
    }
    const dev = await api.discovery.add(f.job, key, { name, room, kind: d.kind });
    patchDraft(key, { deviceId: dev.id, saved: { name, room, kind: d.kind } });
    return dev.id;
  };

  const testDevice = async (key: string) => {
    if (!validate([key])) return;
    const d = drafts[key];
    patchDraft(key, { test: { status: "busy" }, err: undefined });
    try {
      const id = await ensureAdded(key, d);
      await api.devices.test(id);
      patchDraft(key, { test: { status: "ok", text: d.kind === "vacuum" ? "Bipou" : "Ligou e desligou" } });
    } catch (e) {
      patchDraft(key, { test: { status: "fail", message: toErr(e).message } });
    }
  };

  const finish = async () => {
    const keys = chosen.map((f) => f.c.key);
    if (!validate(keys)) return;
    setFinishing(true);
    const ids: string[] = [];
    for (const key of keys) {
      patchDraft(key, { err: undefined, busy: true });
      try {
        ids.push(await ensureAdded(key, drafts[key]));
        patchDraft(key, { busy: false });
      } catch (e) {
        patchDraft(key, { err: toErr(e), busy: false });
      }
    }
    setFinishing(false);
    if (ids.length !== keys.length) return;
    toast({ message: plural(ids.length, "aparelho adicionado", "aparelhos adicionados"), tone: "ok" });
    navigate("/", { state: { novos: ids } });
  };

  // Navegação entre passos --------------------------------------------------------

  const pickVendor = (id: string) => {
    setPickErr(false);
    if (id === vendorId) return;
    stopScan();
    const v = vendors?.find((x) => x.vendor === id);
    setVendorId(id);
    setValues(v ? initialValues(v) : {});
    setSwapping(false);
    setFieldErrs({});
    setAccErr(null);
    setScan(IDLE_SCAN);
    setFound([]);
    setSelected(new Set());
    setPairs({});
    pairAttempt.current = {};
    setDrafts({});
    setManualOpen(false);
  };

  const toDiscover = (v: Vendor, creds: Record<string, string> = {}) => {
    setStep(3);
    startScan(v, creds);
  };

  const submitAccount = async (v: Vendor) => {
    if (connected) return toDiscover(v);
    const saved = v.account_fields.length > 0;
    const fields = saved ? v.account_fields : v.transient_fields;
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const required = saved ? f.required : v.transient_required && f.required;
      if (required && !values[f.name]?.trim()) errs[f.name] = `Preencha ${f.label.replace(/\s*\(.*\)$/, "")}.`;
    }
    setFieldErrs(errs);
    setAccErr(null);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".wz [aria-invalid=true]")?.focus());
      return;
    }
    const pick = (names: string[]) => Object.fromEntries(names.map((n) => [n, values[n]?.trim() ?? ""]));
    if (!saved) return toDiscover(v, pick(v.transient_fields.map((f) => f.name)));
    setSaving(true);
    try {
      await api.vendors.saveAccount(v.vendor, pick(v.account_fields.map((f) => f.name)));
      setVendors((vs) => vs?.map((x) => (x.vendor === v.vendor ? { ...x, account_configured: true } : x)) ?? vs);
      setSwapping(false);
      // Segredo não fica nem na memória da tela depois de salvo.
      setValues((vals) => Object.fromEntries(Object.entries(vals).filter(([k]) => !v.account_fields.find((f) => f.name === k)?.secret)));
      toDiscover(v);
    } catch (e) {
      setAccErr(toErr(e));
    } finally {
      setSaving(false);
    }
  };

  // Por que o Continuar do passo 3 está bloqueado.
  const discoverBlock = (() => {
    if (!chosen.length) return "Marque pelo menos um aparelho";
    const st = (f: Found) => pairs[f.c.key]?.status;
    if (chosen.some((f) => st(f) === "waiting" && f.c.kind === "tv")) return "Esperando a TV aceitar";
    if (chosen.some((f) => st(f) === "waiting")) return "Conferindo o aparelho…";
    if (chosen.some((f) => f.c.needs_pairing && st(f) !== "ok" && f.c.kind === "tv")) return "A TV ainda não aceitou";
    if (chosen.some((f) => f.c.needs_pairing && st(f) !== "ok")) return "O aparelho não respondeu";
    return null;
  })();

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (saving || finishing) return;
    if (step === 1) {
      if (!vendors) return;
      if (!vendor) return setPickErr(true);
      if (hasAccountStep(vendor)) return setStep(2);
      return toDiscover(vendor);
    }
    if (!vendor) return;
    if (step === 2) return submitAccount(vendor);
    if (step === 3) {
      if (discoverBlock) return;
      setDrafts((prev) => {
        const out: Record<string, Draft> = {};
        for (const { c } of chosen) {
          out[c.key] = prev[c.key] ?? { name: c.name, room: guessRoom(c.name, rooms), newRoom: "", kind: c.kind };
        }
        return out;
      });
      return setStep(4);
    }
    return finish();
  };

  const back = () => {
    if (step === 2) return setStep(1);
    if (step === 3) {
      stopScan();
      setScan(IDLE_SCAN);
      return setStep(vendor && hasAccountStep(vendor) ? 2 : 1);
    }
    if (step === 4) return setStep(3);
  };

  // Tela ---------------------------------------------------------------------------

  const verify = step === 2 && accErr?.code === "verificacao";
  const title =
    step === 1 ? { h: "De que marca é?", p: null }
    : step === 2 && vendor ? { h: accountCopy(vendor).title, p: accountCopy(vendor).sub }
    : step === 3 && vendor ? { h: "Procurar na rede", p: discoverSub(vendor) }
    : { h: "Nome e cômodo", p: "Confira cada aparelho. Testar liga e desliga (ou faz o robô bipar) pra ter certeza que é o certo." };

  const busy = saving || finishing;
  const hint = step === 3 ? discoverBlock : null;
  const primary =
    step === 2 ? (verify ? "Já confirmei" : saving ? "Conferindo…" : "Continuar")
    : step === 4 ? (finishing ? "Concluindo…" : "Concluir")
    : "Continuar";

  return (
    <div className="fv-page ad-page">
      <HoneyHeader
        className="wz-hd"
        title="Adicionar aparelho"
        leading={
          <Link className="ibtn bd" to="/dispositivos" aria-label="Sair do assistente">
            <X className="i" aria-hidden />
          </Link>
        }
        subtitle={
          <span className="wz-n" aria-live="polite">
            Passo {step} de 4: {STEP_LABEL[step]}
            {vendor && step > 1 && <span> · {vendor.label}</span>}
          </span>
        }
      >
        <ol className="steps" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className={cn(n <= step && "on")} />
          ))}
        </ol>
      </HoneyHeader>
      <div className="fv-pg">
    <form className="fv-in fv-pg-in ad wz" onSubmit={next} noValidate>
      <div className="wz-st" key={step}>
        <div className="wz-ti">
          <h2 ref={titleRef} tabIndex={-1}>
            {title.h}
          </h2>
          {title.p && <p>{title.p}</p>}
        </div>

        {step === 1 &&
          (loadErr ? (
            <ErrNote err={loadErr} retry={loadVendors} />
          ) : (
            <>
              <StepVendor vendors={vendors} value={vendorId} onChange={pickVendor} errorId={pickErr ? "pick-err" : undefined} />
              {pickErr && <ErrHint id="pick-err">Escolha um fabricante.</ErrHint>}
            </>
          ))}

        {step === 2 && vendor && (
          <StepAccount
            vendor={vendor}
            connected={connected}
            onSwap={() => {
              setSwapping(true);
              setAccErr(null);
            }}
            onCancelSwap={vendor.account_configured && swapping ? () => setSwapping(false) : undefined}
            values={values}
            onValue={(name, v) => {
              setValues((vals) => ({ ...vals, [name]: v }));
              setFieldErrs(({ [name]: _, ...rest }) => rest);
            }}
            fieldErrs={fieldErrs}
            err={accErr}
            onRetry={() => submitAccount(vendor)}
          />
        )}

        {step === 3 && vendor && (
          <StepDiscover
            vendor={vendor}
            running={scan.running}
            done={scan.done}
            error={scan.error}
            found={found}
            selected={selected}
            pairs={pairs}
            onToggle={toggle}
            onCancelPair={(key) => {
              cancelPair(key);
              setSelected((s) => {
                const n = new Set(s);
                n.delete(key);
                return n;
              });
            }}
            onRetryPair={(key) => {
              const f = found.find((x) => x.c.key === key);
              if (f) startPair(f);
            }}
            onExpirePair={expirePair}
            onRescan={() => {
              const creds = vendor.account_fields.length ? {} : Object.fromEntries(vendor.transient_fields.map((f) => [f.name, values[f.name]?.trim() ?? ""]));
              startScan(vendor, creds);
            }}
            manualOpen={manualOpen}
            onManualOpen={setManualOpen}
            onManual={manualAdd}
          />
        )}

        {step === 4 && vendor && (
          <StepName vendor={vendor} items={chosen} drafts={drafts} rooms={rooms} onDraft={patchDraft} onTest={testDevice} />
        )}
      </div>

      <div className={cn("wz-f", step === 1 && "solo")}>
        {step === 1 ? (
          <span />
        ) : (
          <button type="button" className="btn btn-sec btn-ico" onClick={back} disabled={busy}>
            <ArrowLeft className="i back-i" aria-hidden />
            Voltar
          </button>
        )}
        <div className="wz-fr">
          {hint && (
            <span className="hint" id="cont-why">
              {hint}
            </span>
          )}
          <button
            type="submit"
            className="btn"
            aria-disabled={!!hint || busy || (step === 1 && !vendors) || undefined}
            aria-describedby={hint ? "cont-why" : undefined}
            aria-busy={busy || undefined}
          >
            {busy && <Loader className="i i-sm spin" aria-hidden />}
            {primary}
            {step === 3 && chosen.length > 0 && <span className="num">({chosen.length})</span>}
          </button>
        </div>
      </div>
    </form>
      </div>
    </div>
  );
}
