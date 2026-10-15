// Ajustes · Sete Favos: bloco mel compacto + seções em cards (Aparência, Segurança, Casa, Sobre).
import { ChevronRight, Download, Moon, MonitorSmartphone, Rows2, Rows3, ShieldCheck, Smartphone, Sun } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { HexTile, HoneyPage, Swap } from "@/components/favos";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";
import { useDensity, type Density } from "@/lib/density";
import { useTheme } from "@/lib/theme";
import "@/screens/acesso/acesso.css";
import { Atualizacoes } from "./Atualizacoes";
import { LocalCasa } from "./LocalCasa";

/** Seção de Ajustes: título + card com linhas. */
export function AjSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="aj-sec" aria-labelledby={id}>
      <h2 id={id} className="aj-t" tabIndex={-1}>
        {title}
      </h2>
      <ul className="aj-card" aria-labelledby={id}>
        {children}
      </ul>
    </section>
  );
}

const DENSITIES: { value: Density; label: string }[] = [
  { value: "confortavel", label: "Confortável" },
  { value: "compacta", label: "Compacta" },
];

/** Densidade do painel: por aparelho de acesso (como o tema). Troca espaçamentos e alturas de cards e listas. */
function DensityRow() {
  const { density, setDensity } = useDensity();
  const ref = useRef<HTMLDivElement>(null);
  const compact = density === "compacta";
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: Density = e.key === "Home" ? "confortavel" : e.key === "End" ? "compacta" : compact ? "confortavel" : "compacta";
    setDensity(next);
    ref.current?.querySelector<HTMLButtonElement>(`[data-v="${next}"]`)?.focus();
  }
  return (
    <li className="aj-r aj-dens">
      <HexTile icon={<span className="aj-swap" key={density}>{compact ? <Rows3 className="i" aria-hidden /> : <Rows2 className="i" aria-hidden />}</span>} variant="soft" size="sm" />
      <div className="tx">
        <p className="t" id="aj-densidade">
          Densidade
        </p>
        <p className="s">{compact ? "Mais cards por tela, menos respiro" : "Mais respiro entre cards e linhas"} · só neste aparelho</p>
      </div>
      <div className="seg aj-seg" role="radiogroup" aria-labelledby="aj-densidade" ref={ref} onKeyDown={onKeyDown}>
        {DENSITIES.map((d) => (
          <button
            key={d.value}
            type="button"
            role="radio"
            data-v={d.value}
            aria-checked={density === d.value}
            tabIndex={density === d.value ? 0 : -1}
            onClick={() => setDensity(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>
    </li>
  );
}

export function Ajustes() {
  const { theme, pref, setTheme, followSystem } = useTheme();
  const dark = theme === "escuro";
  const [version, setVersion] = useState<string | null>(null);
  const [pc, setPc] = useState(false);
  const [apk, setApk] = useState<string | null>(null);
  const [paired, setPaired] = useState<number | null>(null);
  const { hash, key } = useLocation();

  // /ajustes#aj-casa (card do clima sem local): rola até a seção e foca o título, inclusive vindo de outra rota.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    // Espera a entrada da página (o painel começa deslocado) antes de medir.
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      (el.closest<HTMLElement>(".aj-sec") ?? el).scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      el.focus({ preventScroll: true });
    }, 260);
    return () => clearTimeout(t);
    // key: clicar de novo em "Definir" com o mesmo hash também rola.
  }, [hash, key]);

  useEffect(() => {
    let alive = true;
    api.version().then((v) => alive && setVersion(v.version), () => {});
    api.session().then(
      (s) => {
        if (!alive) return;
        setPc(s.access === "pc");
        if (s.access === "pc") api.access.devices().then((l) => alive && setPaired(l.length), () => {});
      },
      () => {},
    );
    api.androidApp().then((a) => alive && setApk(a.available ? a.url : null), () => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <HoneyPage
      title="Ajustes"
      subtitle={<>Sete Favos · {version ? <span className="num">versão {version}</span> : "versão…"}</>}
      bodyClassName="acc aj"
    >
      <AjSection id="aj-aparencia" title="Aparência">
        <li className="aj-r">
          <HexTile icon={<span className="aj-swap" key={theme}>{dark ? <Moon className="i" aria-hidden /> : <Sun className="i" aria-hidden />}</span>} variant="soft" size="sm" />
          <div className="tx">
            <p className="t">
              Tema <Swap value={dark ? "escuro" : "claro"} />
            </p>
            <p className="s">{pref ? "Escolha deste aparelho" : "Segue o sistema"}</p>
          </div>
          <ThemeToggle className="bd" />
        </li>
        <li className="aj-r">
          <HexTile icon={MonitorSmartphone} size="sm" />
          <div className="tx">
            <p className="t" id="aj-sistema">
              Usar o tema do sistema
            </p>
            <p className="s">Acompanha o claro e o escuro do aparelho</p>
          </div>
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={pref === null}
            aria-labelledby="aj-sistema"
            onClick={() => (pref === null ? setTheme(theme) : followSystem())}
          />
        </li>
        <DensityRow />
      </AjSection>

      <AjSection id="aj-acesso" title="Segurança">
        <li>
          <Link className="aj-r aj-link" to="/ajustes/acesso">
            <HexTile icon={ShieldCheck} size="sm" />
            <div className="tx">
              <p className="t">Acesso</p>
              <p className="s">
                {paired === null
                  ? "Celulares e notebooks que podem abrir o painel"
                  : paired === 0
                    ? "Só este PC · pareie um celular"
                    : `Este PC e mais ${paired} ${paired === 1 ? "aparelho" : "aparelhos"}`}
              </p>
            </div>
            <ChevronRight className="i aj-chev" aria-hidden />
          </Link>
        </li>
      </AjSection>

      <AjSection id="aj-casa" title="Casa">
        <LocalCasa pc={pc} />
      </AjSection>

      <AjSection id="aj-sobre" title="Sobre">
        <li className="aj-r">
          <HexTile icon={<Logo className="i" />} variant="soft" size="sm" />
          <div className="tx">
            <p className="t">Sete Favos</p>
            <p className="s num">{version ? `Versão ${version}` : "Versão…"}</p>
          </div>
        </li>
        <Atualizacoes pc={pc} />
        {apk && (
          <li className="aj-r">
            <HexTile icon={Smartphone} size="sm" />
            <div className="tx">
              <p className="t">App Android</p>
              <p className="s">Painel e widgets na tela inicial. Abra esta página no celular para instalar.</p>
            </div>
            <a className="btn btn-sec btn-sm btn-ico" href={apk} download="SeteFavos.apk">
              <Download className="i i-sm" aria-hidden />
              Baixar
            </a>
          </li>
        )}
      </AjSection>
    </HoneyPage>
  );
}
