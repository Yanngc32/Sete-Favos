// Peças comuns do kit do README: endereço da central demo, desenho dos favos e CSS base com os tokens do DS.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KIT = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(KIT, "../..");
export const ASSETS = resolve(ROOT, "docs/assets");
export const BASE = process.env.CENTRAL_URL ?? "http://127.0.0.1:38499";
export const THEMES = /** @type {const} */ (["claro", "escuro"]);
export const fileUrl = (p) => pathToFileURL(p).href;

/** Contexto já no tema pedido (mesma chave do theme-init.js do painel). */
export async function themedContext(browser, theme, opts) {
  const ctx = await browser.newContext({ colorScheme: theme === "escuro" ? "dark" : "light", ...opts });
  await ctx.addInitScript((t) => localStorage.setItem("casa-tema", t), theme);
  return ctx;
}

// Favo de ponta pra cima, o mesmo do Logo.tsx e da textura do painel.
function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** Marca: sete favos (centro + anel), igual ao Logo.tsx. */
export function logoSvg(cls = "logo") {
  const centers = [[50, 50], ...Array.from({ length: 6 }, (_, k) => [50 + 21 * Math.cos((Math.PI / 3) * k), 50 + 21 * Math.sin((Math.PI / 3) * k)])];
  return `<svg class="${cls}" viewBox="19 19 62 62" aria-hidden="true">${centers.map(([x, y]) => `<polygon points="${hexPoints(x, y, 9.5)}"/>`).join("")}</svg>`;
}

/** Textura de favos em traço fino, como o bloco mel do painel (FavosSprite.tsx). */
export function textureSvg(cls = "tex", r = 14) {
  const w = Math.sqrt(3) * r, row = r * 1.5;
  const tw = 8 * w, th = 8 * row;
  let d = "";
  for (let j = -1; j <= 8; j++) {
    for (let i = -1; i <= 8; i++) {
      const cx = i * w + (j & 1 ? w / 2 : 0), cy = j * row;
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k - Math.PI / 2;
        d += `${k ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
      }
      d += "Z";
    }
  }
  return `<svg class="${cls}" aria-hidden="true"><defs><pattern id="hx" width="${tw.toFixed(2)}" height="${th.toFixed(2)}" patternUnits="userSpaceOnUse"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#hx)"/></svg>`;
}

/** Hexágono de tile (HexTile do painel) com um ícone dentro. */
export function hexTile(icon, cls = "hx") {
  return `<span class="${cls}"><svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28"/></svg>${icon}</span>`;
}

const FONTS = resolve(ROOT, "frontend/node_modules/@fontsource-variable");

/** tokens.css do painel como CSS puro: o bloco `@theme` do Tailwind vira `:root` e saem os @import e os resets `*: initial`. */
function tokensCss() {
  return readFileSync(resolve(ROOT, "frontend/src/styles/tokens.css"), "utf8")
    .replace(/^@import .*$/gm, "")
    .replace(/@theme static \{/, ":root {")
    .replace(/^\s*--[a-z-]+-\*: initial;$/gm, "");
}

/** CSS base: tokens do painel + Geist local + reset. `theme` liga o bloco escuro dos tokens. */
export function baseCss() {
  return `
${tokensCss()}
@font-face{font-family:"Geist Variable";font-weight:100 900;font-display:block;src:url("${fileUrl(resolve(FONTS, "geist/files/geist-latin-wght-normal.woff2"))}") format("woff2")}
@font-face{font-family:"Geist Mono Variable";font-weight:100 900;font-display:block;src:url("${fileUrl(resolve(FONTS, "geist-mono/files/geist-mono-latin-wght-normal.woff2"))}") format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
body{font-family:var(--font-body);color:var(--color-text);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
h1,h2,h3{text-wrap:balance}
p{text-wrap:pretty}
`;
}

/** Ícones Lucide (o mesmo set do painel), lidos do pacote instalado no frontend. Traço 1.75 como no app. */
const LUCIDE = resolve(ROOT, "frontend/node_modules/lucide-react/dist/esm/icons");
export function icon(name, cls = "ic") {
  const src = readFileSync(resolve(LUCIDE, `${name}.mjs`), "utf8");
  const node = Function(`return ${src.slice(src.indexOf("node:") + 5, src.lastIndexOf("]") + 1)}`)();
  const inner = node.map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
