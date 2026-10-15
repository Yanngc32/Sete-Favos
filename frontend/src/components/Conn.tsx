import { useLive } from "@/lib/live";

/** Indicador de conexão com a central (ponto + texto; o estado nunca é só cor). */
export function Conn() {
  const { connection } = useLive();
  const [label, tone] =
    connection === "online"
      ? ["Conectado", ""]
      : connection === "offline"
        ? ["Reconectando…", "warn"]
        : connection === "unauthorized"
          ? ["Sem acesso", "err"]
          : ["Conectando…", "warn"];
  return (
    <span className="conn" role="status">
      <span className={`dot ${tone}`} aria-hidden />
      {label}
    </span>
  );
}
