// Abre o dialog "Novo grupo / Editar grupo" de qualquer lugar (card de aparelho, lista Aparelhos, seletor de cards).
// O dialog em si mora em GroupDialogHost (montado uma vez no Shell). Mesmo padrão de app/search.ts.
import { useSyncExternalStore } from "react";

export interface GroupDialogRequest {
  /** Aparelhos já marcados (ex.: "Agrupar com outros…" no menu de um card). */
  preselect?: string[];
  /** Id do grupo a editar; sem isso é um grupo novo. */
  edit?: string;
}

let current: GroupDialogRequest | null = null;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openGroupDialog(request: GroupDialogRequest = {}) {
  const active = document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  current = request;
  emit();
}

export function closeGroupDialog() {
  current = null;
  emit();
}

export function useGroupDialog(): GroupDialogRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Link do aparelho/grupo na tela (card da Início ou linha da lista Aparelhos). */
function linkOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`a[href="/aparelho/${CSS.escape(id)}"]`);
}

/**
 * Para onde o foco volta ao fechar. Quem abriu (se ainda existe na tela); senão o card do grupo/aparelho
 * (o menu do card some ao escolher o item); senão o botão "Novo grupo".
 */
export function groupFocusTarget(request: GroupDialogRequest): HTMLElement | null {
  if (opener?.isConnected) return opener;
  const id = request.edit ?? request.preselect?.[0];
  return (id ? linkOf(id) : null) ?? document.querySelector<HTMLElement>("[data-group-opener]");
}

const FLASH_MS = 2200;

/** Destaque curto no card (ou na linha) que acabou de nascer. Espera ele aparecer (a central avisa pelo WebSocket). */
export function flashNew(id: string) {
  const started = performance.now();
  const tick = () => {
    const link = linkOf(id);
    const el = link?.closest<HTMLElement>(".fv-dev, .dev, .li");
    if (!el) {
      if (performance.now() - started < 2000) requestAnimationFrame(tick);
      return;
    }
    el.classList.add("is-new");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    setTimeout(() => el.classList.remove("is-new"), FLASH_MS);
  };
  requestAnimationFrame(tick);
}
