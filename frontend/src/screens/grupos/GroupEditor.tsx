// Tela: Criar e editar grupo (mock aprovado "Criar e editar grupo").
// PC (≥1024px): dialog de 560px. Celular: folha de baixo em tela cheia (Drawer do Base UI, fecha arrastando pelo
// cabeçalho). Estrutura de dialog, sheet e checkbox: Wensity UI (primitives/dialog, primitives/sheet, primitives/checkbox),
// MIT, Copyright (c) 2026 Wensity Private Limited · restilizada com os tokens do DS.
//
// GroupSession = uma abertura do editor (o estado do formulário nasce e morre com ela). Quem usa:
// GroupDialogHost (aberto por openGroupDialog, em qualquer tela) e o Detalhe do grupo (aninhado no sheet, "Editar grupo").
import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import { ChevronDown, CircleAlert, Info, Layers, Ungroup, X } from "lucide-react";
import { HexTile } from "@/components/favos";
import { Loader } from "@/components/Logo";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Confirm } from "@/components/Modal";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { isGroup, usedBy } from "@/lib/devices";
import { useLive } from "@/lib/live";
import { DESKTOP, useMedia } from "@/lib/media";
import type { Capability } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DevicePicker, MAX_MEMBERS, MIN_MEMBERS } from "./DevicePicker";
import { flashNew, groupFocusTarget, type GroupDialogRequest } from "./groupDialog";
import "./grupos.css";

const NAME_MAX = 40;
const PREVIEW_DELAY = 220;

/** Nome de cada controle em comum nos chips ("Ligar e desligar · Brilho · Temperatura de cor"). */
const capLabel = (c: Capability) => (c.id === "power" ? "Ligar e desligar" : c.label);

interface Preview {
  key: string;
  caps: Capability[];
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

const host = () => document.getElementById("root");

export interface GroupSessionProps {
  request: GroupDialogRequest;
  /** false = pediu para fechar: toca a saída e depois chama onGone. */
  active: boolean;
  onClose: () => void;
  onGone: () => void;
  /** O grupo foi desfeito (quem mostra o grupo, como o Detalhe, precisa sair dele). */
  onUndone?: () => void;
  /** Antes de pedir pra desfazer: o aviso ao vivo do grupo apagado pode chegar antes da resposta. */
  onUndoStart?: () => void;
  /** Para onde o foco volta ao fechar (padrão: quem abriu). */
  finalFocus?: () => HTMLElement | null;
}

export function GroupSession({ request, active, onClose, onGone, onUndone, onUndoStart, finalFocus }: GroupSessionProps) {
  const live = useLive();
  const desktop = useMedia(DESKTOP);
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Nasce fechado e abre no primeiro efeito: assim o Base UI aplica o data-starting-style (entrada animada).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const open = mounted && active;

  const liveGroup = request.edit ? live.devices.find((d) => d.id === request.edit && isGroup(d)) : undefined;
  // Grupo desfeito/apagado por fora: mantém o último visto enquanto o editor anima a saída (senão vira "Novo grupo").
  const lastGroup = useRef(liveGroup);
  if (liveGroup) lastGroup.current = liveGroup;
  const editing = liveGroup ?? (request.edit ? lastGroup.current : undefined);
  const candidates = useMemo(() => live.devices.filter((d) => !isGroup(d)), [live.devices]);
  const candidateIds = useMemo(() => new Set(candidates.map((d) => d.id)), [candidates]);

  // Estado inicial (uma vez por abertura): grupo existente, ou aparelhos pré-marcados.
  // Só congela quando a lista de aparelhos já chegou; antes disso o editor nasceria vazio e "alterado".
  const seed = () => ({
    name: editing?.name ?? "",
    room: editing?.room ?? "",
    ids: editing ? [...(editing.members ?? [])] : (request.preselect ?? []).filter((id) => candidateIds.has(id)),
  });
  const orig = useRef<{ name: string; room: string; ids: string[] } | null>(null);
  const seededLate = useRef(false);
  if (!orig.current && live.loaded) orig.current = seed();
  const base = orig.current ?? { name: "", room: "", ids: [] };
  const [name, setName] = useState(base.name);
  const [room, setRoom] = useState(base.room);
  const [picked, setPicked] = useState<string[]>(base.ids);
  useEffect(() => {
    if (!live.loaded || seededLate.current) return;
    seededLate.current = true;
    if (orig.current) return;
    orig.current = seed();
    setName(orig.current.name);
    setRoom(orig.current.room);
    setPicked(orig.current.ids);
    // seed lê o estado do render atual; roda uma vez quando a lista chega.
  }, [live.loaded]);
  const [touched, setTouched] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [undoing, setUndoing] = useState(false);

  // Aparelho removido enquanto o editor está aberto sai da seleção; grupo apagado por fora fecha o editor.
  const ids = useMemo(() => picked.filter((id) => candidateIds.has(id)), [picked, candidateIds]);
  useEffect(() => {
    if (request.edit && live.loaded && !liveGroup && active) onClose();
  }, [request.edit, live.loaded, liveGroup, active, onClose]);

  // ---- validação ----
  const trimmed = name.trim();
  const taken = active && !busy && live.devices.some((d) => isGroup(d) && d.id !== editing?.id && d.name.trim().toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"));
  const nameError = serverName ?? (taken && trimmed ? "Já existe um grupo com este nome." : touched && !trimmed ? "Dê um nome ao grupo." : null);
  const count = ids.length;
  const valid = !!trimmed && !taken && count >= MIN_MEMBERS && count <= MAX_MEMBERS;
  const dirty = name !== base.name || room !== base.room || !sameIds(ids, base.ids);

  // ---- "Controles em comum" ao vivo ----
  const key = ids.join(",");
  const [preview, setPreview] = useState<Preview | null>(() => (editing ? { key, caps: editing.capabilities } : null));
  const [previewFailed, setPreviewFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (count < MIN_MEMBERS || count > MAX_MEMBERS) return;
    const mine = ++seq.current;
    setPreviewFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await api.groups.preview(ids);
        if (mine !== seq.current) return;
        setPreview({ key, caps: res.capabilities });
        setPreviewFailed(false);
      } catch {
        if (mine === seq.current) setPreviewFailed(true);
      }
    }, PREVIEW_DELAY);
    return () => clearTimeout(timer);
    // `ids` só muda junto com `key`.
  }, [key]);

  // ---- ações ----
  const rooms = useMemo(() => (room && !live.rooms.includes(room) ? [...live.rooms, room] : live.rooms), [live.rooms, room]);

  const fail = (err: unknown) => {
    const msg = err instanceof Error ? err.message : "Algo deu errado. Tente de novo.";
    if (/nome/i.test(msg)) setServerName(msg);
    else setFormError(msg);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    if (editing && !dirty) return onClose();
    setBusy(true);
    setFormError(null);
    try {
      if (editing) {
        const nameChanged = trimmed !== editing.name;
        const roomChanged = room !== (editing.room ?? "");
        if (nameChanged || roomChanged) {
          await api.devices.update(editing.id, {
            ...(nameChanged ? { name: trimmed } : {}),
            ...(roomChanged ? (room ? { room } : { clear_room: true }) : {}),
          });
          if (orig.current) orig.current = { ...orig.current, name, room };
        }
        if (!sameIds(ids, base.ids)) await api.groups.setMembers(editing.id, ids);
        toast({ tone: "ok", message: `Grupo ${trimmed} salvo` });
        onClose();
      } else {
        const created = await api.groups.create({ name: trimmed, room: room || null, members: ids });
        toast({ tone: "ok", message: `Grupo ${created.name} criado` });
        onClose();
        flashNew(created.id);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!editing) return;
    setUndoing(true);
    onUndoStart?.();
    try {
      await api.devices.remove(editing.id);
      onUndone?.();
      setConfirm(false);
      toast({ tone: "ok", message: `Grupo ${editing.name} desfeito` });
      onClose();
    } catch (err) {
      setConfirm(false);
      toast({ tone: "error", message: `Não consegui desfazer ${editing.name}`, detail: err instanceof Error ? err.message : undefined });
    } finally {
      setUndoing(false);
    }
  };

  const used = editing ? usedBy(editing.id, live.automations, live.routines).total : 0;
  const undoText =
    used > 0
      ? "Os aparelhos continuam como estão. Rotinas e automações que usam o grupo ficam incompletas."
      : "Os aparelhos continuam como estão.";

  const onOpenChange = (next: boolean, details?: { reason?: string; cancel: () => void }) => {
    if (next) return;
    // Clique fora não joga fora o que foi digitado; Esc, X e Cancelar fecham.
    if (dirty && !busy && details?.reason === "outside-press") {
      details.cancel();
      return;
    }
    onClose();
  };

  const title = editing ? "Editar grupo" : "Novo grupo";
  const nameId = `${uid}-nome`;
  const roomId = `${uid}-comodo`;

  const undoButton = editing && (
    <button type="button" className="btn btn-ghost btn-ico g-dz" onClick={() => setConfirm(true)}>
      <Ungroup className="i" aria-hidden />
      Desfazer grupo
    </button>
  );

  const fields = (
    <>
      <div className="g-row2">
        <div className="fld">
          <div className="g-lb">
            <label className="lbl" htmlFor={nameId}>
              Nome
            </label>
            <span className="g-ct num" aria-hidden>
              {name.length}/{NAME_MAX}
            </span>
          </div>
          <div className={cn("inp", nameError && "is-err")}>
            <input
              ref={nameRef}
              id={nameId}
              value={name}
              maxLength={NAME_MAX}
              placeholder="Luzes da sala"
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${nameId}-m` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setServerName(null);
                setTouched(true);
              }}
            />
          </div>
          {nameError && (
            <p className="hint err" id={`${nameId}-m`} role="alert">
              <CircleAlert className="i i-sm" aria-hidden />
              {nameError}
            </p>
          )}
        </div>
        <div className="fld">
          <label className="lbl" htmlFor={roomId}>
            Cômodo <span className="muted">· opcional</span>
          </label>
          <div className={cn("inp", !room && "is-ph")}>
            <select id={roomId} value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">Sem cômodo</option>
              {rooms.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <ChevronDown className="i i-sm" aria-hidden />
          </div>
        </div>
      </div>

      <DevicePicker devices={candidates} selected={ids} onChange={setPicked} />

      <Common count={count} preview={preview} stale={!!preview && preview.key !== key} failed={previewFailed} />

      {formError && (
        <p className="hint err" role="alert">
          <CircleAlert className="i i-sm" aria-hidden />
          {formError}
        </p>
      )}
      {/* No celular o rodapé tem só Cancelar e Salvar; "Desfazer grupo" fica no fim do corpo. */}
      {!desktop && undoButton && <div className="g-undo">{undoButton}</div>}
    </>
  );

  const submitButton = (
    <button type="submit" className="btn" disabled={!valid || busy} aria-busy={busy || undefined}>
      {busy && <Loader className="i i-sm spin" aria-hidden />}
      {editing ? "Salvar" : "Criar grupo"}
    </button>
  );
  const cancelButton = (
    <button type="button" className="btn btn-sec" onClick={onClose}>
      Cancelar
    </button>
  );

  const confirmEl = editing && (
    <Confirm
      open={confirm}
      onOpenChange={setConfirm}
      title={`Desfazer o grupo ${editing.name}?`}
      description={undoText}
      confirmLabel="Desfazer grupo"
      onConfirm={() => void undo()}
      busy={undoing}
      cancelRef={cancelRef}
    />
  );

  const restore = () => (finalFocus?.() ?? groupFocusTarget(request)) || true;

  if (desktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(o) => !o && onGone()}>
        <Dialog.Portal className="mk" container={host()}>
          <Dialog.Backdrop className="scrim gp-scrim" forceRender />
          <Dialog.Viewport className="overlay-c gp-vp">
            <Dialog.Popup className={cn("dlg gd gp", confirm && "is-veiled")} initialFocus={nameRef} finalFocus={restore}>
              <form className="gp-form" onSubmit={(e) => void submit(e)} noValidate>
                <div className="gd-hd">
                  <HexTile icon={Layers} variant="soft" size="sm" />
                  <Dialog.Title render={<h3 />}>{title}</Dialog.Title>
                  <Dialog.Close className="ibtn" aria-label="Fechar">
                    <X className="i" aria-hidden />
                  </Dialog.Close>
                </div>
                <div className="gd-bd">{fields}</div>
                <div className="gd-ft">
                  {undoButton}
                  <span className="sp" />
                  {cancelButton}
                  {submitButton}
                </div>
              </form>
              {confirmEl}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(o) => !o && onGone()} swipeDirection="down">
      <Drawer.Portal className="mk" container={host()}>
        <Drawer.Backdrop className="scrim gp-scrim" forceRender />
        <Drawer.Viewport className="gp-vp">
          <Drawer.Popup className={cn("gsh gp", confirm && "is-veiled")} initialFocus={titleRef} finalFocus={restore}>
            <span className="sheet-grab" aria-hidden />
            <form className="gp-form" onSubmit={(e) => void submit(e)} noValidate>
              <div className="gsh-hd">
                <HexTile icon={Layers} variant="soft" size="sm" />
                <Drawer.Title ref={titleRef} render={<h2 tabIndex={-1} />}>
                  {title}
                </Drawer.Title>
                <Drawer.Close className="ibtn" aria-label="Fechar">
                  <X className="i" aria-hidden />
                </Drawer.Close>
              </div>
              {/* Rolagem do corpo e da lista não arrastam a folha: só o cabeçalho e o rodapé fecham deslizando. */}
              <Drawer.Content className="gsh-bd" data-base-ui-swipe-ignore="">
                {fields}
              </Drawer.Content>
              <div className="gsh-ft">
                {cancelButton}
                {submitButton}
              </div>
            </form>
            {confirmEl}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* ---------------- Controles em comum ---------------- */

function Common({ count, preview, stale, failed }: { count: number; preview: Preview | null; stale: boolean; failed: boolean }): ReactNode {
  let content: ReactNode;
  if (count < MIN_MEMBERS) {
    content = <p className="g-none">Marque 2 ou mais aparelhos pra ver o que dá pra controlar juntos.</p>;
  } else if (count > MAX_MEMBERS) {
    content = <p className="g-none">Deixe até {MAX_MEMBERS} aparelhos pra ver o que dá pra controlar juntos.</p>;
  } else if (failed && (!preview || stale)) {
    content = <p className="g-none">Não consegui calcular agora. O grupo ainda pode ser criado.</p>;
  } else if (!preview) {
    content = (
      <div className="g-chips" aria-hidden>
        <span className="sk g-sk" style={{ width: 112 }} />
        <span className="sk g-sk" style={{ width: 56 }} />
        <span className="sk g-sk" style={{ width: 132 }} />
      </div>
    );
  } else if (preview.caps.length === 0) {
    content = (
      <p className="g-note">
        <Info className="i i-sm" aria-hidden />
        Estes aparelhos não têm nenhum controle em comum.
      </p>
    );
  } else {
    const onlyPower = preview.caps.length === 1 && preview.caps[0].id === "power";
    content = (
      <>
        <div className="g-chips" data-stale={stale || undefined}>
          {preview.caps.map((c) => (
            <span className="chip" key={c.id}>
              {capLabel(c)}
            </span>
          ))}
        </div>
        {onlyPower && (
          <p className="g-note">
            <Info className="i i-sm" aria-hidden />
            Estes aparelhos só têm em comum ligar e desligar.
          </p>
        )}
      </>
    );
  }
  return (
    <div className="g-com" role="status" aria-live="polite">
      <p className="lbl">Controles em comum</p>
      {content}
    </div>
  );
}
