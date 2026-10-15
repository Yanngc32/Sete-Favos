import { Radio } from "@base-ui/react/radio";
import { HexTile } from "@/components/favos";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, ChevronDown, CircleAlert, Power } from "lucide-react";
import { Loader } from "@/components/Logo";
import { kindIcon, KIND_LABEL } from "@/lib/devices";
import type { Kind, Vendor } from "@/lib/types";
import { ErrHint, ErrNote, TextField } from "./fields";
import { KINDS, NEW_ROOM, vendorShort, type Draft, type Found } from "./model";

export interface NameProps {
  vendor: Vendor;
  items: Found[];
  drafts: Record<string, Draft>;
  rooms: string[];
  onDraft: (key: string, patch: Partial<Draft>) => void;
  onTest: (key: string) => void;
}

/** Passo 4: um card por aparelho marcado (nome, cômodo, tipo detectado) + Testar. */
export function StepName({ vendor, items, drafts, rooms, onDraft, onTest }: NameProps) {
  return (
    <div className="devfs">
      {items.map(({ c }, i) => {
        const d = drafts[c.key];
        if (!d) return null;
        const Icon = kindIcon(d.kind);
        const k = `d${i}`;
        const kindLabelId = `${k}-kind`;
        const locked = !!d.deviceId;
        const kinds: Kind[] = KINDS.includes(d.kind) ? KINDS : [...KINDS, d.kind];
        return (
          <section key={c.key} className="devf" aria-labelledby={`${k}-h`}>
            <div className="devf-h">
              <HexTile icon={Icon} size="sm" variant="soft" />
              <span className="tx" id={`${k}-h`}>
                <span className="mono">
                  {vendorShort(vendor.label)}
                  {c.model ? ` · ${c.model}` : ""}
                </span>
                {c.ip && <span className="mono muted">{c.ip}</span>}
              </span>
              {locked && (
                <span className="chip ok">
                  <Check className="i i-sm" aria-hidden />
                  Cadastrado
                </span>
              )}
            </div>

            <TextField
              id={`${k}-name`}
              label="Nome"
              value={d.name}
              onChange={(v) => onDraft(c.key, { name: v, nameErr: undefined })}
              error={d.nameErr}
            />

            <div className="fld">
              <label htmlFor={`${k}-room`}>Cômodo</label>
              <div className="inp">
                <select
                  id={`${k}-room`}
                  value={d.room}
                  onChange={(e) => onDraft(c.key, { room: e.target.value, roomErr: undefined })}
                >
                  <option value="">Sem cômodo</option>
                  {rooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value={NEW_ROOM}>Novo cômodo…</option>
                </select>
                <ChevronDown className="i i-sm chev" aria-hidden />
              </div>
            </div>
            {d.room === NEW_ROOM && (
              <TextField
                id={`${k}-newroom`}
                label="Nome do cômodo novo"
                value={d.newRoom}
                onChange={(v) => onDraft(c.key, { newRoom: v, roomErr: undefined })}
                error={d.roomErr}
                placeholder="Escritório"
                autoFocus
              />
            )}

            <div className="fld">
              <span className="lbl" id={kindLabelId}>
                Tipo <span className="muted">· detectado</span>
              </span>
              <RadioGroup
                className="seg seg-full"
                aria-labelledby={kindLabelId}
                value={d.kind}
                onValueChange={(v) => onDraft(c.key, { kind: v as Kind })}
              >
                {kinds.map((kind) => (
                  <Radio.Root key={kind} value={kind} nativeButton render={<button type="button" />}>
                    {KIND_LABEL[kind]}
                  </Radio.Root>
                ))}
              </RadioGroup>
            </div>

            <div className="tres">
              <button
                type="button"
                className="btn btn-sec btn-sm btn-ico"
                onClick={() => onTest(c.key)}
                disabled={d.test?.status === "busy" || d.busy}
                aria-busy={d.test?.status === "busy"}
              >
                {d.test?.status === "busy" ? (
                  <Loader className="i i-sm spin" aria-hidden />
                ) : (
                  <Power className="i i-sm" aria-hidden />
                )}
                Testar
              </button>
              <span role="status" className="tres-s">
                {d.test?.status === "ok" && (
                  <span className="okt">
                    <Check className="i i-sm" aria-hidden />
                    {d.test.text}
                  </span>
                )}
                {d.test?.status === "fail" && (
                  <span className="bdt">
                    <CircleAlert className="i i-sm" aria-hidden />
                    {d.test.message}
                  </span>
                )}
              </span>
            </div>
            {d.err && (d.err.code === "rede" || d.err.code?.includes("sem_")
              ? <ErrNote err={d.err} />
              : <ErrHint id={`${k}-err`}>{d.err.message}</ErrHint>)}
          </section>
        );
      })}
    </div>
  );
}
