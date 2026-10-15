import { toast } from "@/components/toast";
import type { Device } from "@/lib/types";

/** Comando em grupo em que parte dos aparelhos não respondeu: nunca falha em silêncio ("2 de 3 ok · TV sem resposta"). */
export function toastPartial(view: Pick<Device, "name" | "partial"> | undefined | null) {
  const p = view?.partial;
  if (!p) return;
  toast({
    id: `partial-${view.name}`,
    tone: "error",
    message: `${p.ok} de ${p.total} ok`,
    detail: `${p.failed.join(", ")} sem resposta`,
    duration: 8000,
  });
}
