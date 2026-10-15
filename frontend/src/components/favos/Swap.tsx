// Valor que troca com crossfade (contagem, temperatura, "3 ligados"). O valor novo entra por cima do
// antigo (mesma célula de grid, sem salto de largura) e o antigo sai em opacidade. Não anima no 1º render.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const OUT_MS = 220; // = --dur-short

export interface SwapProps {
  /** Chave da troca: quando muda, o conteúdo antigo sai e o novo entra. */
  value: string | number;
  /** O que mostrar (padrão: o próprio `value`). */
  children?: ReactNode;
  className?: string;
}

interface Item {
  key: number;
  node: ReactNode;
  out?: boolean;
}

export function Swap({ value, children, className }: SwapProps) {
  const node = children ?? value;
  const seq = useRef(0);
  const [items, setItems] = useState<Item[]>([{ key: 0, node }]);
  const last = useRef(value);

  // Conteúdo do render anterior: é o retrato que sai em fade quando o valor troca.
  const prev = useRef<ReactNode>(node);

  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    const key = ++seq.current;
    const old = prev.current; // lido agora: o updater roda depois do efeito que atualiza `prev`
    setItems((xs) => [
      ...xs.filter((x) => !x.out).map((x) => ({ ...x, node: old, out: true })),
      { key, node: null },
    ]);
    const t = window.setTimeout(() => setItems((xs) => xs.filter((x) => !x.out)), OUT_MS);
    return () => window.clearTimeout(t);
  }, [value]);
  // Depois do efeito de troca (ordem importa): guarda o conteúdo deste render.
  useEffect(() => {
    prev.current = node;
  });

  return (
    <span className={cn("fv-swap", className)}>
      {items.map((it) => (
        <span key={it.key} className={cn("fv-swap-i", it.key > 0 && "is-in", it.out && "is-out")} aria-hidden={it.out || undefined}>
          {it.out ? it.node : node}
        </span>
      ))}
    </span>
  );
}
