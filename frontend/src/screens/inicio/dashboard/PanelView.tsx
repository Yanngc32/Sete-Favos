// Painel personalizado no modo normal: as abas e as seções que a pessoa montou (sem alça nem engrenagem).
import type { DashView } from "@/lib/types";
import { Board } from "./Board";
import { useActiveView } from "./util";

export function PanelView({ views, desktop }: { views: DashView[]; desktop: boolean }) {
  const [activeId, setActive] = useActiveView(views.map((v) => v.id));
  return <Board views={views} activeId={activeId} onActive={setActive} columns={desktop ? 4 : 2} guide={null} />;
}
