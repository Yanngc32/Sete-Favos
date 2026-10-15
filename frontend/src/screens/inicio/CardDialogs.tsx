// Renomear e Mudar de cômodo (abertos pelo menu do card), via api.devices.update.
import { Check } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { Device } from "@/lib/types";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "@/components/Modal";
import { toast } from "@/components/toast";

export function RenameDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (device) {
      setName(device.name);
      setErr(null);
    }
  }, [device]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!device) return;
    const next = name.trim();
    if (!next) return setErr("Dê um nome ao aparelho.");
    if (next === device.name) return onClose();
    setBusy(true);
    try {
      await api.devices.update(device.id, { name: next });
      toast({ tone: "ok", message: `Agora é ${next}` });
      onClose();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={device !== null} onOpenChange={(o) => !o && onClose()} className="mk">
      <form onSubmit={save} className="ini-dlg-f">
        <ModalTitle render={<h3 />}>Renomear</ModalTitle>
        <ModalDescription render={<p />}>Como esse aparelho aparece no painel.</ModalDescription>
        <div className="fld">
          <label htmlFor="ini-rename">Nome</label>
          <div className={err ? "inp is-err" : "inp"}>
            <input
              id="ini-rename"
              value={name}
              autoComplete="off"
              maxLength={60}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? "ini-rename-err" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
            />
          </div>
          {err && (
            <p className="hint err" id="ini-rename-err">
              {err}
            </p>
          )}
        </div>
        <div className="dlg-act">
          <ModalClose type="button" className="btn btn-sec">
            Cancelar
          </ModalClose>
          <button type="submit" className="btn" disabled={busy} aria-busy={busy || undefined}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveDialog({ device, rooms, onClose }: { device: Device | null; rooms: string[]; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function move(room: string | null) {
    if (!device) return;
    if (room === device.room) return onClose();
    setBusy(room ?? "");
    try {
      await api.devices.update(device.id, room === null ? { clear_room: true } : { room });
      toast({ tone: "ok", message: room ? `${device.name} agora está em ${room}` : `${device.name} ficou sem cômodo` });
      onClose();
    } catch (error) {
      toast({ tone: "error", message: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const options: (string | null)[] = [...rooms, null];
  return (
    <Modal open={device !== null} onOpenChange={(o) => !o && onClose()} className="mk">
      <ModalTitle render={<h3 />}>Mudar de cômodo</ModalTitle>
      <ModalDescription render={<p />}>{device ? `Onde fica ${device.name}?` : ""}</ModalDescription>
      <div className="ini-rooms-l" role="radiogroup" aria-label="Cômodo">
        {options.map((r) => {
          const current = device ? (device.room ?? null) === r : false;
          return (
            <button
              key={r ?? "-"}
              type="button"
              role="radio"
              aria-checked={current}
              disabled={busy !== null}
              aria-busy={busy === (r ?? "") || undefined}
              onClick={() => void move(r)}
            >
              {r ?? "Sem cômodo"}
              {current && <Check className="i i-sm" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="dlg-act">
        <ModalClose type="button" className="btn btn-sec">
          Cancelar
        </ModalClose>
      </div>
    </Modal>
  );
}

const TIMER_OPTIONS = [15, 30, 60, 120, 240];

const minutesText = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

/** "Desligar em...": a central desliga sozinha na hora (sobrevive a reinício; desligar antes cancela). */
export function TimerDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const [busy, setBusy] = useState<number | "cancel" | null>(null);

  async function set(minutes: number | null) {
    if (!device) return;
    setBusy(minutes ?? "cancel");
    try {
      await api.devices.timer(device.id, minutes);
      toast({ tone: "ok", message: minutes ? `${device.name} desliga em ${minutesText(minutes)}` : "Timer cancelado" });
      onClose();
    } catch (error) {
      toast({ tone: "error", message: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={device !== null} onOpenChange={(o) => !o && onClose()} className="mk">
      <ModalTitle render={<h3 />}>Desligar em…</ModalTitle>
      <ModalDescription render={<p />}>{device ? `A central desliga ${device.name} sozinha.` : ""}</ModalDescription>
      <div className="ini-rooms-l" role="group" aria-label="Tempo">
        {TIMER_OPTIONS.map((m) => (
          <button key={m} type="button" disabled={busy !== null} aria-busy={busy === m || undefined} onClick={() => void set(m)}>
            {minutesText(m)}
          </button>
        ))}
      </div>
      <div className="dlg-act">
        {device?.off_at && (
          <button type="button" className="btn btn-sec" disabled={busy !== null} aria-busy={busy === "cancel" || undefined} onClick={() => void set(null)}>
            Cancelar timer
          </button>
        )}
        <ModalClose type="button" className="btn btn-sec">
          Fechar
        </ModalClose>
      </div>
    </Modal>
  );
}
