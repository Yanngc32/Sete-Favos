# Base Sete Favos (`@/components/favos`)

Peças compartilhadas do visual "Sete Favos" (abelha/colmeia). Referência visual original: `exploracao-favos.html`
(fonte de design, fora do repo). Vitrine viva em dev: **`/_favos?v=compacta|hero|detalhe`**.

```ts
import { HoneyPage, HexTile, FilterPills, DeviceRow, Swap, Collapse, ExpandButton, useDisclosure } from "@/components/favos";
```

O CSS (`favos.css`, `@layer components`) já é global via `src/index.css`; o sprite SVG (`<FavosSprite />`, símbolos
`#fv-tex` e `#hx-shape`) já está montado no Root (`main.tsx`). Não importe nem monte de novo.

## Regras
- Só tokens. Novos desta base: `--color-honey-{bg,ink,ink-2,line,rule,raised,control,switch,mark}`,
  `--radius-curve` (33px), `--opacity-texture` (5% claro / 7% escuro). Estão no `tokens.json` do DS.
- Dentro do bloco mel (`.fv`) as peças do kit já trocam de cor: `.ibtn`, `.ibtn.bd`, `.sw`, `.btn-link`, `.btn`
  (principal vira superfície clara; latão sobre mel some) e o anel de foco (vira `--color-honey-ink`).
- Uma página = um `HoneyPage`. A tela não desenha o próprio `<h1>`: o título vai no bloco.
- Movimento: entrada de página (fade + 6px), crossfade de valores, abrir/recolher, indicador das pílulas e da
  navegação já vêm prontos. Tudo cai pra fade ≤150ms em `prefers-reduced-motion`. Não some animação por cima.
- Elemento `position: fixed` (sheet, FAB) dentro do painel: renderize por portal ou fora do `HoneyPage` — nos
  220ms da entrada o painel tem `transform` e o fixed ficaria preso a ele.

## HoneyPage — bloco mel + painel com a curva em S
```tsx
<HoneyPage
  variant="compacta"              // "hero" (Início: saudação grande) | "compacta" (padrão) | "detalhe" (título no centro)
  title="Dispositivos"
  subtitle={<>6 aparelhos · <Swap value={on} /> ligados</>}
  liveSubtitle                     // aria-live="polite" no subtítulo
  actions={<Link className="ibtn bd" to="/dispositivos/novo" aria-label="Adicionar aparelho"><Plus className="i" aria-hidden /></Link>}
  headerContent={<><HoneySearch label="Buscar aparelho" placeholder="Buscar aparelho" value={q} onChange={...} /><FilterPills .../></>}
  bodyClassName="minha-tela"       // gap/padding próprios do painel (padrão: coluna, gap 12 / 16 no desktop)
>
  ...conteúdo...
</HoneyPage>
```
Outras props: `brand` (marca Sete Favos na barra, só celular — use na Início), `leading` (Voltar), `art` (arte
decorativa atrás do texto, ex. lâmpada com halo), `lift` (o 1º filho com classe `fv-lift` sobe por cima do bloco,
ex. card do tempo), `width="wide"` (sem o limite de 880px no desktop), `bodyProps` (id/role do painel, ex. tabpanel).

`HoneyHeader` é o bloco sozinho (mesmas props, `children` = conteúdo do bloco) se a tela precisar montar o painel.
Painel manual: `<div className="fv-pg"><div className="fv-in fv-pg-in">…</div></div>` logo depois do header.

Detalhe (número herói no bloco): `variant="detalhe"`, `leading` = Voltar, `actions` = menu, e o número em
`headerContent` com `.hero-num` (cor: `color: var(--color-honey-ink)`; `small` em `--color-honey-ink-2`).

## HexTile — favo do ícone
```tsx
<HexTile icon={Lamp} />                       // neutral, md 44px
<HexTile icon={Lamp} variant="on" size="sm" /> // latão cheio (ligado), 40px
<HexTile icon={<Bed className="i" />} variant="soft" size="xl" label="Quarto" />  // 68px, com nome acessível
```
`variant`: `neutral` | `soft` | `on`. `size`: `sm` 40 | `md` 44 | `xl` 68. Sem `label` é decorativo.

## FilterPills — filtros/abas com contagem e indicador deslizante
```tsx
<FilterPills
  label="Filtrar por cômodo"
  value={room} onChange={setRoom}
  options={[{ value: "todos", label: "Todos", count: 6 }, { value: "sala", label: "Sala", count: 3 }]}
  // mode="tabs" panelId="painel-x"  → role tablist/tab + aria-controls (padrão: radiogroup/radio)
  // tone="page"                     → sobre o fundo da página (padrão "honey", sobre o bloco)
/>
```
Teclado: setas/Home/End (foco itinerante). Rola sozinho até a escolhida. Na página com abas, ligue o painel:
`bodyProps={{ id: "painel-x", role: "tabpanel", "aria-label": "Rotinas" }}`.

## DeviceRow — linha de aparelho (ligado = tinta latão)
```tsx
<DeviceRow
  icon={Tv} title="TV da sala" meta={<>Ligada · vol <Swap value={vol} /></>}
  on={d.on} offline={!d.online}            // offline: opacidade + meta em warning (escreva o motivo em meta)
  to={`/aparelho/${d.id}`}                  // ou onOpen={() => ...}
  switch={{ checked: d.on, onChange: toggle, label: "Ligar TV da sala", busy: pending }}
  expandLabel="controles da TV da sala"     // com children aparece a seta e a região que abre
  // open/onOpenChange (controlado) ou defaultOpen
>
  ...controles (volume, entradas)...
</DeviceRow>
```

## Abrir/recolher
```tsx
const d = useDisclosure();                   // { open, toggle, setOpen, regionId }
<ExpandButton open={d.open} onClick={d.toggle} controls={d.regionId} label="horários" />
<Collapse open={d.open} id={d.regionId} innerClassName="meu-padding">…</Collapse>
// atalho: <Expandable summary={<b>Horários</b>} label="horários">…</Expandable>
```
Altura anima por `grid-template-rows 0fr→1fr` + fade; fechada fica `inert`. Padding vai no `innerClassName`.

## Swap — valor trocando com crossfade
`<Swap value={18} />` ou `<Swap value={temp}>{temp}<small>°C</small></Swap>`. Troca quando `value` muda; não anima
no 1º render; largura estável (`tabular-nums` é por conta do contêiner, ex. `.hero-num`).

## Navegação (já aplicada na casca, `app/Shell.tsx`)
`BottomTabs` (celular, <1024px: pílulas, só a ativa com rótulo, fundo `--color-accent-soft`) e `SideNav` (desktop:
realce latão soft que desliza). Itens: Início `/`, Automações `/automacoes`, Dispositivos `/dispositivos`
(ícone `HousePlug`), Ajustes `/ajustes`. `/aparelhos` e `/aparelhos/novo` redirecionam pros novos.

## Créditos
Estrutura de `FilterPills`/`Expandable` inspirada em Wensity UI (Tabs, Collapsible — MIT, © 2026 Wensity Private
Limited) e Opensource UI (Segmented toggle — MIT, © 2026 Bidyut Kundu), do banco de referências. Código
reescrito aqui sem copiar trechos; licenças em `licenses/` na raiz do repo.
