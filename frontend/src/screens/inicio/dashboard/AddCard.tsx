// "Adicionar card": dialog no PC, folha de baixo no celular. Busca + tipos (com miniatura) + atalho "Todos de um cômodo".
import { HexTile } from "@/components/favos";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowLeft, House, LayoutGrid, List, PlugZap, Search, ToggleRight, Workflow, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Modal } from "@/components/Modal";
import { Sheet } from "@/components/Sheet";
import type { DashCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { matches, plural } from "./util";

type Pick = { kind: "type"; type: DashCard["type"] } | { kind: "room" };

interface TypeInfo {
  pick: Pick;
  name: string;
  desc: string;
  Icon: LucideIcon;
  mini: "ap" | "li" | "ro" | "ob" | "re" | "td";
}

const TYPES: TypeInfo[] = [
  { pick: { kind: "type", type: "device" }, name: "Aparelho", desc: "Um aparelho ou grupo", Icon: PlugZap, mini: "ap" },
  { pick: { kind: "type", type: "glance" }, name: "Lista compacta", desc: "Vários aparelhos em linhas: nome e estado", Icon: List, mini: "li" },
  { pick: { kind: "type", type: "routine" }, name: "Rotina", desc: "Botão que roda uma rotina", Icon: Workflow, mini: "ro" },
  { pick: { kind: "type", type: "virtual" }, name: "Objeto virtual", desc: "Interruptor de um modo, como Dormindo", Icon: ToggleRight, mini: "ob" },
  { pick: { kind: "type", type: "summary" }, name: "Resumo da casa", desc: "Saudação e contagens", Icon: House, mini: "re" },
];
const ROOM: TypeInfo = { pick: { kind: "room" }, name: "Todos de um cômodo", desc: "Cria um card por aparelho", Icon: LayoutGrid, mini: "td" };

function Mini({ kind }: { kind: TypeInfo["mini"] }) {
  const row = (k: number) => (
    <i key={k}>
      <b className="d" />
      <b className="l" />
    </i>
  );
  return (
    <span className={cn("ep-mini", `m-${kind}`)} aria-hidden>
      {kind === "ap" && row(0)}
      {kind === "li" && [0, 1, 2].map(row)}
      {kind === "ro" && row(0)}
      {kind === "ob" && (
        <i>
          <b className="l" />
          <b className="s" />
        </i>
      )}
      {kind === "re" && (
        <i>
          <b className="l big" />
          <b className="l w" />
        </i>
      )}
      {kind === "td" && [0, 1, 2, 3].map((k) => <i key={k} />)}
    </span>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  desktop: boolean;
  /** Cômodos com aparelhos e quantos (pro atalho). */
  rooms: { name: string; count: number }[];
  onPickType: (type: DashCard["type"]) => void;
  onPickRoom: (room: string) => void;
}

export function AddCard({ open, onClose, desktop, rooms, onPickType, onPickRoom }: Props) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"types" | "rooms">("types");
  const [hl, setHl] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (open) {
      setQ("");
      setStage("types");
      setHl(0);
    }
  }, [open]);

  const list = useMemo(() => [...TYPES, ROOM].filter((t) => matches(q, `${t.name} ${t.desc}`)), [q]);
  const roomList = useMemo(() => rooms.filter((r) => matches(q, r.name)), [rooms, q]);
  const items = stage === "types" ? list.length : roomList.length;
  const cur = Math.min(hl, Math.max(0, items - 1));

  function choose(i: number) {
    if (stage === "types") {
      const t = list[i];
      if (!t) return;
      if (t.pick.kind === "room") {
        setStage("rooms");
        setQ("");
        setHl(0);
        input.current?.focus();
      } else {
        onPickType(t.pick.type);
      }
    } else {
      const r = roomList[i];
      if (r) onPickRoom(r.name);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl(items ? (cur + 1) % items : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl(items ? (cur - 1 + items) % items : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(cur);
    } else if (e.key === "Backspace" && stage === "rooms" && !q) {
      setStage("types");
    }
  }

  const body = (
    <>
      {stage === "rooms" && (
        <button type="button" className="ep-back" onClick={() => setStage("types")}>
          <ArrowLeft className="i i-sm" aria-hidden />
          Todos de um cômodo
        </button>
      )}
      <div className="inp" role="search">
        <Search className="i i-sm" aria-hidden />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder={stage === "types" ? "Buscar tipo de card" : "Buscar cômodo"}
          aria-label={stage === "types" ? "Buscar tipo de card" : "Buscar cômodo"}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={items ? `${listId}-${cur}` : undefined}
          autoComplete="off"
          autoFocus
          onChange={(e) => {
            setQ(e.target.value);
            setHl(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="ep-tl" role="listbox" id={listId} aria-label={stage === "types" ? "Tipos de card" : "Cômodos"}>
        {stage === "types" &&
          list.map((t, i) => (
            <div key={t.name} role="none">
              {t.pick.kind === "room" && i > 0 && <hr className="ep-hr" />}
              <button
                type="button"
                id={`${listId}-${i}`}
                className={cn("ep-tp", i === cur && "is-hl")}
                role="option"
                aria-selected={i === cur}
                tabIndex={-1}
                onPointerMove={() => setHl(i)}
                onClick={() => choose(i)}
              >
                <HexTile icon={<t.Icon className="i" aria-hidden />} size="sm" />
                <span className="ep-tx">
                  <b>{t.name}</b>
                  <small>{t.desc}</small>
                </span>
                <Mini kind={t.mini} />
              </button>
            </div>
          ))}
        {stage === "rooms" &&
          roomList.map((r, i) => (
            <button
              key={r.name}
              type="button"
              id={`${listId}-${i}`}
              className={cn("ep-tp", i === cur && "is-hl")}
              role="option"
              aria-selected={i === cur}
              tabIndex={-1}
              onPointerMove={() => setHl(i)}
              onClick={() => choose(i)}
            >
              <span className="ep-tx">
                <b>{r.name}</b>
                <small>{plural(r.count, "aparelho", "aparelhos")}</small>
              </span>
            </button>
          ))}
        {items === 0 && <p className="ep-none">{q.trim() ? `Nada com “${q.trim()}”.` : "Nenhum cômodo com aparelhos."}</p>}
      </div>
    </>
  );

  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()} desktop={false} title="Adicionar card" rootClassName="ep" className="ep-add-sheet" initialFocus={input}>
        <div className="ep-add-body">{body}</div>
      </Sheet>
    );
  }
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} className="ep ep-add-dlg" initialFocus={input}>
      <div className="ep-add-hd">
        <Dialog.Title render={<h3 />}>Adicionar card</Dialog.Title>
        <Dialog.Close className="ibtn" aria-label="Fechar">
          <X className="i" aria-hidden />
        </Dialog.Close>
      </div>
      {body}
    </Modal>
  );
}
