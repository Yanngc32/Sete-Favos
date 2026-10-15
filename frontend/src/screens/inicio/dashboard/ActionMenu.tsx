// Menu ⋯ do modo editar (faixa, aba, seção): Base UI Menu com o visual `.menu` do kit.
import { Menu } from "@base-ui/react/menu";
import { Fragment, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuEntry {
  label: string;
  Icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Linha separando do grupo de cima. */
  divider?: boolean;
  /** A ação leva o foco pra outro lugar (ex.: o campo de renomear): o menu não devolve o foco ao botão. */
  moveFocus?: boolean;
}

interface Props {
  /** Nome acessível do botão (e do menu). */
  label: string;
  triggerClassName: string;
  trigger: ReactNode;
  items: MenuEntry[];
  align?: "start" | "end";
}

export function ActionMenu({ label, triggerClassName, trigger, items, align = "end" }: Props) {
  const skipFocus = useRef(false);
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClassName} aria-label={label}>
        {trigger}
      </Menu.Trigger>
      <Menu.Portal className="mk ep">
        <Menu.Positioner className="ep-menu-pos" side="bottom" align={align} sideOffset={4}>
          <Menu.Popup
            className="menu ep-menu"
            aria-label={label}
            finalFocus={() => {
              const skip = skipFocus.current;
              skipFocus.current = false;
              return !skip;
            }}
          >
            {items.map((it) => (
              <Fragment key={it.label}>
                {it.divider && <Menu.Separator render={<hr />} />}
                <Menu.Item
                  nativeButton
                  render={<button type="button" />}
                  className={cn(it.danger && "dz")}
                  disabled={it.disabled}
                  onClick={() => {
                    if (it.moveFocus) skipFocus.current = true;
                    it.onSelect();
                  }}
                >
                  <it.Icon className="i" aria-hidden />
                  {it.label}
                </Menu.Item>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
