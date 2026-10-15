// Capturas cruas do painel (central em modo demo) que viram matéria-prima do hero e da galeria.
//   CASA_SIMULAR=1 CASA_PORT=38499 uv run casa   e   uv run casa-demo --url http://127.0.0.1:38499
//   node shots.mjs            -> .out/screens/{m,d}-{claro,escuro}-<tela>.png
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BASE, KIT, THEMES, themedContext } from "./lib.mjs";

const OUT = resolve(KIT, ".out/screens");
mkdirSync(OUT, { recursive: true });

const devices = await (await fetch(`${BASE}/api/devices`)).json();
const ac = devices.find((d) => d.kind === "ac") ?? devices[0];

const MOBILE = { "inicio": "/", "dispositivos": "/dispositivos", "automacoes": "/automacoes", "detalhe": `/aparelho/${ac.id}` };
const DESKTOP = { "inicio": "/", "automacoes": "/automacoes", "dispositivos": "/dispositivos" };

const browser = await chromium.launch();
async function shoot(theme, prefix, routes, viewport, scale) {
  const ctx = await themedContext(browser, theme, { viewport, deviceScaleFactor: scale, isMobile: prefix === "m", hasTouch: prefix === "m" });
  const page = await ctx.newPage();
  for (const [name, route] of Object.entries(routes)) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900); // entradas do painel assentam
    await page.screenshot({ path: resolve(OUT, `${prefix}-${theme}-${name}.png`) });
  }
  await ctx.close();
}
for (const theme of THEMES) {
  await shoot(theme, "m", MOBILE, { width: 390, height: 844 }, 3);
  await shoot(theme, "d", DESKTOP, { width: 1440, height: 900 }, 2);
}
await browser.close();
console.log("capturas em", OUT);
