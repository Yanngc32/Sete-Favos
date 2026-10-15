// Vídeos do README gravados da central demo: quadros pelo screencast do Chrome (mais nítido que o recordVideo)
// e montagem com ffmpeg em MP4 (link) e WebP animado (aparece no README).
//   node videos.mjs [mobile|mobile-pt|desktop]   -> docs/assets/video/<nome>.{mp4,webp}
// Os vídeos mexem nos aparelhos da demo; rode as capturas (shots.mjs) antes.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { ASSETS, BASE, KIT, baseCss, logoSvg, textureSvg } from "./lib.mjs";

const OUT = resolve(ASSETS, "video");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Grava os quadros de `page` enquanto `run` executa; devolve a pasta com quadros + lista do ffmpeg. */
async function record(page, name, run) {
  const dir = resolve(KIT, ".out/frames", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = resolve(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const vp = page.viewportSize();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: vp.width * 2, maxHeight: vp.height * 2 });
  await run();
  await sleep(400);
  await cdp.send("Page.stopScreencast");
  // O screencast só manda quadro quando a tela muda: cada quadro dura até o próximo.
  const end = frames.at(-1).t + 1.2;
  let list = "ffconcat version 1.0\n";
  frames.forEach((f, i) => { list += `file '${f.file.replace(/\\/g, "/")}'\nduration ${((frames[i + 1]?.t ?? end) - f.t).toFixed(3)}\n`; });
  list += `file '${frames.at(-1).file.replace(/\\/g, "/")}'\n`;
  writeFileSync(resolve(dir, "list.txt"), list);
  return resolve(dir, "list.txt");
}

/** MP4 (h264, pra baixar/compartilhar) e WebP animado (o README mostra direto, bem menor que GIF). */
function encode(list, name, width) {
  const ff = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, ...args]);
  ff("-vf", `fps=30,scale=${Math.round(width * 1.5)}:-2:flags=lanczos`, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", resolve(OUT, `${name}.mp4`));
  ff("-vf", `fps=15,scale=${width}:-2:flags=lanczos`, "-c:v", "libwebp_anim", "-quality", "78", "-compression_level", "6", "-loop", "0",
    resolve(OUT, `${name}.webp`));
}

/** Tira X-Frame-Options/CSP só neste navegador de gravação, pra poder pôr o painel num iframe do palco. */
async function allowFraming(ctx, stageHtml) {
  await ctx.route(`${BASE}/**`, async (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname === "/__stage") return route.fulfill({ contentType: "text/html", body: stageHtml });
    if (req.resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    await route.fulfill({ response: res, headers });
  });
}

// ---------------------------------------------------------------------------------------------------------
// Celular: palco mel com legenda à esquerda e o painel numa moldura à direita; toque aparece como círculo.
const STAGE = (theme) => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>
${baseCss()}
html,body{width:1000px;height:1000px;overflow:hidden}
body{position:relative;isolation:isolate;background:var(--color-honey-bg);color:var(--color-honey-ink)}
.tex{position:absolute;inset:0;width:100%;height:100%;z-index:-1;color:var(--color-honey-line);opacity:calc(var(--opacity-texture) * 2.2)}
.logo{width:30px;height:30px;fill:currentColor;stroke:currentColor;stroke-width:2.5;stroke-linejoin:round;color:var(--color-honey-mark)}
.brand{position:absolute;left:64px;top:64px;display:flex;align-items:center;gap:10px;font:var(--weight-medium) 20px/1 var(--font-display)}
.cap{position:absolute;left:64px;top:50%;width:380px;transform:translateY(-50%)}
.cap b{display:block;font:var(--weight-light) 46px/1.05 var(--font-display);letter-spacing:var(--tracking-display);text-wrap:balance}
.cap span{display:block;margin-top:16px;font:var(--weight-regular) 19px/1.45 var(--font-body);color:var(--color-honey-ink-2);text-wrap:pretty}
.cap.swap{animation:cap 520ms var(--ease-out) both}
@keyframes cap{from{opacity:0;transform:translateY(calc(-50% + 10px));filter:blur(4px)}to{opacity:1;transform:translateY(-50%);filter:blur(0)}}
.phone{position:absolute;right:72px;top:68px;width:408px;height:862px;padding:9px;border-radius:52px;background:oklch(16% 0.004 70);
  box-shadow:0 0 0 1px oklch(0 0 0 / .25),0 2px 4px oklch(0 0 0 / .12),0 30px 60px -18px oklch(0 0 0 / .45)}
iframe{display:block;width:390px;height:844px;border:0;border-radius:43px;background:var(--color-bg)}
.tap{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;pointer-events:none;
  background:oklch(1 0 0 / .35);box-shadow:0 0 0 2px oklch(1 0 0 / .8),0 4px 14px oklch(0 0 0 / .25);animation:tap 600ms var(--ease-out) forwards}
@keyframes tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.2);opacity:0}}
</style></head><body>${textureSvg()}
<div class="brand">${logoSvg()}<span>Sete Favos</span></div>
<div class="cap" id="cap"><b></b><span></span></div>
<div class="phone"><iframe id="app" src="${BASE}/"></iframe></div>
</body></html>`;

// O documento entregue pela rota conta como "público" pro Chrome, que então barra o WebSocket local (Local Network Access).
const LAUNCH = { args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] };

// Legendas do tour do celular, uma por trecho. O README pt-BR usa o vídeo "-pt".
const CAPTIONS = {
  en: [
    ["Your whole home at a glance", "Weather, scenes, rooms and everything that is on, on one screen."],
    ["One tap, a whole scene", "Routines set many devices at once: lights down, TV on, AC just right."],
    ["Every device, its own controls", "Air conditioners get modes and temperature, lights get brightness and color."],
    ["All on your own network", "Commands go straight from the PC to each device. No vendor cloud in between."],
    ["Routines & automations", "Triggers by time, sunset, device state or a virtual switch, with conditions and delays."],
  ],
  pt: [
    ["A casa inteira num olhar", "Clima, rotinas, cômodos e tudo o que está ligado, numa tela só."],
    ["Um toque, uma cena inteira", "Rotinas ajustam vários aparelhos de uma vez: luz baixa, TV ligada, ar no ponto."],
    ["Cada aparelho, seus controles", "Ar-condicionado com modo e temperatura, luz com brilho e cor."],
    ["Tudo na sua rede", "O comando sai do PC direto para o aparelho. Sem nuvem do fabricante no meio."],
    ["Rotinas e automações", "Gatilhos por horário, pôr do sol, estado de aparelho ou objeto virtual, com condições e esperas."],
  ],
};

async function mobile(lang = "en") {
  const C = CAPTIONS[lang];
  const name = lang === "en" ? "mobile-tour" : `mobile-tour-${lang}`;
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2, hasTouch: false });
  await ctx.addInitScript(() => localStorage.setItem("casa-tema", "claro"));
  await allowFraming(ctx, STAGE("claro"));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/__stage`);
  const app = page.frameLocator("#app");
  await app.getByRole("button", { name: "Cinema" }).waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: resolve(KIT, ".out/stage-debug.png") }); throw e; });
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);

  const caption = (title, text) => page.evaluate(([t, s]) => {
    const el = document.getElementById("cap");
    el.querySelector("b").textContent = t;
    el.querySelector("span").textContent = s;
    el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap");
  }, [title, text]);
  const tap = async (loc) => {
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.evaluate(([x, y]) => {
      const d = Object.assign(document.createElement("div"), { className: "tap" });
      d.style.left = `${x}px`; d.style.top = `${y}px`;
      document.body.append(d); setTimeout(() => d.remove(), 700);
    }, [x, y]);
    await sleep(120);
    await loc.click();
  };
  const scroll = async (dy, steps = 14) => {
    await page.mouse.move(776, 500);
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(28); }
  };

  const list = await record(page, name, async () => {
    await caption(...C[0]);
    await sleep(2200);
    await caption(...C[1]);
    await tap(app.getByRole("button", { name: "Cinema" }));
    await sleep(1600);
    await scroll(560);
    await sleep(1400);
    await caption(...C[2]);
    await tap(app.getByRole("link", { name: "Ar do quarto" }).first());
    await sleep(1200);
    await tap(app.getByRole("button", { name: /^Aumentar para/ }).first());
    await sleep(500);
    await tap(app.getByRole("button", { name: /^Aumentar para/ }).first());
    await sleep(900);
    await tap(app.getByRole("radio", { name: "Quente" }));
    await sleep(1400);
    await tap(app.getByRole("button", { name: "Voltar" }));
    await sleep(900);
    await caption(...C[3]);
    await tap(app.getByRole("link", { name: /Dispositivos/ }).last());
    await sleep(1300);
    await tap(app.getByRole("switch", { name: /Tomada da cafeteira/ }));
    await sleep(900);
    await tap(app.getByRole("button", { name: "Mostrar controles de Luz da sala" }));
    await sleep(1600);
    await caption(...C[4]);
    await tap(app.getByRole("link", { name: /Automações/ }).last());
    await sleep(2600);
  });
  await browser.close();
  encode(list, name, 800);
}

// ---------------------------------------------------------------------------------------------------------
// Desktop: painel no escuro, mexendo nos cards da Início e trocando o tema.
async function desktop() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  // O headless não desenha o ponteiro: uma seta simples segue o mouse e encolhe no clique.
  await ctx.addInitScript(() => addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6L9.6 20z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transition: "scale 120ms ease-out", transformOrigin: "4px 2px" });
    document.documentElement.append(c);
    addEventListener("mousemove", (e) => { c.style.translate = `${e.clientX - 4}px ${e.clientY - 2}px`; }, true);
    addEventListener("mousedown", () => { c.style.scale = "0.85"; }, true);
    addEventListener("mouseup", () => { c.style.scale = "1"; }, true);
  }));
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("gravando")) { localStorage.setItem("casa-tema", "escuro"); sessionStorage.setItem("gravando", "1"); } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);
  const click = async (loc, after = 900) => {
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await sleep(150);
    await loc.click();
    await sleep(after);
  };
  const list = await record(page, "desktop-tour", async () => {
    await sleep(1200);
    await click(page.getByRole("switch", { name: /Luz da sala/ }).first());
    await click(page.getByRole("switch", { name: /Luz da sala/ }).first());
    await click(page.getByRole("button", { name: "Aumentar temperatura" }).first(), 500);
    await click(page.getByRole("button", { name: "Aumentar temperatura" }).first());
    await click(page.getByRole("button", { name: "Ligar Arandela" }).first());
    await click(page.getByRole("button", { name: "Dormir" }), 1500);
    await click(page.getByRole("button", { name: /^Mudar para o tema/ }), 1600);
    await click(page.getByRole("link", { name: "Automações" }).first(), 1600);
    await click(page.getByRole("link", { name: "Dispositivos" }).first(), 1800);
  });
  await browser.close();
  encode(list, "desktop-tour", 960);
}

const only = process.argv[2];
if (!only || only === "mobile") await mobile("en");
if (!only || only === "mobile-pt") await mobile("pt");
if (!only || only === "desktop") await desktop();
console.log("vídeos em", OUT);
