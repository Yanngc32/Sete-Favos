// Seleção de aparelhos do grupo: contador fixo, busca e lista com checkbox agrupada por cômodo (com "marcar todos").
// Estrutura do mock "Criar e editar grupo": primitives/checkbox do kit (Wensity UI, MIT) restilizada com os tokens.
import { HexTile } from "@/components/favos";
import { Check, CircleAlert, Minus, Search, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { devicesByRoom, kindIcon } from "@/lib/devices";
import type { Device, Kind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { vendorShort } from "@/screens/aparelhos/wizard/model";

export const MAX_MEMBERS = 20;
export const MIN_MEMBERS = 2;

const KIND_NAME: Record<Kind, string> = {
  light: "Luz",
  plug: "Tomada",
  switch: "Interruptor",
  ac: "Ar-condicionado",
  tv: "TV",
  vacuum: "Robô",
  phone: "Celular",
  other: "Outro",
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Props {
  /** Só aparelhos de verdade (grupo dentro de grupo não pode). */
  devices: Device[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function DevicePicker({ devices, selected, onChange, disabled }: Props) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = useMemo(() => new Set(selected), [selected]);

  // Ao abrir (editar ou "Agrupar com outros…") a lista já mostra o primeiro aparelho marcado.
  useEffect(() => {
    const list = listRef.current;
    const first = list?.querySelector<HTMLElement>("input:checked")?.closest<HTMLElement>(".gr");
    if (!list || !first) return;
    const top = first.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top + first.offsetHeight > list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 2 + first.offsetHeight / 2);
    // só na abertura
  }, []);

  const rooms = useMemo(() => {
    const q = norm(query.trim());
    const list = q
      ? devices.filter((d) => norm([d.name, d.room ?? "", KIND_NAME[d.kind], vendorShort(d.vendor_label), d.ip ?? ""].join(" ")).includes(q))
      : devices;
    return devicesByRoom(list);
  }, [devices, query]);

  const count = selected.length;
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleRoom = (ids: string[], all: boolean) =>
    onChange(all ? selected.filter((x) => !ids.includes(x)) : [...selected, ...ids.filter((x) => !chosen.has(x))]);

  const tone = count === 0 ? "is-zero" : count < MIN_MEMBERS ? "is-bad" : count > MAX_MEMBERS ? "is-warn" : "";
  const over = count - MAX_MEMBERS;

  return (
    <div className="g-ap">
      <div className="g-aph">
        <span className="lbl" id={`${uid}-l`}>
          Aparelhos
        </span>
        <span className={cn("g-cnt num", tone)} aria-live="polite" aria-atomic="true">
          {count} {count === 1 ? "selecionado" : "selecionados"}
        </span>
      </div>
      {count === 1 && (
        <p className="hint err" id={`${uid}-h`}>
          <CircleAlert className="i i-sm" aria-hidden />
          Escolha pelo menos {MIN_MEMBERS} aparelhos.
        </p>
      )}
      {over > 0 && (
        <p className="g-warn" id={`${uid}-h`} role="status">
          <TriangleAlert className="i i-sm" aria-hidden />
          Um grupo aceita no máximo {MAX_MEMBERS} aparelhos. Desmarque {over}.
        </p>
      )}
      <div className="inp">
        <Search className="i i-sm" aria-hidden />
        <input
          value={query}
          placeholder="Buscar aparelho"
          aria-label="Buscar aparelho"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
          // Enter na busca não pode enviar o formulário do grupo.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
      </div>
      <div
        ref={listRef}
        className="g-list"
        role="group"
        aria-labelledby={`${uid}-l`}
        aria-describedby={count === 1 || over > 0 ? `${uid}-h` : undefined}
        data-base-ui-swipe-ignore=""
      >
        {rooms.length === 0 && <p className="g-empty">Nenhum aparelho encontrado.</p>}
        {rooms.map(([room, list]) => {
          const ids = list.map((d) => d.id);
          const n = ids.filter((id) => chosen.has(id)).length;
          const all = n === ids.length;
          const state = n === 0 ? "false" : all ? "true" : "mixed";
          return (
            <div className="g-room" role="group" aria-label={room} key={room}>
              <button
                type="button"
                className="g-rm"
                role="checkbox"
                aria-checked={state}
                aria-label={`${all ? "Desmarcar" : "Marcar"} todos de ${room}`}
                disabled={disabled}
                onClick={() => toggleRoom(ids, all)}
              >
                <span className={cn("cbx", state === "true" && "on", state === "mixed" && "mix")}>
                  {state === "mixed" ? <Minus className="i" aria-hidden /> : <Check className="i" aria-hidden />}
                </span>
                <span className="g-rn">{room}</span>
                <span className="g-rc num">
                  {n} de {ids.length}
                </span>
                <span className="g-ra">{all ? "Desmarcar todos" : "Marcar todos"}</span>
              </button>
              {list.map((d) => {
                const Icon = kindIcon(d.kind);
                const off = d.online === false;
                return (
                  <label className={cn("gr", off && "is-off")} key={d.id}>
                    <input
                      className="sr"
                      type="checkbox"
                      checked={chosen.has(d.id)}
                      disabled={disabled}
                      aria-describedby={off ? `${uid}-${d.id}` : undefined}
                      onChange={() => toggle(d.id)}
                    />
                    <span className="cbx">
                      <Check className="i" aria-hidden />
                    </span>
                    <HexTile icon={Icon} size="sm" />
                    <span className="gr-tx">
                      <span className="gr-n">{d.name}</span>
                      <span className="gr-m">
                        {KIND_NAME[d.kind]} · {vendorShort(d.vendor_label)}
                      </span>
                    </span>
                    {off && (
                      <span className="chip warn" id={`${uid}-${d.id}`}>
                        <WifiOff className="i i-sm" aria-hidden />
                        Sem resposta
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
