// Comandos do Detalhe: valor otimista por capacidade, volta ao valor real se falhar (+ toast "Tentar de novo"),
// e o "junta toques" dos botões −/+ (temperatura do ar e volume mandam 1 comando 600 ms depois do último toque).
import { useCallback, useEffect, useRef, useState } from "react";
import { toastPartial } from "@/components/partialToast";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { int } from "@/lib/format";
import { optionLabel } from "@/lib/devices";
import type { Device } from "@/lib/types";
import { colorName } from "./colors";

const SETTLE_MS = 2500;
export const BATCH_MS = 600;

/** Valor legível de uma capacidade, para "Continua em 22 °C". */
export function describe(device: Device, capability: string, value: unknown): string {
  if (value == null) return "—";
  switch (capability) {
    case "power":
      return value ? "ligado" : "desligado";
    case "target_temp":
      return `${int.format(Number(value))} °C`;
    case "brightness":
      return `${Math.round(Number(value))}%`;
    case "volume":
      return String(Math.round(Number(value)));
    case "muted":
      return value ? "mudo" : "com som";
    case "color_temp":
      return warmth(Number(value)).toLowerCase();
    case "color":
      return colorName(String(value)) ?? String(value);
    default:
      return optionLabel(device, capability, value) ?? String(value);
  }
}

export function warmth(pct: number): string {
  return pct <= 33 ? "Quente" : pct >= 67 ? "Fria" : "Neutra";
}

const ACTION_VERB: Record<string, string> = {
  start: "iniciar",
  pause: "pausar",
  dock: "mandar de volta à base",
  locate: "bipar",
};

export interface Control {
  /** Valor mostrado: o otimista (se houver) ou o real. */
  value: <T = unknown>(capability: string) => T;
  pending: (capability: string) => boolean;
  send: (capability: string, value?: unknown) => Promise<boolean>;
  /** −/+ agrupados: mostra na hora, manda depois de BATCH_MS sem toque. */
  bump: (capability: string, next: number) => void;
}

export function useControl(device: Device): Control {
  const [over, setOver] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState<Record<string, number>>({});
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const seq = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const batched = useRef<Record<string, number>>({});

  // O estado real alcançou o otimista: some o otimista (o que vier de fora depois disso manda).
  useEffect(() => {
    setOver((o) => {
      const keys = Object.keys(o).filter((k) => !(k in batched.current) && same(o[k], device.state[k]));
      if (!keys.length) return o;
      const next = { ...o };
      for (const k of keys) delete next[k];
      return next;
    });
  }, [device.state]);

  const drop = useCallback((capability: string, mySeq: number) => {
    if (seq.current[capability] !== mySeq) return;
    setOver((o) => {
      if (!(capability in o)) return o;
      const next = { ...o };
      delete next[capability];
      return next;
    });
  }, []);

  const send = useCallback(
    async (capability: string, value?: unknown): Promise<boolean> => {
      const d = deviceRef.current;
      const isAction = d.capabilities.find((c) => c.id === capability)?.type === "action";
      const mySeq = (seq.current[capability] ?? 0) + 1;
      seq.current[capability] = mySeq;
      if (!isAction) setOver((o) => ({ ...o, [capability]: value }));
      setBusy((b) => ({ ...b, [capability]: (b[capability] ?? 0) + 1 }));
      try {
        // Comando em grupo em que parte dos aparelhos não respondeu: "2 de 3 ok · TV da sala sem resposta".
        toastPartial(await api.devices.command(d.id, capability, value));
        // Se o retrato ao vivo não confirmar (ex.: o aparelho normaliza o valor), solta o otimista depois.
        setTimeout(() => drop(capability, mySeq), SETTLE_MS);
        return true;
      } catch (err) {
        drop(capability, mySeq);
        const now = deviceRef.current;
        const message = isAction
          ? `Não consegui ${ACTION_VERB[capability] ?? "mandar o comando para"} ${now.name}`
          : `Não consegui mudar ${now.name}`;
        const detail = isAction
          ? err instanceof Error ? err.message : undefined
          : `Continua em ${describe(now, capability, now.state[capability])}`;
        toast({
          id: `cmd-${now.id}-${capability}`,
          tone: "error",
          message,
          detail,
          duration: 8000,
          action: { label: "Tentar de novo", onClick: () => void send(capability, value) },
        });
        return false;
      } finally {
        setBusy((b) => ({ ...b, [capability]: Math.max(0, (b[capability] ?? 1) - 1) }));
      }
    },
    [drop],
  );

  const flush = useCallback(
    (capability: string) => {
      clearTimeout(timers.current[capability]);
      delete timers.current[capability];
      if (!(capability in batched.current)) return;
      const next = batched.current[capability];
      delete batched.current[capability];
      if (same(next, deviceRef.current.state[capability])) {
        setOver((o) => {
          const n = { ...o };
          delete n[capability];
          return n;
        });
        return;
      }
      void send(capability, next);
    },
    [send],
  );

  const bump = useCallback(
    (capability: string, next: number) => {
      batched.current[capability] = next;
      setOver((o) => ({ ...o, [capability]: next }));
      clearTimeout(timers.current[capability]);
      timers.current[capability] = setTimeout(() => flush(capability), BATCH_MS);
    },
    [flush],
  );

  // Fechou o painel com toque pendente: manda na hora em vez de perder.
  useEffect(
    () => () => {
      for (const capability of Object.keys(batched.current)) flush(capability);
    },
    [flush],
  );

  const value = useCallback(
    <T,>(capability: string) => (capability in over ? over[capability] : device.state[capability]) as T,
    [over, device.state],
  );
  const pending = useCallback((capability: string) => (busy[capability] ?? 0) > 0, [busy]);

  return { value, pending, send, bump };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  return a === b;
}
