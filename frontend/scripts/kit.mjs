// Copia o kit CSS do design system (base.css dos mocks aprovados) para src/styles/kit.css.
//   node scripts/kit.mjs [caminho/do/base.css]
// O kit é o mesmo CSS que desenha os mocks aprovados: as telas usam as mesmas classes (.btn, .dev, .dlg...).
// Ficam de fora só as peças do quadro de mock (anotação, moldura de celular, sprite).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? "design-fontes/src/base.css");
const MOCK_ONLY = /^\.(sprite|ann|frame|board|row|ph|ph-scr|safe)\b[^{]*\{/;

const kept = readFileSync(source, "utf8")
  .split("\n")
  .filter((line) => !MOCK_ONLY.test(line.trim()) && !/^\.ann b\b/.test(line.trim()) && !/^\.safe::after/.test(line.trim()));

const css = `/* GERADO por scripts/kit.mjs a partir do base.css do design system (Sete Favos · Latão). Não edite à mão:
   ajuste no DS e rode \`npm run kit\`. Ajustes só do app (altura, responsivo, safe-area) ficam em app.css. */
@layer components {
${kept.join("\n")}
}
`;
writeFileSync(resolve(root, "src/styles/kit.css"), css);
console.log(`kit.css: ${kept.length} linhas`);
