// Paleta da luz RGB. As cores são conteúdo (tokens --color-luz-*); o hex que vai pro aparelho
// sai do próprio token, resolvido pelo navegador, para os dois nunca divergirem.

export const PALETTE = [
  { id: "vermelho", label: "Vermelho" },
  { id: "laranja", label: "Laranja" },
  { id: "amarelo", label: "Amarelo" },
  { id: "verde", label: "Verde" },
  { id: "ciano", label: "Ciano" },
  { id: "azul", label: "Azul" },
  { id: "roxo", label: "Roxo" },
  { id: "rosa", label: "Rosa" },
] as const;

export const swatchVar = (id: string) => `var(--color-luz-${id})`;

let cache: Map<string, string> | null = null;

/** Hex (#rrggbb) de cada cor da paleta, lido dos tokens. */
export function paletteHex(): Map<string, string> {
  if (cache) return cache;
  const map = new Map<string, string>();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  for (const c of PALETTE) {
    probe.style.color = swatchVar(c.id);
    const css = getComputedStyle(probe).color;
    if (!ctx) continue;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    map.set(c.id, `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
  }
  probe.remove();
  if (map.size === PALETTE.length) cache = map;
  return map;
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Id da cor da paleta que bate com o hex (tolerância pequena: o aparelho arredonda). */
export function matchSwatch(hex: unknown): string | null {
  if (typeof hex !== "string") return null;
  const a = rgb(hex);
  if (!a) return null;
  for (const [id, h] of paletteHex()) {
    const b = rgb(h);
    if (b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 12) return id;
  }
  return null;
}

export function colorName(hex: string): string | null {
  const id = matchSwatch(hex);
  return id ? (PALETTE.find((c) => c.id === id)?.label ?? null) : null;
}
