// Cômodos em favo (mock "exploracao-favos", tela 1): rolam na horizontal; tocar escolhe o cômodo da lista abaixo
// (é o antigo seletor de cômodo: radiogroup com setas/Home/End). "Casa" = todos.
import { House } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { HexTile, Swap } from "@/components/favos";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { roomIcon, type RoomStat } from "./home";

interface Props {
  all: string;
  stats: RoomStat[];
  total: number;
  totalOn: number;
  value: string;
  onChange: (room: string) => void;
}

const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

export function RoomTiles({ all, stats, total, totalOn, value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = [{ name: all, total, on: totalOn, temp: null as number | null }, ...stats];

  // A escolhida sempre aparece inteira (sem pular a página na vertical).
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const box = ref.current;
    if (!el || !box) return;
    const l = el.offsetLeft - box.offsetLeft;
    if (l < box.scrollLeft || l + el.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollTo({ left: Math.max(0, l - 16), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [value]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((r) => r.name === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].name);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    <div className="ini-cm" role="radiogroup" aria-label="Cômodo" ref={ref} onKeyDown={onKeyDown}>
      {items.map((r, i) => {
        const picked = r.name === value;
        const isAll = i === 0;
        const chip = r.temp !== null ? `${int.format(r.temp)} °C` : r.on > 0 ? n(r.on, "ligado", "ligados") : null;
        return (
          <button
            key={r.name}
            type="button"
            role="radio"
            aria-checked={picked}
            tabIndex={picked ? 0 : -1}
            className={cn("ini-cm-t", picked && "is-on")}
            onClick={() => onChange(r.name)}
          >
            <span className={cn("chip num", chip ? "acc" : "ini-cm-ghost")} aria-hidden={!chip || undefined}>
              {chip ? <Swap value={chip} /> : "–"}
            </span>
            <HexTile icon={isAll ? House : roomIcon(r.name)} variant={picked ? "on" : r.on > 0 ? "soft" : "neutral"} size="xl" />
            <b>{isAll ? "Casa toda" : r.name}</b>
            <span className="num">{n(r.total, "aparelho", "aparelhos")}</span>
          </button>
        );
      })}
    </div>
  );
}
