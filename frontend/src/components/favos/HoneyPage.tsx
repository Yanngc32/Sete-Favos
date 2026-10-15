// Página Sete Favos: HoneyHeader + painel de conteúdo com a curva em S (o bloco mel desce por trás do
// conteúdo; à esquerda o conteúdo faz canto côncavo, à direita tem canto de cima arredondado).
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HoneyHeader, type HoneyHeaderProps } from "./HoneyHeader";

export interface HoneyPageProps extends Omit<HoneyHeaderProps, "children" | "className" | "id"> {
  /** Conteúdo dentro do bloco mel (busca, pílulas, número herói). */
  headerContent?: ReactNode;
  /** Conteúdo da página (fica no painel claro, abaixo da curva). */
  children: ReactNode;
  /**
   * O 1º filho do painel sobe por cima do bloco (ex.: card do tempo na Início). O bloco ganha altura extra
   * e o filho precisa da classe `fv-lift`.
   */
  lift?: boolean;
  /** Largura do miolo no desktop: "content" (880, padrão) ou "wide" (sem limite). */
  width?: "content" | "wide";
  className?: string;
  headerClassName?: string;
  /** Classe do painel de conteúdo (gap/padding próprios da tela). */
  bodyClassName?: string;
  /** Props extras do painel (ex. id/role/aria-labelledby quando ele é o tabpanel das FilterPills). */
  bodyProps?: HTMLAttributes<HTMLDivElement>;
}

export function HoneyPage({
  headerContent,
  children,
  lift,
  width = "content",
  className,
  headerClassName,
  bodyClassName,
  bodyProps,
  ...header
}: HoneyPageProps) {
  return (
    <div className={cn("fv-page", width === "wide" && "fv-wide", className)}>
      <HoneyHeader {...header} className={cn(lift && "fv-lifted", headerClassName)}>
        {headerContent}
      </HoneyHeader>
      <div {...bodyProps} className={cn("fv-pg", bodyProps?.className)}>
        <div className={cn("fv-in fv-pg-in fv-enter fv-enter-2", bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}
