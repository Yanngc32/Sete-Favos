// Marca do Sete Favos: sete favos de colmeia. Mesmo desenho dos ícones gerados por packaging/icons.py.
// Daqui saem também o carregando e a abertura do app: a colmeia se montando favo a favo.
import { cn } from "@/lib/utils";
import "./logo.css";

const R = 9.5;
const RING = 21;
// Centro primeiro; depois os de fora em sentido horário (a montagem segue essa ordem).
const CENTERS: [number, number][] = [[50, 50], ...Array.from({ length: 6 }, (_, k): [number, number] => {
  const a = (Math.PI / 3) * k;
  return [50 + RING * Math.cos(a), 50 + RING * Math.sin(a)];
})];
const points = ([cx, cy]: [number, number]) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return `${(cx + R * Math.cos(a)).toFixed(2)},${(cy + R * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

type Props = { className?: string };

/** `vazio`: só o contorno dos favos (colmeia sem aparelhos). */
export function Logo({ className, vazio }: Props & { vazio?: boolean }) {
  return (
    <svg className={cn("favos", vazio && "is-vazio", className)} viewBox="19 19 62 62" aria-hidden>
      {CENTERS.map((c, i) => <polygon key={i} points={points(c)} />)}
    </svg>
  );
}

/** Carregando: a colmeia se monta favo a favo. Troca direta do LoaderCircle (aceita e ignora o `.spin`). */
export function Loader({ className }: Props) {
  return <Logo className={cn("favos-build", className)} />;
}

/** Abertura enquanto a sessão carrega: a colmeia se monta favo a favo, em loop. */
export function Splash() {
  return (
    <div className="splash" role="status">
      <Logo className="favos-build" />
      <span className="splash-t">Sete Favos</span>
      <span className="sr">Abrindo</span>
    </div>
  );
}
