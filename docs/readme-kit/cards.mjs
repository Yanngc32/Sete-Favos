// Cards do README (hero, recursos, integrações, galeria, arquitetura), em claro e escuro, com os tokens do DS.
//   node shots.mjs && node cards.mjs     -> docs/assets/<card>[-pt]-{light,dark}.webp
// O README troca claro/escuro com <picture> + prefers-color-scheme.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { ASSETS, KIT, baseCss, fileUrl, hexTile, icon, logoSvg, textureSvg } from "./lib.mjs";

const SCREENS = resolve(KIT, ".out/screens");
const shot = (name) => `data:image/png;base64,${readFileSync(resolve(SCREENS, `${name}.png`)).toString("base64")}`;
mkdirSync(ASSETS, { recursive: true });

const CSS = `
${baseCss()}
#card{position:relative;overflow:hidden;isolation:isolate}
.tex{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
.logo{fill:currentColor;stroke:currentColor;stroke-width:2.5;stroke-linejoin:round}
.ic{width:24px;height:24px}
.hx{position:relative;display:inline-grid;place-items:center;flex:none}
.hx>svg:first-child{position:absolute;inset:0;width:100%;height:100%}
.hx>.ic{position:relative}
.eyebrow{font:var(--weight-medium) 13px/1 var(--font-mono);letter-spacing:var(--tracking-label);text-transform:uppercase;color:var(--color-accent-ink)}

/* Superfície de card: sombra pra elevação, contorno fininho pra estrutura (como o .card do painel). */
.surface{background:var(--color-surface);border-radius:28px;box-shadow:0 0 0 1px var(--color-border),var(--shadow-card-hover)}

/* Bloco mel: o mesmo do cabeçalho do painel. */
.honey{background:var(--color-honey-bg);color:var(--color-honey-ink)}
.honey .tex{color:var(--color-honey-line);opacity:calc(var(--opacity-texture) * 2.2)}

/* Celular: moldura + tela capturada do painel. Raio externo = interno + borda (concêntrico). */
.phone{position:absolute;width:300px;aspect-ratio:390/844;padding:9px;border-radius:50px;background:oklch(16% 0.004 70);
  box-shadow:0 0 0 1px oklch(0 0 0 / .25),0 2px 4px oklch(0 0 0 / .12),0 30px 60px -18px oklch(0 0 0 / .45)}
.phone img{display:block;width:100%;height:100%;border-radius:41px;outline:1px solid oklch(1 0 0 / .08);outline-offset:-1px}
`;

const page = (theme, body, extra = "") => `<!doctype html><html data-theme="${theme === "dark" ? "escuro" : "claro"}"><head><meta charset="utf-8"><style>${CSS}${extra}</style></head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------------------------------------
// Textos por idioma: o README em inglês usa os cards sem sufixo; o README.pt-BR.md usa os "-pt".
const TEXT = {
  en: {
    h1: "Your home,<br>run from your own PC.",
    lead: "A local-first smart home hub for Tuya, Midea, LG webOS and Xiaomi. No vendor cloud in the loop, no account, no subscription.",
    chips: ["Local control", "PWA + Android", "Routines &amp; automations", "MIT"],
    features: {
      "feature-local": ["Local first", "Talks to your devices over the home network. The vendor cloud is used once, to fetch local keys, and then stays out of the loop."],
      "feature-automations": ["Routines & automations", "One-tap scenes, plus automations triggered by time, sunrise or sunset, device state and virtual switches, with conditions and delays."],
      "feature-android": ["Android app & widget", "A home-screen widget to flip devices without opening anything. The phone can also share battery and location with the hub."],
      "feature-secure": ["Private by default", "Phones pair by QR code from the PC and can be revoked instantly. Device secrets live in the Windows Credential Manager, never in files."],
      "feature-remote": ["Anywhere, no port forwarding", "Reach the dashboard from 4G through your Tailscale tailnet. The firewall only allows the LAN and the tailnet."],
      "feature-dashboard": ["A dashboard that fits", "Rooms, pinned routines, card sizes, compact or comfortable density, light and dark. Installs as an app on any phone."],
    },
    worksWith: "Works with", moreAdapters: "More adapters welcome, see backend/src/casa/adapters",
    brands: [["Plugs, bulbs, switches", "LAN · local keys"], ["Air conditioners", "LAN"], ["TVs, Wake-on-LAN", "LAN"], ["Robot vacuums & more", "LAN · miio"], ["Battery & location", "Paired app"]],
    screens: ["Home", "Devices", "Device detail", "Automations"],
    how: "How it works", homeNet: "home network", lanTs: "LAN or Tailscale",
    hub: "Sete Favos hub", hubSub: "Windows PC, always on", hubParts: ["Adapters", "Rules engine", "Credential vault", "Web dashboard"],
    clients: [["Phones", "Paired by QR"], ["Browser", "PWA on any device"], ["Android widget", "One-tap toggles"]],
  },
  pt: {
    h1: "Sua casa,<br>no seu próprio PC.",
    lead: "Central de casa inteligente local para Tuya, Midea, LG webOS e Xiaomi. Sem nuvem do fabricante no meio, sem conta, sem assinatura.",
    chips: ["Controle local", "PWA + Android", "Rotinas e automações", "MIT"],
    features: {
      "feature-local": ["Local primeiro", "Fala com os aparelhos pela rede de casa. A nuvem do fabricante só entra uma vez, para buscar as chaves locais, e depois fica de fora."],
      "feature-automations": ["Rotinas e automações", "Cenas com um toque e automações por horário, nascer ou pôr do sol, estado de aparelho e objetos virtuais, com condições e esperas."],
      "feature-android": ["App e widget Android", "Widget na tela inicial para ligar e desligar sem abrir nada. O celular também manda bateria e localização para a central."],
      "feature-secure": ["Privado por padrão", "Celulares pareiam por QR no PC e podem ser revogados na hora. Os segredos ficam no Gerenciador de Credenciais do Windows, nunca em arquivo."],
      "feature-remote": ["De qualquer lugar", "O painel no 4G pela sua tailnet do Tailscale, sem abrir porta no roteador. O firewall só deixa a rede local e a tailnet."],
      "feature-dashboard": ["Um painel do seu jeito", "Cômodos, rotinas fixadas, tamanho dos cards, densidade compacta ou confortável, claro e escuro. Instala como app no celular."],
    },
    worksWith: "Funciona com", moreAdapters: "Quer outra marca? Veja backend/src/casa/adapters",
    brands: [["Tomadas, lâmpadas, interruptores", "rede local · chaves locais"], ["Ar-condicionado", "rede local"], ["TVs, Wake-on-LAN", "rede local"], ["Robô aspirador e mais", "rede local · miio"], ["Bateria e localização", "app pareado"]],
    screens: ["Início", "Dispositivos", "Detalhe do aparelho", "Automações"],
    how: "Como funciona", homeNet: "rede de casa", lanTs: "rede local ou Tailscale",
    hub: "Central Sete Favos", hubSub: "PC Windows sempre ligado", hubParts: ["Adaptadores", "Motor de regras", "Cofre de segredos", "Painel web"],
    clients: [["Celulares", "Pareados por QR"], ["Navegador", "PWA em qualquer tela"], ["Widget Android", "Liga com um toque"]],
  },
};
let L = TEXT.en;

// ---------------------------------------------------------------------------------------------------------
// Hero: bloco mel com a curva em S do painel, marca, chamada e dois celulares com o app de verdade.
const hero = (t) => page(t, `
<div id="card" class="honey hero">
  ${textureSvg()}
  <div class="copy">
    <div class="brand">${logoSvg()}<span>Sete Favos</span></div>
    <h1>${L.h1}</h1>
    <p>${L.lead}</p>
    <ul class="chips">${L.chips.map((c) => `<li>${c}</li>`).join("")}</ul>
  </div>
  <div class="phone p2"><img src="${shot(`m-${t === "dark" ? "escuro" : "claro"}-detalhe`)}"></div>
  <div class="phone p1"><img src="${shot(`m-${t === "dark" ? "escuro" : "claro"}-inicio`)}"></div>
</div>`, `
.hero{width:1280px;height:600px;border-radius:32px}
.copy{position:absolute;left:72px;top:64px;width:560px}
.brand{display:flex;align-items:center;gap:12px;font:var(--weight-medium) 22px/1 var(--font-display);letter-spacing:var(--tracking-tight)}
.brand .logo{width:34px;height:34px;color:var(--color-honey-mark)}
h1{margin-top:44px;font:var(--weight-light) 60px/1.02 var(--font-display);letter-spacing:var(--tracking-display)}
.copy p{margin-top:22px;max-width:500px;font:var(--weight-regular) 19px/1.5 var(--font-body);color:var(--color-honey-ink-2)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px;list-style:none}
.chips li{padding:8px 14px;border-radius:var(--radius-full);font:var(--weight-medium) 14px/1 var(--font-body);
  background:var(--color-honey-raised);box-shadow:inset 0 0 0 1px var(--color-honey-rule)}
.p1{right:250px;top:64px;transform:rotate(-5deg)}
.p2{right:36px;top:104px;transform:rotate(6deg)}
`);

// ---------------------------------------------------------------------------------------------------------
// Recursos: um card por recurso; o README põe dois por linha.
const FEATURE_ICONS = {
  "feature-local": "wifi", "feature-automations": "workflow", "feature-android": "smartphone",
  "feature-secure": "shield-check", "feature-remote": "globe", "feature-dashboard": "layout-dashboard",
};
const feature = (t, key) => { const [title, text] = L.features[key]; return page(t, `
<div id="card" class="surface feat">
  <div class="corner">${textureSvg("tex", 12)}</div>
  ${hexTile(icon(FEATURE_ICONS[key]), "hx tile")}
  <h3>${title}</h3>
  <p>${text}</p>
</div>`, `
.feat{width:600px;height:284px;padding:38px 44px}
.corner{position:absolute;right:0;top:0;width:260px;height:180px;color:var(--color-accent);opacity:.18;
  -webkit-mask:radial-gradient(circle at 100% 0,#000 0,transparent 70%);mask:radial-gradient(circle at 100% 0,#000 0,transparent 70%)}
.corner .tex{z-index:0}
.tile{width:60px;height:60px;color:var(--color-accent-ink)}
.tile>svg:first-child{fill:var(--color-accent-soft);stroke:var(--color-accent-fill);stroke-width:2}
.tile .ic{width:26px;height:26px}
h3{margin-top:22px;font:var(--weight-medium) 27px/1.15 var(--font-display);letter-spacing:var(--tracking-tight)}
.feat p{margin-top:12px;font:var(--weight-regular) 17px/1.5 var(--font-body);color:var(--color-muted)}
`); };

// ---------------------------------------------------------------------------------------------------------
// Integrações: faixa "Works with" com um favo por marca e como cada uma conversa.
const BRANDS = [["plug", "Tuya · Positivo"], ["air-vent", "Midea"], ["tv", "LG webOS"], ["bot", "Xiaomi"], ["smartphone", "Android"]];
const integrations = (t) => page(t, `
<div id="card" class="surface integ">
  <div class="head"><span class="eyebrow">${L.worksWith}</span><span class="note">${L.moreAdapters}</span></div>
  <ul>${BRANDS.map(([ic, name], i) => { const [what, how] = L.brands[i]; return `
    <li>${hexTile(icon(ic), "hx tile")}<b>${name}</b><span>${what}</span><em>${how}</em></li>`; }).join("")}
  </ul>
</div>`, `
.integ{width:1200px;padding:36px 44px 40px}
.head{display:flex;align-items:baseline;justify-content:space-between}
.note{font:var(--weight-regular) 14px/1 var(--font-body);color:var(--color-muted)}
ul{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:28px;list-style:none}
li{display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px 12px 24px;border-radius:20px;background:var(--color-surface-2)}
.tile{width:72px;height:72px;color:var(--color-honey-ink)}
.tile>svg:first-child{fill:var(--color-accent);stroke:var(--color-accent);stroke-width:5;stroke-linejoin:round}
[data-theme=escuro] .tile{color:var(--color-bg)}
.tile .ic{width:30px;height:30px}
li b{margin-top:18px;font:var(--weight-medium) 19px/1.2 var(--font-display);letter-spacing:var(--tracking-tight)}
li span{margin-top:6px;font:var(--weight-regular) 15px/1.35 var(--font-body);color:var(--color-muted)}
li em{margin-top:14px;padding:5px 10px;border-radius:var(--radius-full);font:var(--weight-medium) 12px/1 var(--font-mono);font-style:normal;
  color:var(--color-accent-ink);background:var(--color-accent-soft)}
`);

// ---------------------------------------------------------------------------------------------------------
// Galeria: quatro telas do celular lado a lado, no bloco mel.
const SCREENS_M = ["inicio", "dispositivos", "detalhe", "automacoes"];
const gallery = (t) => page(t, `
<div id="card" class="honey gal">
  ${textureSvg()}
  ${SCREENS_M.map((s, i) => `<figure style="left:${48 + i * 302}px"><div class="phone"><img src="${shot(`m-${t === "dark" ? "escuro" : "claro"}-${s}`)}"></div><figcaption>${L.screens[i]}</figcaption></figure>`).join("")}
</div>`, `
.gal{width:1280px;height:660px;border-radius:32px}
figure{position:absolute;top:44px;width:276px}
figure .phone{position:relative;width:276px;border-radius:46px}
figure .phone img{border-radius:37px}
figcaption{margin-top:18px;text-align:center;font:var(--weight-medium) 17px/1 var(--font-display);letter-spacing:var(--tracking-tight)}
`);

// ---------------------------------------------------------------------------------------------------------
// Desktop: janela de navegador com o painel no desktop.
const desktop = (t) => page(t, `
<div id="card" class="win">
  <div class="bar"><i></i><i></i><i></i><span>http://home-pc:38471</span></div>
  <img src="${shot(`d-${t === "dark" ? "escuro" : "claro"}-inicio`)}">
</div>`, `
.win{width:1280px;border-radius:20px;background:var(--color-surface-2);
  box-shadow:0 0 0 1px var(--color-border-strong),0 30px 60px -24px oklch(0 0 0 / .35)}
.bar{display:flex;align-items:center;gap:8px;height:44px;padding:0 18px}
.bar i{width:12px;height:12px;border-radius:50%;background:var(--color-border-strong)}
.bar span{margin-left:16px;padding:6px 14px;border-radius:var(--radius-full);background:var(--color-surface);
  font:var(--weight-regular) 13px/1 var(--font-mono);color:var(--color-muted)}
.win img{display:block;width:100%}
`);

// ---------------------------------------------------------------------------------------------------------
// Arquitetura: aparelhos <-LAN-> central no PC <-LAN/Tailscale-> celulares e navegador.
const node = (ic, title, sub, cls = "") => `<div class="node ${cls}">${hexTile(icon(ic), "hx tile")}<b>${title}</b><span>${sub}</span></div>`;
const architecture = (t) => page(t, `
<div id="card" class="surface arch">
  <span class="eyebrow">${L.how}</span>
  <div class="row">
    <div class="col">
      ${node("plug", "Tuya · Positivo", "UDP 6666/6667")}
      ${node("air-vent", "Midea", "LAN")}
      ${node("tv", "LG webOS", "WebSocket · WoL")}
      ${node("bot", "Xiaomi", "miio")}
    </div>
    <div class="link"><span>${L.homeNet}</span></div>
    <div class="hub honey">${textureSvg()}
      <div class="hub-in">${logoSvg()}<b>${L.hub}</b><span>${L.hubSub}</span>
        <ul>${L.hubParts.map((x) => `<li>${x}</li>`).join("")}</ul></div>
    </div>
    <div class="link"><span>${L.lanTs}</span></div>
    <div class="col">
      ${["smartphone", "monitor", "layout-grid"].map((ic, i) => node(ic, ...L.clients[i])).join("")}
    </div>
  </div>
</div>`, `
.arch{width:1200px;padding:36px 44px 44px}
.row{display:flex;align-items:center;gap:0;margin-top:28px}
.col{display:flex;flex-direction:column;gap:10px;width:250px}
.node{display:grid;grid-template-columns:44px 1fr;column-gap:14px;align-items:center;padding:12px 16px;border-radius:16px;background:var(--color-surface-2)}
.node .tile{grid-row:span 2;width:44px;height:44px;color:var(--color-accent-ink)}
.node .tile>svg:first-child{fill:var(--color-accent-soft);stroke:var(--color-accent-fill);stroke-width:3}
.node .tile .ic{width:20px;height:20px}
.node b{font:var(--weight-medium) 16px/1.2 var(--font-display)}
.node span{font:var(--weight-regular) 13px/1.3 var(--font-mono);color:var(--color-muted)}
.link{flex:1;position:relative;height:2px;margin:0 6px;background:repeating-linear-gradient(90deg,var(--color-accent) 0 8px,transparent 8px 14px)}
.link span{position:absolute;left:0;right:0;bottom:14px;text-align:center;text-wrap:balance;line-height:1.4 !important;font:var(--weight-medium) 12px/1 var(--font-mono);
  letter-spacing:.04em;color:var(--color-accent-ink)}
.hub{position:relative;overflow:hidden;isolation:isolate;width:300px;border-radius:24px;padding:30px 28px}
.hub-in{display:flex;flex-direction:column;align-items:flex-start}
.hub .logo{width:40px;height:40px;color:var(--color-honey-mark)}
.hub b{margin-top:16px;font:var(--weight-medium) 24px/1.1 var(--font-display);letter-spacing:var(--tracking-tight)}
.hub span{margin-top:6px;font:var(--weight-regular) 15px/1.3 var(--font-body);color:var(--color-honey-ink-2)}
.hub ul{display:flex;flex-wrap:wrap;gap:6px;margin-top:18px;list-style:none}
.hub li{padding:6px 10px;border-radius:var(--radius-full);font:var(--weight-medium) 12px/1 var(--font-body);background:var(--color-honey-raised);box-shadow:inset 0 0 0 1px var(--color-honey-rule)}
`);

// ---------------------------------------------------------------------------------------------------------
const CARDS = {
  hero, integrations, gallery, desktop, architecture,
  ...Object.fromEntries(Object.keys(FEATURE_ICONS).map((k) => [k, (t) => feature(t, k)])),
};

const only = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
// Abrir como arquivo (e não setContent): só assim o @import dos tokens e as fontes locais carregam.
const TMP = resolve(KIT, ".out/cards");
mkdirSync(TMP, { recursive: true });
for (const [name, render] of Object.entries(CARDS)) {
  if (only.length && !only.includes(name)) continue;
  // O desktop não tem texto do README: sai uma vez só.
  for (const [lang, suffix] of name === "desktop" ? [["en", ""]] : [["en", ""], ["pt", "-pt"]]) {
  L = TEXT[lang];
  for (const t of ["light", "dark"]) {
    const html = resolve(TMP, `${name}${suffix}-${t}.html`);
    writeFileSync(html, render(t));
    await p.goto(fileUrl(html), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    // PNG intermediário e WebP final (com alfa): mesma nitidez em 2x por uma fração do peso.
    const png = resolve(TMP, `${name}${suffix}-${t}.png`);
    await p.locator("#card").screenshot({ path: png, omitBackground: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-c:v", "libwebp", "-quality", "90", "-pix_fmt", "yuva420p",
      resolve(ASSETS, `${name}${suffix}-${t}.webp`)]);
  }
  }
}
await browser.close();
console.log("cards em", ASSETS);
