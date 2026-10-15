import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

// Toasts do kit (.toast grafite). Um por vez por id; os novos ficam embaixo.
export interface ToastInput {
  /** Mesmo id substitui o toast anterior (ex.: rotina rodando → executada). */
  id?: string;
  message: string;
  detail?: string;
  tone?: "ok" | "error" | "info";
  action?: { label: string; onClick: () => void };
  /** ms; 0 = fica até fechar. Padrão 5 s (o "Desfazer" vale 5 s). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastInput, "id" | "message" | "tone" | "duration">> {
  detail?: string;
  action?: ToastInput["action"];
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let seq = 0;

export function toast(input: ToastInput): string {
  const id = input.id ?? `t${++seq}`;
  const item: ToastItem = {
    id,
    message: input.message,
    detail: input.detail,
    tone: input.tone ?? "info",
    action: input.action,
    duration: input.duration ?? 5000,
  };
  items = [...items.filter((t) => t.id !== id), item];
  emit();
  return id;
}

export function dismissToast(id: string) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
}

function ToastView({ item }: { item: ToastItem }) {
  useEffect(() => {
    if (!item.duration) return;
    const timer = setTimeout(() => dismissToast(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item]);

  const Icon = item.tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div className="toast" role={item.tone === "error" ? "alert" : "status"}>
      {item.tone !== "info" && <Icon className={item.tone === "error" ? "i bad" : "i ok"} aria-hidden />}
      <p className="msg">
        {item.message}
        {item.detail && <small>{item.detail}</small>}
      </p>
      {item.action ? (
        <button
          type="button"
          className="act"
          onClick={() => {
            dismissToast(item.id);
            item.action?.onClick();
          }}
        >
          {item.action.label}
        </button>
      ) : (
        <button type="button" className="act x" aria-label="Fechar aviso" onClick={() => dismissToast(item.id)}>
          <X className="i i-sm" aria-hidden />
        </button>
      )}
      {/* Tempo que resta pra ação (ex.: Desfazer vale 5 s). */}
      {item.action && item.duration > 0 && (
        <span className="toast-prog" aria-hidden style={{ animationDuration: `${item.duration}ms` }} />
      )}
    </div>
  );
}

export function Toaster() {
  const list = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  );
}
