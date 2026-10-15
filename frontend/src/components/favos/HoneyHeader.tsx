// Bloco de cor no topo da página (mel no claro, carvão quente no escuro) com textura de favos em traço 1px.
// Depende do <FavosSprite /> (já montado no Root, em main.tsx) para o símbolo #fv-tex.
import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

export interface HoneyHeaderProps {
  /** Título da página (vira o <h1>). */
  title: ReactNode;
  /** Linha de estado embaixo do título ("6 aparelhos · 3 ligados"). */
  subtitle?: ReactNode;
  /** Anuncia mudanças do subtítulo (aria-live="polite"), ex. contagem ao vivo. */
  liveSubtitle?: boolean;
  /** Botões à direita da barra do topo (use .ibtn.bd: o bloco já ajusta as cores). */
  actions?: ReactNode;
  /** Botão à esquerda (Voltar). */
  leading?: ReactNode;
  /** Mostra a marca "Sete Favos" na barra (só no celular; no desktop a marca está no menu lateral). */
  brand?: boolean;
  /**
   * "hero": barra (marca/ações) + saudação grande e leve embaixo (Início).
   * "compacta" (padrão): título na própria barra (Dispositivos, Automações, Ajustes).
   * "detalhe": título centralizado entre `leading` e `actions` (Detalhe de um aparelho).
   */
  variant?: "hero" | "compacta" | "detalhe";
  /** Conteúdo extra dentro do bloco: busca, pílulas de filtro, número herói. */
  children?: ReactNode;
  /** Arte decorativa por cima da textura e por baixo do texto (ex.: lâmpada com halo). aria-hidden. */
  art?: ReactNode;
  className?: string;
  id?: string;
}

export function HoneyHeader({
  title,
  subtitle,
  liveSubtitle,
  actions,
  leading,
  brand,
  variant = "compacta",
  children,
  art,
  className,
  id,
}: HoneyHeaderProps) {
  const inBar = variant !== "hero";
  return (
    <header className={cn("fv", `fv-${variant}`, className)} id={id}>
      <svg className="fv-tex" aria-hidden focusable="false">
        <use href="#fv-tex" />
      </svg>
      {art && (
        <div className="fv-art" aria-hidden>
          {art}
        </div>
      )}
      <div className="fv-in fv-enter">
        {(leading || brand || actions || inBar) && (
          <div className="fv-bar">
            {leading}
            {brand && (
              <span className="fv-mark">
                <Logo />
                Sete Favos
              </span>
            )}
            {inBar && <h1 className="fv-t">{title}</h1>}
            {actions && <div className="fv-acts">{actions}</div>}
          </div>
        )}
        {!inBar && <h1 className="fv-greet">{title}</h1>}
        {subtitle !== undefined && subtitle !== null && subtitle !== false && (
          <p className="fv-s" aria-live={liveSubtitle ? "polite" : undefined}>
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </header>
  );
}

export interface HoneySearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Rótulo acessível (o placeholder não substitui). */
  label: string;
}

/** Campo de busca claro sobre o bloco mel (altura 48, raio de controle). */
export function HoneySearch({ label, className, ...rest }: HoneySearchProps) {
  return (
    <label className={cn("fv-search", className)}>
      <Search className="i i-sm" aria-hidden />
      <span className="sr">{label}</span>
      <input type="search" autoComplete="off" {...rest} />
    </label>
  );
}
