// Navegação Sete Favos: barra de baixo em pílulas (celular) e lista do menu lateral (desktop) com
// indicador latão que desliza. Os itens vêm da casca (app/Shell.tsx).
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { matchPath, NavLink, useLocation } from "react-router";

export interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** Casa só o caminho exato (Início). */
  end?: boolean;
}

/** Índice do item ativo pela rota atual (-1 se nenhum). */
export function useActiveNav(items: readonly NavItem[]) {
  const { pathname } = useLocation();
  return items.findIndex((it) => matchPath({ path: it.to, end: it.end ?? false }, pathname));
}

/**
 * Barra de abas do celular: só a ativa mostra o rótulo, num fundo latão soft. A pílula ativa cresce
 * (flex) e o rótulo abre em largura + opacidade; o resto é ícone com aria-label.
 */
export function BottomTabs({ items, label = "Principal" }: { items: readonly NavItem[]; label?: string }) {
  return (
    <nav className="fv-tabs" aria-label={label}>
      {items.map(({ to, label: l, Icon, end }) => (
        <NavLink key={to} to={to} end={end} aria-label={l}>
          <Icon className="i" aria-hidden />
          <span className="fv-tabs-l" aria-hidden>
            <span>{l}</span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Lista do menu lateral com o realce latão soft deslizando entre os itens (só transform). */
export function SideNav({ items }: { items: readonly NavItem[] }) {
  const active = useActiveNav(items);
  return (
    <div className="nav fv-nav" style={{ "--i": Math.max(active, 0) } as CSSProperties}>
      <span className="fv-nav-ind" aria-hidden data-hidden={active < 0 || undefined} />
      {items.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}>
          <Icon className="i" aria-hidden />
          {label}
        </NavLink>
      ))}
    </div>
  );
}
