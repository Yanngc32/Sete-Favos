// Controle remoto da TV no detalhe: direcional + OK, voltar, início, menu e play/pause.
// Cada toque manda uma tecla (POST /remote); com o controle focado, as setas do teclado também valem.
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Menu, Pause, Play, type LucideIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEYBOARD: Record<string, string> = {
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT", Enter: "ENTER", Backspace: "BACK", Escape: "BACK",
};

export function Remote({ device, disabled }: { device: Device; disabled: boolean }) {
  const keys = new Set(device.remote ?? []);
  const [last, setLast] = useState<string | null>(null);

  const press = async (key: string) => {
    if (disabled || !keys.has(key)) return;
    navigator.vibrate?.(10);
    setLast(key);
    try {
      await api.devices.remote(device.id, key);
    } catch (e) {
      toast({ id: `remote-${device.id}`, tone: "error", message: e instanceof Error ? e.message : "A TV não respondeu" });
    } finally {
      setTimeout(() => setLast((k) => (k === key ? null : k)), 150);
    }
  };

  const btn = (key: string, label: string, Icon: LucideIcon, cls: string) =>
    keys.has(key) && (
      <button type="button" className={cn("rc-b", cls, last === key && "is-hit")} aria-label={label} disabled={disabled}
        onClick={() => void press(key)}>
        <Icon className="i" aria-hidden />
      </button>
    );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = KEYBOARD[e.key];
    if (!key || ((e.target as HTMLElement).tagName === "BUTTON" && e.key === "Enter")) return;
    e.preventDefault();
    void press(key);
  };

  return (
    <div className="ctl">
      <span className="lbl" id={`rc-${device.id}`}>Controle</span>
      {/* tabIndex: com o controle focado, as setas do teclado também valem */}
      <div className="rc" role="group" aria-labelledby={`rc-${device.id}`} tabIndex={0} onKeyDown={onKey}>
        <div className="rc-pad">
          {btn("UP", "Cima", ChevronUp, "rc-up")}
          {btn("LEFT", "Esquerda", ChevronLeft, "rc-left")}
          {keys.has("ENTER") && (
            <button type="button" className={cn("rc-b rc-ok", last === "ENTER" && "is-hit")} disabled={disabled} onClick={() => void press("ENTER")}>
              OK
            </button>
          )}
          {btn("RIGHT", "Direita", ChevronRight, "rc-right")}
          {btn("DOWN", "Baixo", ChevronDown, "rc-down")}
        </div>
        <div className="rc-row">
          {btn("BACK", "Voltar", ArrowLeft, "")}
          {btn("HOME", "Início", House, "")}
          {btn("MENU", "Menu", Menu, "")}
          {btn("PLAY", "Play", Play, "")}
          {btn("PAUSE", "Pausar", Pause, "")}
        </div>
      </div>
    </div>
  );
}
