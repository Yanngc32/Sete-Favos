// Datas e números no tom da casa (pt-BR, curtos).

const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "hoje 14:02", "ontem 22:30", "12 out 09:15". Recebe segundos (epoch da central). */
export function whenShort(epochSeconds: number, now = Date.now()): string {
  const d = new Date(epochSeconds * 1000);
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000);
  const time = hhmm.format(d);
  if (days === 0) return `hoje ${time}`;
  if (days === 1) return `ontem ${time}`;
  return `${dayMonth.format(d).replace(".", "")} ${time}`;
}

/** "agora", "há 3 s", "há 3 min", "há 2 h", "há 4 dias". Recebe milissegundos. */
export function ago(sinceMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - sinceMs) / 1000));
  if (s < 2) return "agora";
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** "4:59" (tabular). */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "1.120" */
export const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
export const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
