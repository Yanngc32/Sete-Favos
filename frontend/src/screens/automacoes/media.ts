import { useSyncExternalStore } from "react";

// Mesmo corte do app.css: abaixo de 1024px é o layout de celular (barra de abas).
const QUERY = "(max-width: 1023.98px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
