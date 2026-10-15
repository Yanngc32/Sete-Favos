// Diálogos do menu ⋯: Renomear e Mudar de cômodo (primitives/dialog do kit).
import { MapPin, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { isGroup } from "@/lib/devices";
import { useLive } from "@/lib/live";
import type { Device } from "@/lib/types";
import { Opts } from "./controls";

interface Props {
  device: Device;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");

export function RenameDialog({ device, open, onOpenChange }: Props) {
  const id = useId();
  const { devices } = useLive();
  // Grupo: até 40 caracteres e nome único entre os grupos (a central só confere isso ao criar).
  const group = isGroup(device);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(device.name);
      setError(null);
    }
  }, [open, device.name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next) return setError(group ? "Dê um nome ao grupo." : "Dê um nome para o aparelho.");
    if (next === device.name) return onOpenChange(false);
    if (group && devices.some((d) => isGroup(d) && d.id !== device.id && d.name.toLocaleLowerCase("pt-BR") === next.toLocaleLowerCase("pt-BR"))) {
      return setError("Já existe um grupo com este nome.");
    }
    setBusy(true);
    try {
      await api.devices.update(device.id, { name: next });
      onOpenChange(false);
      toast({ tone: "ok", message: `Agora se chama ${next}` });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} initialFocus={input}>
      <form className="dsh-form" onSubmit={submit}>
        <ModalTitle render={<h3 />}>Renomear</ModalTitle>
        <div className="fld">
          <label htmlFor={`${id}-n`}>Nome</label>
          <div className={error ? "inp is-err" : "inp"}>
            <input
              ref={input}
              id={`${id}-n`}
              value={name}
              maxLength={group ? 40 : 60}
              autoComplete="off"
              aria-invalid={!!error}
              aria-describedby={`${id}-h`}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </div>
          <p className={error ? "hint err" : "hint"} id={`${id}-h`} role={error ? "alert" : undefined}>
            {error ?? "Como aparece na Início e nas automações."}
          </p>
        </div>
        <div className="dlg-act">
          <ModalClose className="btn btn-sec" type="button">
            Cancelar
          </ModalClose>
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

const NONE = "__none__";
const NEW = "__new__";

export function RoomDialog({ device, open, onOpenChange, rooms }: Props & { rooms: string[] }) {
  const id = useId();
  const [choice, setChoice] = useState<string>(device.room ?? NONE);
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freshRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setChoice(device.room ?? NONE);
      setFresh("");
      setError(null);
    }
  }, [open, device.room]);

  const opts = [
    ...rooms.map((r) => ({ value: r, label: r, Icon: MapPin })),
    { value: NONE, label: "Sem cômodo", Icon: MapPin },
    { value: NEW, label: "Novo cômodo", Icon: Plus },
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let room: string | null = choice === NONE ? null : choice;
    if (choice === NEW) {
      room = fresh.trim();
      if (!room) {
        setError("Dê um nome para o cômodo.");
        freshRef.current?.focus();
        return;
      }
    }
    if (room === device.room) return onOpenChange(false);
    setBusy(true);
    try {
      if (choice === NEW && room && !rooms.includes(room)) await api.rooms.add(room);
      await api.devices.update(device.id, room ? { room } : { clear_room: true });
      onOpenChange(false);
      toast({ tone: "ok", message: room ? `${device.name} agora está em ${room}` : `${device.name} ficou sem cômodo` });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <form className="dsh-form" onSubmit={submit}>
        <ModalTitle render={<h3 id={`${id}-t`} />}>Mudar de cômodo</ModalTitle>
        <Opts
          labelledBy={`${id}-t`}
          options={opts}
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setError(null);
            if (v === NEW) requestAnimationFrame(() => freshRef.current?.focus());
          }}
        />
        {choice === NEW && (
          <div className="fld">
            <label htmlFor={`${id}-n`}>Nome do cômodo</label>
            <div className={error ? "inp is-err" : "inp"}>
              <input
                ref={freshRef}
                id={`${id}-n`}
                value={fresh}
                maxLength={40}
                autoComplete="off"
                placeholder="Ex.: Varanda"
                onChange={(e) => {
                  setFresh(e.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>
        )}
        {error && (
          <p className="hint err" role="alert">
            {error}
          </p>
        )}
        <div className="dlg-act">
          <ModalClose className="btn btn-sec" type="button">
            Cancelar
          </ModalClose>
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
            Mover
          </button>
        </div>
      </form>
    </Modal>
  );
}

const TIMER_OPTIONS = [15, 30, 60, 120, 240];
const minutesText = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

/** "Desligar em…": a central desliga sozinha na hora (sobrevive a reinício; desligar antes cancela). */
export function TimerDialog({ device, open, onOpenChange }: Props) {
  const [busy, setBusy] = useState<number | "cancel" | null>(null);

  const set = async (minutes: number | null) => {
    setBusy(minutes ?? "cancel");
    try {
      await api.devices.timer(device.id, minutes);
      toast({ tone: "ok", message: minutes ? `${device.name} desliga em ${minutesText(minutes)}` : "Timer cancelado" });
      onOpenChange(false);
    } catch (err) {
      toast({ tone: "error", message: "Não consegui mudar o timer", detail: errMsg(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="dsh-form">
        <ModalTitle render={<h3 />}>Desligar em…</ModalTitle>
        <ModalDescription render={<p className="muted" />}>A central desliga {device.name} sozinha, mesmo com o app fechado.</ModalDescription>
        <div className="dt-timer-l" role="group" aria-label="Tempo">
          {TIMER_OPTIONS.map((m) => (
            <button key={m} type="button" className="btn btn-sec" disabled={busy !== null} aria-busy={busy === m || undefined} onClick={() => void set(m)}>
              {minutesText(m)}
            </button>
          ))}
        </div>
        <div className="dlg-act">
          {device.off_at && (
            <button type="button" className="btn btn-sec" disabled={busy !== null} aria-busy={busy === "cancel" || undefined} onClick={() => void set(null)}>
              Cancelar timer
            </button>
          )}
          <ModalClose className="btn btn-sec" type="button">
            Fechar
          </ModalClose>
        </div>
      </div>
    </Modal>
  );
}
