import { useEffect, useSyncExternalStore } from "react";

// Tema do painel: valor por aparelho (cada celular escolhe o seu), nunca na central.
// Sem escolha salva, segue o sistema. public/theme-init.js aplica o mesmo antes do primeiro desenho.
export type Theme = "claro" | "escuro";
const KEY = "casa-tema";
const EVENT = "casa-tema-change";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "claro" || v === "escuro" ? v : null;
  } catch {
    return null;
  }
}

function subscribePref(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener); // outra aba do mesmo aparelho
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function subscribeSystem(listener: () => void) {
  const mq = media();
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

/** Converte qualquer cor CSS (oklch...) em #rrggbb pra `theme-color`, que nem todo navegador entende em oklch. */
function toHex(color: string): string | null {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function syncBrowserChrome() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  const hex = bg && toHex(bg);
  if (!hex) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = hex;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  syncBrowserChrome();
}

/** Troca com um fade curto da página inteira quando o navegador sabe (View Transitions) e o movimento não está reduzido. */
function applyAnimated(theme: Theme) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.documentElement.dataset.theme === theme) return;
  if (reduced || typeof document.startViewTransition !== "function") {
    applyTheme(theme);
    return;
  }
  document.startViewTransition(() => applyTheme(theme));
}

function persist(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* modo privativo: vale só nesta sessão */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribePref, readPref, () => null);
  const systemDark = useSyncExternalStore(subscribeSystem, () => media().matches, () => false);
  const theme: Theme = pref ?? (systemDark ? "escuro" : "claro");
  return {
    theme,
    /** null = segue o sistema. */
    pref,
    setTheme(next: Theme) {
      persist(next);
      applyAnimated(next);
    },
    followSystem() {
      persist(null);
      applyAnimated(media().matches ? "escuro" : "claro");
    },
  };
}

/** Mantém o DOM igual ao estado (mudança do sistema, outra aba) e a cor da barra do navegador. Monte uma vez, na raiz. */
export function useThemeSync() {
  const { theme } = useTheme();
  useEffect(() => {
    if (document.documentElement.dataset.theme !== theme) applyTheme(theme);
    else syncBrowserChrome();
  }, [theme]);
}
