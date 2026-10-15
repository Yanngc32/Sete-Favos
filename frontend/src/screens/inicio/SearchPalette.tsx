// Busca rápida (Ctrl/⌘+K): aparelhos e rotinas. Enter abre o detalhe ou roda a rotina; ↑↓ navega; Esc fecha.
// Montada pela casca (Shell); abre por onSearchRequest() e pelo atalho.
import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { onSearchRequest } from "@/app/search";
import { KIND_LABEL, kindIcon } from "@/lib/devices";
import { useLive } from "@/lib/live";
import type { Device, Routine } from "@/lib/types";
import { routineIcon } from "./home";
import { runRoutine } from "./Quick";
import "./inicio.css";

type Hit = { type: "device"; item: Device } | { type: "routine"; item: Routine };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Cada palavra digitada tem que começar alguma palavra do item ("ar quarto" → Ar do quarto, não Fita do quarto). */
function matches(query: string, haystack: string) {
  const words = norm(haystack).split(/[^\p{L}\p{N}]+/u);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)));
}

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const { devices, routines, connection } = useLive();
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => onSearchRequest((o) => setOpen(o)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const { devHits, rotHits, hits } = useMemo(() => {
    const devHits = devices
      .filter((d) => matches(q, `${d.name} ${d.room ?? ""} ${KIND_LABEL[d.kind]}`))
      .slice(0, 6);
    const rotHits = routines.filter((r) => matches(q, r.name)).slice(0, 5);
    const hits: Hit[] = [
      ...devHits.map((item) => ({ type: "device" as const, item })),
      ...rotHits.map((item) => ({ type: "routine" as const, item })),
    ];
    return { devHits, rotHits, hits };
  }, [devices, routines, q]);

  const active = hits[Math.min(sel, hits.length - 1)];
  const activeId = active ? `cmd-${active.type}-${active.item.id}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(hit: Hit | undefined) {
    if (!hit) return;
    setOpen(false);
    if (hit.type === "device") navigate(`/aparelho/${hit.item.id}`);
    else if (connection === "online") void runRoutine(hit.item);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (hits.length ? (Math.min(s, hits.length - 1) + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (hits.length ? (Math.min(s, hits.length - 1) - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  }

  const option = (hit: Hit) => {
    const id = `cmd-${hit.type}-${hit.item.id}`;
    const selected = id === activeId;
    const Icon = hit.type === "device" ? kindIcon(hit.item.kind) : routineIcon(hit.item.name);
    const verb = hit.type === "device" ? "Abrir" : "Executar";
    return (
      <div
        key={id}
        id={id}
        className="cmd-o"
        role="option"
        aria-selected={selected}
        onPointerMove={() => setSel(hits.indexOf(hit))}
        onClick={() => choose(hit)}
      >
        <span className="tile sm">
          <Icon className="i" aria-hidden />
        </span>
        <span className="ini-cmd-t">
          {hit.item.name}
          {hit.type === "device" && hit.item.room && <span className="ini-cmd-r">{hit.item.room}</span>}
        </span>
        <small>
          {verb}
          {selected && <span className="kbd">Enter</span>}
        </small>
      </div>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => setOpen(o)}>
      <Dialog.Portal className="mk">
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="ini-cmd-vp">
          <Dialog.Popup className="cmd ini-cmd" aria-label="Busca rápida">
            <Dialog.Title className="sr">Busca rápida</Dialog.Title>
            <div className="cmd-in">
              <Search className="i" aria-hidden />
              <input
                className="ini-cmd-q"
                value={q}
                placeholder="Buscar aparelho ou rotina"
                role="combobox"
                aria-expanded
                aria-controls="cmd-list"
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
              />
              <span className="kbd" aria-hidden>
                Esc
              </span>
            </div>
            <div className="cmd-l ini-cmd-l" role="listbox" id="cmd-list" aria-label="Resultados" ref={listRef}>
              {devHits.length > 0 && (
                <div role="group" aria-labelledby="cmd-g-dev">
                  <p className="cmd-g" id="cmd-g-dev">
                    Aparelhos
                  </p>
                  {hits.filter((h) => h.type === "device").map(option)}
                </div>
              )}
              {rotHits.length > 0 && (
                <div role="group" aria-labelledby="cmd-g-rot">
                  <p className="cmd-g" id="cmd-g-rot">
                    Rotinas
                  </p>
                  {hits.filter((h) => h.type === "routine").map(option)}
                </div>
              )}
              {hits.length === 0 && <p className="ini-cmd-none">Nada com “{q.trim()}”.</p>}
            </div>
            <div className="cmd-f" aria-hidden>
              <span>
                <span className="kbd">↑</span>
                <span className="kbd">↓</span>navegar
              </span>
              <span>
                <span className="kbd">Enter</span>
                {active?.type === "routine" ? "executar" : "abrir"}
              </span>
              <span>
                <span className="kbd">Esc</span>fechar
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
