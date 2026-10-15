// Gera src/styles/tokens.css a partir do tokens.json do design system "Sete Favos · Latão".
//   node scripts/tokens.mjs [caminho/do/tokens.json]
// Padrão: design/tokens.json (cópia versionada do DS). Para atualizar a cópia, passe o caminho do DS:
//   node scripts/tokens.mjs caminho/do/tokens.json
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(root, "design/tokens.json");
const source = process.argv[2] ? resolve(process.argv[2]) : local;
if (source !== local) {
  mkdirSync(dirname(local), { recursive: true });
  copyFileSync(source, local);
}
const tokens = JSON.parse(readFileSync(local, "utf8"));

// As fontes vêm do @fontsource-variable (sem depender de internet); o nome da família lá tem "Variable".
const FONT_ALIAS = { Geist: '"Geist Variable", Geist', "Geist Mono": '"Geist Mono Variable", "Geist Mono"' };

function fmt(value, type) {
  if (Array.isArray(value)) {
    return value.map((f) => FONT_ALIAS[f] ?? (/[\s]/.test(f) && !f.includes("-") ? `"${f}"` : f)).join(", ");
  }
  return type === "fontFamily" && FONT_ALIAS[value] ? FONT_ALIAS[value] : String(value);
}

const light = [];
const dark = [];
const compact = [];
function walk(node, path, type) {
  const t = node.$type ?? type;
  if ("$value" in node) {
    const name = `--${path.join("-")}`;
    light.push(`  ${name}: ${fmt(node.$value, t)};`);
    const escuro = node.$extensions?.["nexos.temas"]?.escuro;
    if (escuro !== undefined) dark.push(`  ${name}: ${fmt(escuro, t)};`);
    const compacta = node.$extensions?.["nexos.densidade"]?.compacta;
    if (compacta !== undefined) compact.push(`  ${name}: ${fmt(compacta, t)};`);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith("$") && v && typeof v === "object") walk(v, [...path, k], t);
  }
}
walk(tokens, [], undefined);

const css = `/* GERADO por scripts/tokens.mjs a partir de design/tokens.json. Não edite à mão. */
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";

/* static: emite todos os tokens (o kit usa var(--x) direto, não só utilitários).
   Tailwind v4: --color-*, --font-*, --text-*, --radius-*, --shadow-*, --ease-* viram utilitários
   (bg-surface, text-muted, rounded-card, shadow-overlay...). Os demais ficam só como variáveis. */
@theme static {
  --color-*: initial;
${light.join("\n")}
}

[data-theme="escuro"] {
  color-scheme: dark;
${dark.join("\n")}
}

/* Densidade compacta (Ajustes → Aparência): public/theme-init.js põe data-density no <html> antes do 1º desenho. */
[data-density="compacta"] {
${compact.join("\n")}
}
`;
const out = resolve(root, "src/styles/tokens.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, css);
console.log(`tokens.css: ${light.length} tokens, ${dark.length} no tema escuro, ${compact.length} na densidade compacta`);
