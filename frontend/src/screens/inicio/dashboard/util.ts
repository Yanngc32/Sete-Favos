import { useEffect, useState } from "react";

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Cada palavra digitada tem que começar alguma palavra do texto ("ar quarto" → Ar do quarto). Busca vazia casa tudo. */
export function matches(query: string, haystack: string): boolean {
  const words = norm(haystack).split(/[^\p{L}\p{N}]+/u);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)));
}

const KEY = "inicio.aba";

/** Aba mostrada: guardada na sessão (como o cômodo da Início), cai na primeira se a guardada não existe mais. */
export function useActiveView(ids: string[]): [string, (id: string) => void] {
  const [saved, setSaved] = useState(() => sessionStorage.getItem(KEY));
  const active = saved && ids.includes(saved) ? saved : (ids[0] ?? "");
  useEffect(() => {
    // Mantém a sessão em dia quando a aba guardada deixou de existir.
    if (active && active !== saved) sessionStorage.setItem(KEY, active);
  }, [active, saved]);
  return [
    active,
    (id) => {
      setSaved(id);
      sessionStorage.setItem(KEY, id);
    },
  ];
}

/** Plural simples: plural(3, "card", "cards"). */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
