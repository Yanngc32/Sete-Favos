import { House, HousePlug, Search, Settings, Workflow } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Outlet, useMatches } from "react-router";
import { BottomTabs, SideNav, type NavItem } from "@/components/favos";
import { Conn } from "@/components/Conn";
import { ThemeToggle } from "@/components/ThemeToggle";
import { openSearch } from "@/app/search";
import { cn } from "@/lib/utils";
import { GroupDialogHost } from "@/screens/grupos/GroupDialogHost";
import { SearchPalette } from "@/screens/inicio/SearchPalette";

const NAV: readonly NavItem[] = [
  { to: "/", label: "Início", Icon: House, end: true },
  { to: "/automacoes", label: "Automações", Icon: Workflow },
  { to: "/dispositivos", label: "Dispositivos", Icon: HousePlug },
  { to: "/ajustes", label: "Ajustes", Icon: Settings },
];

/** Rotas podem esconder a barra de abas do celular (subpáginas: editor, assistente). */
export interface RouteHandle {
  noTabbar?: boolean;
}

export function Shell() {
  const matches = useMatches();
  const noTabbar = matches.some((m) => (m.handle as RouteHandle | undefined)?.noTabbar);

  return (
    <div className="app">
      <nav className="side" aria-label="Principal">
        <div className="brand">
          <Logo />
          Sete Favos
        </div>
        <button type="button" className="find" onClick={openSearch}>
          <Search className="i i-sm" aria-hidden />
          <span className="q">Buscar</span>
          <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </button>
        <SideNav items={NAV} />
        <div className="side-foot">
          <div className="side-foot-st">
            <Conn />
            <small>Colmeia no PC</small>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      <main className={cn("main", noTabbar && "no-tabbar")}>
        <Outlet />
      </main>

      {!noTabbar && <BottomTabs items={NAV} />}
      <SearchPalette />
      <GroupDialogHost />
    </div>
  );
}
