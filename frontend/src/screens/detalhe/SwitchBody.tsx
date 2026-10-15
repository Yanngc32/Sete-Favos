// Corpo do Detalhe do interruptor de várias teclas: linha "todas" (mesmo visual do grupo) e uma linha por
// tecla, cada uma com switch próprio e nome editável (cada tecla pode controlar uma coisa diferente).
import { Check, Pencil, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { switchKeys } from "@/lib/devices";
import type { Capability } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BodyProps } from "./bodies";

export function SwitchBody({ device, ctl, disabled, inHero }: BodyProps) {
  const keys = switchKeys(device);
  const power = ctl.value("power") === true;
  const onCount = keys.filter((k) => ctl.value(k.id) === true).length;

  return (
    <>
      {!inHero && (
      <div className={cn("g-main", power && !disabled && "on")}>
        <div className="g-main-tx">
          <span className="g-main-t">{power ? "Ligado" : "Desligado"}</span>
          <span className="g-main-s num">
            {onCount} de {keys.length} teclas ligadas
          </span>
        </div>
        <button
          type="button"
          className="sw sw-lg"
          role="switch"
          aria-checked={power}
          aria-busy={ctl.pending("power") || undefined}
          aria-label={power ? "Desligar todas as teclas" : "Ligar todas as teclas"}
          disabled={disabled}
          onClick={() => void ctl.send("power", !power)}
        />
      </div>
      )}
      <ul className="list keys" aria-label="Teclas">
        {keys.map((k) => (
          <KeyRow key={k.id} deviceId={device.id} cap={k} on={ctl.value(k.id) === true} pending={ctl.pending(k.id)}
            disabled={disabled} onToggle={(v) => void ctl.send(k.id, v)} />
        ))}
      </ul>
    </>
  );
}

interface KeyRowProps {
  deviceId: string;
  cap: Capability;
  on: boolean;
  pending: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}

function KeyRow({ deviceId, cap, on, pending, disabled, onToggle }: KeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cap.label);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (next === cap.label) return setEditing(false);
    setSaving(true);
    try {
      // Vazio volta ao nome padrão ("Tecla N"); a central publica o aparelho atualizado pelo live.
      await api.devices.update(deviceId, { labels: { [cap.id]: next } });
      setEditing(false);
    } catch (err) {
      toast({ tone: "error", message: "Não consegui renomear a tecla", detail: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="li">
      {editing ? (
        <form className="li-tx key-ed" onSubmit={save}>
          <div className="inp">
            <input
              autoFocus
              value={name}
              maxLength={40}
              aria-label={`Nome da ${cap.label}`}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setName(cap.label), setEditing(false))}
            />
          </div>
          <button type="submit" className="ibtn" aria-label="Salvar nome" aria-busy={saving || undefined} disabled={saving}>
            <Check className="i i-sm" aria-hidden />
          </button>
          <button type="button" className="ibtn" aria-label="Cancelar" onClick={() => (setName(cap.label), setEditing(false))}>
            <X className="i i-sm" aria-hidden />
          </button>
        </form>
      ) : (
        <div className="li-tx key-tx">
          <span className="li-t">{cap.label}</span>
          <button type="button" className="ibtn" aria-label={`Renomear ${cap.label}`} onClick={() => (setName(cap.label), setEditing(true))}>
            <Pencil className="i i-sm" aria-hidden />
          </button>
        </div>
      )}
      <button
        type="button"
        className="sw"
        role="switch"
        aria-checked={on}
        aria-busy={pending || undefined}
        aria-label={`${on ? "Desligar" : "Ligar"} ${cap.label}`}
        disabled={disabled}
        onClick={() => onToggle(!on)}
      />
    </li>
  );
}
