// Tile de ícone em favo (mesmo hexágono do Logo; o contorno da mesma cor arredonda os cantos).
import type { LucideIcon } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HexTileVariant = "neutral" | "soft" | "on";
export type HexTileSize = "sm" | "md" | "xl";

export interface HexTileProps {
  /** Componente do lucide (`Lamp`) ou um elemento já pronto (`<Lamp className="i" />`). */
  icon: LucideIcon | ReactNode;
  /** neutral = superfície 2 · soft = latão claro · on = latão cheio (aparelho ligado). */
  variant?: HexTileVariant;
  /** sm 40px · md 44px (padrão) · xl 68px. */
  size?: HexTileSize;
  /** Texto pra leitor de tela. Sem label o tile é decorativo (aria-hidden). */
  label?: string;
  className?: string;
}

export function HexTile({ icon, variant = "neutral", size = "md", label, className }: HexTileProps) {
  let glyph: ReactNode = icon as ReactNode;
  if (!isValidElement(icon) && (typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon))) {
    const Icon = icon as LucideIcon;
    glyph = <Icon className="i" aria-hidden />;
  }
  return (
    <span
      className={cn("hx", variant !== "neutral" && `hx-${variant}`, size !== "md" && `hx-${size}`, className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg className="hx-s" viewBox="0 0 100 100" aria-hidden focusable="false">
        <polygon points="50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28" />
      </svg>
      {glyph}
    </span>
  );
}
