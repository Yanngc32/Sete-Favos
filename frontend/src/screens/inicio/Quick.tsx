// Rotinas rápidas (toque = executa, spinner → toast com Desfazer 5 s) e objetos virtuais fixados.
import { Check } from "lucide-react";
import { Loader } from "@/components/Logo";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Routine, RunResult, VirtualObject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HexTile } from "@/components/favos";
import { toast } from "@/components/toast";
import { routineIcon, virtualIcon } from "./home";

const UNDO_MS = 5000;

/** Toast do resultado: "Dormir executada" · "4 de 5 ok · TV da sala sem resposta". */
export function reportRun(name: string, res: RunResult) {
  const undo = { label: "Desfazer", onClick: () => void undoRun(name, res.id) };
  if (res.skipped) {
    toast({ id: `rot-${name}`, tone: "info", message: `${name} não rodou`, detail: res.skipped });
    return false;
  }
  if (res.errors.length === 0) {
    toast({
      id: `rot-${name}`,
      tone: "ok",
      message: `${name} executada`,
      detail: res.pending ? "O resto segue no horário" : undefined,
      action: undo,
      duration: UNDO_MS,
    });
    return true;
  }
  toast({
    id: `rot-${name}`,
    tone: "error",
    message: `${res.succeeded} de ${res.total} ok · ${res.errors[0]}`,
    action: res.succeeded > 0 ? undo : undefined,
    duration: res.succeeded > 0 ? UNDO_MS : 8000,
  });
  return res.succeeded > 0;
}

async function undoRun(name: string, runId: string) {
  try {
    const r = await api.runs.undo(runId);
    toast({
      id: `rot-${name}`,
      tone: r.errors.length ? "error" : "ok",
      message: r.errors.length ? `Desfeito em parte · ${r.errors[0]}` : `${name} desfeita`,
    });
  } catch (err) {
    toast({ id: `rot-${name}`, tone: "error", message: (err as Error).message });
  }
}

export async function runRoutine(r: Routine): Promise<boolean> {
  try {
    return reportRun(r.name, await api.routines.run(r.id));
  } catch (err) {
    toast({
      id: `rot-${r.name}`,
      tone: "error",
      message: `Não consegui executar ${r.name}`,
      detail: (err as Error).message,
      action: { label: "Tentar de novo", onClick: () => void runRoutine(r) },
      duration: 8000,
    });
    return false;
  }
}

/** Rodar uma rotina: spinner enquanto roda, "feito" por 5 s se deu certo. Uma por vez. */
export function useRoutineRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function run(r: Routine) {
    if (busy) return;
    setBusy(r.id);
    setDone(null);
    const ok = await runRoutine(r);
    setBusy(null);
    if (ok) {
      setDone(r.id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(null), UNDO_MS);
    }
  }
  return { busy, done, run };
}

export function Routines({ routines, disabled }: { routines: Routine[]; disabled: boolean }) {
  const { busy, done, run } = useRoutineRunner();

  if (!routines.length) return null;
  return (
    <div className="rots" role="group" aria-label="Rotinas">
      {routines.map((r) => {
        const Icon = busy === r.id ? Loader : done === r.id ? Check : routineIcon(r.name);
        return (
          <button
            key={r.id}
            type="button"
            className={cn("rot ini-rot", done === r.id && "is-done")}
            aria-busy={busy === r.id || undefined}
            disabled={disabled || Boolean(r.incomplete) || (busy !== null && busy !== r.id)}
            title={r.incomplete ?? undefined}
            onClick={() => void run(r)}
          >
            <HexTile
              icon={<Icon className={cn("i i-sm", busy === r.id && "spin")} aria-hidden />}
              variant={done === r.id ? "on" : "soft"}
              size="sm"
            />
            <span className="ini-rot-n">{r.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Liga/desliga objetos virtuais com o valor otimista até a central confirmar (ou falhar, com "Tentar de novo"). */
export function useVirtualFlip(virtuals: VirtualObject[]) {
  const [pend, setPend] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Solta o otimista quando a central confirma.
    setPend((p) => {
      const next = { ...p };
      let changed = false;
      for (const v of virtuals) {
        if (v.id in next && next[v.id] === v.value) {
          delete next[v.id];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [virtuals]);

  async function flip(v: VirtualObject, value: boolean) {
    setPend((p) => ({ ...p, [v.id]: value }));
    try {
      await api.virtuals.set(v.id, value);
    } catch {
      setPend((p) => {
        const next = { ...p };
        delete next[v.id];
        return next;
      });
      toast({
        id: `vir-${v.id}`,
        tone: "error",
        message: `Não consegui ${value ? "ligar" : "desligar"} ${v.name}`,
        action: { label: "Tentar de novo", onClick: () => void flip(v, value) },
        duration: 8000,
      });
    }
  }

  return { valueOf: (v: VirtualObject) => pend[v.id] ?? v.value, flip };
}

export function Virtuals({ virtuals, disabled }: { virtuals: VirtualObject[]; disabled: boolean }) {
  const { valueOf, flip } = useVirtualFlip(virtuals);

  if (!virtuals.length) return null;
  return (
    <div className="objs" role="group" aria-label="Objetos virtuais">
      {virtuals.map((v) => {
        const value = valueOf(v);
        const Icon = virtualIcon(v.name);
        return (
          <span key={v.id} className={cn("obj ini-obj", value && "on")}>
            <HexTile icon={<Icon className="i i-sm" aria-hidden />} variant={value ? "on" : "neutral"} size="sm" />
            <span className="ini-obj-tx">
              <b className="ini-obj-n">{v.name}</b>
              <span>{value ? "Ligado" : "Desligado"}</span>
            </span>
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={value}
              aria-label={`${value ? "Desligar" : "Ligar"} ${v.name}`}
              disabled={disabled}
              onClick={() => void flip(v, !value)}
            />
          </span>
        );
      })}
    </div>
  );
}
