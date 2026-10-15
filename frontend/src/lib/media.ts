import { useSyncExternalStore } from "react";

/** Mesmo corte das telas: a partir daqui é desktop (sheet/dialog), abaixo é celular (folha de baixo). */
export const DESKTOP = "(min-width: 1024px)";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}
