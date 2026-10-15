import { Classic } from "@/components/theme-toggles/Classic";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/** Alternador claro/escuro (Classic, do banco de referências). Cor e tamanho vêm do kit (`.ibtn`). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === "escuro";
  return (
    <Classic
      toggled={dark}
      duration={320}
      onClick={() => setTheme(dark ? "claro" : "escuro")}
      className={cn("ibtn theme-toggle", className)}
      aria-label={dark ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
      title={dark ? "Tema claro" : "Tema escuro"}
    />
  );
}
