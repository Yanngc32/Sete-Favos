// Sprite SVG do Sete Favos: renderizado UMA vez (em main.tsx, no Root). Define:
//   #fv-tex  textura de favos em traço 1px (bloco mel do HoneyHeader). Ladrilho pequeno repetido
//            por <use>, sem url() em CSS nem data URI. Cobre até ~3900 × 1000 px em escala 1:1.
//   #hx-shape o favo (mesmo desenho do Logo: hexágono de ponta pra cima) para tiles e halos.
// Quem usa: <svg><use href="#fv-tex" /></svg> (ver HoneyHeader) e <use href="#hx-shape" />.

const R = 14; // raio do favo da textura (px)
const W = Math.sqrt(3) * R; // largura de um favo
const ROW = R * 1.5; // distância entre linhas
const COLS = 8; // favos por ladrilho (horizontal)
const PAIRS = 4; // pares de linhas por ladrilho (vertical)
const TILE_W = COLS * W;
const TILE_H = PAIRS * 2 * ROW;
const GRID_X = 20;
const GRID_Y = 6;

function hexPath(cx: number, cy: number) {
  let d = "";
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    d += `${k ? "L" : "M"}${(cx + R * Math.cos(a)).toFixed(1)} ${(cy + R * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

// Favos do ladrilho com 1 de margem: as bordas fecham com o vizinho (traço repetido não soma, a opacidade
// é aplicada no <svg> inteiro).
const TILE_D = (() => {
  let d = "";
  for (let j = -1; j <= PAIRS * 2; j++) {
    for (let i = -1; i <= COLS; i++) d += hexPath(i * W + (j & 1 ? W / 2 : 0), j * ROW);
  }
  return d;
})();

const GRID = Array.from({ length: GRID_X * GRID_Y }, (_, n) => [(n % GRID_X) * TILE_W, Math.floor(n / GRID_X) * TILE_H]);

export function FavosSprite() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute", overflow: "hidden" }}>
      <defs>
        <path id="fv-tex-tile" d={TILE_D} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </defs>
      <symbol id="fv-tex" overflow="hidden">
        {GRID.map(([x, y], n) => (
          <use key={n} href="#fv-tex-tile" x={x.toFixed(2)} y={y.toFixed(2)} />
        ))}
      </symbol>
      <symbol id="hx-shape" viewBox="0 0 100 100">
        <polygon points="50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28" />
      </symbol>
    </svg>
  );
}
