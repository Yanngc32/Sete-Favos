import { useEffect, useSyncExternalStore } from "react";

// Densidade do painel: por aparelho de acesso (como o tema), nunca na central.
// "confortavel" é o padrão; "compacta" troca os tokens --density-* via [data-density] no <html>.
// public/theme-init.js aplica o mesmo antes do primeiro desenho (sem piscar). Mantenha a chave igual.
export type Density = "confortavel" | "compacta";
const KEY = "casa-densidade";
const EVENT = "casa-densidade-change";

function read(): Density {
  try {
    return localStorage.getItem(KEY) === "compacta" ? "compacta" : "confortavel";
  } catch {
    return "confortavel";
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener); // outra aba do mesmo aparelho
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function apply(d: Density) {
  const root = document.documentElement;
  if (d === "compacta") root.dataset.density = "compacta";
  else delete root.dataset.density;
}

export function useDensity() {
  const density = useSyncExternalStore(subscribe, read, () => "confortavel" as Density);
  return {
    density,
    setDensity(next: Density) {
      try {
        if (next === "compacta") localStorage.setItem(KEY, next);
        else localStorage.removeItem(KEY);
      } catch {
        /* modo privativo: vale só nesta sessão */
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || typeof document.startViewTransition !== "function") apply(next);
      else document.startViewTransition(() => apply(next));
      window.dispatchEvent(new Event(EVENT));
    },
  };
}

/** Mantém o <html> igual à escolha (outra aba). Monte uma vez, na raiz. */
export function useDensitySync() {
  const { density } = useDensity();
  useEffect(() => {
    const want = density === "compacta" ? "compacta" : undefined;
    if (document.documentElement.dataset.density !== want) apply(density);
  }, [density]);
}
