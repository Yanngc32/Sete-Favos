// Seção "Horários" do Detalhe (mock "Sete Favos", tela 2): automações por hora/sol que mexem no aparelho.
// Cada card: nome + dias, switch de ativar, de/até, editar (abre o editor) e apagar (com confirmação).
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Confirm } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import type { Automation, Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { schedulesOf, type Schedule, type Slot } from "./schedule";

interface Props {
  device: Device;
  automations: Automation[];
  /** Abre/fecha o véu do sheet enquanto a confirmação está aberta. */
  onDialog?: (open: boolean) => void;
}

export function Schedules({ device, automations, onDialog }: Props) {
  const id = useId();
  const items = schedulesOf(device, automations);
  // Ativar/desativar otimista até o live confirmar.
  const [over, setOver] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // O otimista sai quando o live confirmar (senão o switch volta por um instante).
  useEffect(() => {
    setOver((o) => {
      const left = Object.entries(o).filter(([k, v]) => automations.find((a) => a.id === k)?.enabled !== v);
      return left.length === Object.keys(o).length ? o : Object.fromEntries(left);
    });
  }, [automations]);
  const [doomed, setDoomed] = useState<Automation | null>(null);
  const [removing, setRemoving] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const enabled = (a: Automation) => over[a.id] ?? a.enabled;

  const toggle = async (a: Automation) => {
    const next = !enabled(a);
    setOver((o) => ({ ...o, [a.id]: next }));
    setBusy((b) => ({ ...b, [a.id]: true }));
    try {
      await api.automations.enable(a.id, next);
    } catch (e) {
      setOver(({ [a.id]: _, ...rest }) => rest);
      toast({ tone: "error", message: next ? `Não consegui ativar ${a.name}` : `Não consegui desativar ${a.name}`, detail: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(({ [a.id]: _, ...rest }) => rest);
    }
  };

  const remove = async () => {
    if (!doomed) return;
    setRemoving(true);
    try {
      await api.automations.remove(doomed.id);
      toast({ tone: "ok", message: `${doomed.name} apagada` });
      setDoomed(null);
      onDialog?.(false);
    } catch (e) {
      toast({ tone: "error", message: `Não consegui apagar ${doomed.name}`, detail: e instanceof Error ? e.message : undefined });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="dt-sec" aria-labelledby={`${id}-h`}>
      <div className="dt-sec-h">
        <h2 id={`${id}-h`}>
          Horários <span className="cnt">{items.length}</span>
        </h2>
        <Link className="ibtn bd" to="/automacoes/nova-automacao" aria-label="Novo horário">
          <Plus className="i" aria-hidden />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="dt-none">Nenhum horário liga ou desliga {device.name} ainda.</p>
      ) : (
        <ul className="dt-ags">
          {items.map((s) => (
            <ScheduleCard
              key={s.automation.id}
              s={s}
              on={enabled(s.automation)}
              busy={!!busy[s.automation.id]}
              onToggle={() => void toggle(s.automation)}
              onRemove={() => {
                setDoomed(s.automation);
                onDialog?.(true);
              }}
            />
          ))}
        </ul>
      )}
      <Confirm
        open={!!doomed}
        onOpenChange={(o) => {
          if (!o) {
            setDoomed(null);
            onDialog?.(false);
          }
        }}
        title={doomed ? `Apagar ${doomed.name}?` : ""}
        description="A automação some e o aparelho deixa de ligar ou desligar nesse horário."
        confirmLabel="Apagar"
        onConfirm={() => void remove()}
        busy={removing}
        cancelRef={cancelRef}
      />
    </section>
  );
}

function ScheduleCard({ s, on, busy, onToggle, onRemove }: { s: Schedule; on: boolean; busy: boolean; onToggle: () => void; onRemove: () => void }) {
  const a = s.automation;
  return (
    <li className={cn("dt-ag", on && "on")}>
      <div className="dt-ag-h">
        <div className="dt-ag-tx">
          <b>{a.name}</b>
          <span>
            {s.days}
            {!on && " · desativada"}
            {a.incomplete && <span className="dt-ag-w"> · incompleta</span>}
          </span>
        </div>
        <button
          type="button"
          className="sw"
          role="switch"
          aria-checked={on}
          aria-busy={busy || undefined}
          aria-label={`${on ? "Desativar" : "Ativar"} ${a.name}`}
          onClick={onToggle}
        />
      </div>
      <div className="dt-ag-b">
        <Time slot={s.from} />
        <span className="dt-ag-vr" aria-hidden />
        <Time slot={s.to} />
        <div className="dt-ag-a">
          <Link className="ibtn" to={`/automacoes/${encodeURIComponent(a.id)}`} aria-label={`Editar ${a.name}`}>
            <Pencil className="i i-sm" aria-hidden />
          </Link>
          <button type="button" className="ibtn" aria-label={`Apagar ${a.name}`} onClick={onRemove}>
            <Trash2 className="i i-sm" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

function Time({ slot }: { slot: Slot }) {
  return (
    <div className="dt-ag-t">
      <span>{slot.label}</span>
      <b className={cn(slot.word && "w")}>{slot.value}</b>
    </div>
  );
}
