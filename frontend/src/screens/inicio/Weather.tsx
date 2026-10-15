// Card do tempo da Início (mock "exploracao-favos", tela 1): sobe por cima do bloco mel (fv-lift).
// Estrutura de "snapshot do tempo" inspirada no Weather Snapshot do Opensource UI (MIT, © 2026 Bidyut Kundu),
// banco de referências; código reescrito aqui com os tokens do DS.
import { Droplets, Eye, MapPin, Wind } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { HexTile, Swap } from "@/components/favos";
import { api, type Weather } from "@/lib/api";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { weatherIcon } from "./home";

const REFRESH = 10 * 60_000;

export type WeatherState = { status: "loading" } | { status: "off" } | { status: "ok"; data: Weather };

/** Busca o tempo ao abrir, a cada 10 min e quando a colmeia volta. Falha mantém o último valor. */
export function useWeather(online: boolean): WeatherState {
  const [st, setSt] = useState<WeatherState>({ status: "loading" });
  useEffect(() => {
    // Colmeia fora antes do primeiro dado: nada a mostrar (sem esqueleto eterno).
    if (!online) {
      setSt((s) => (s.status === "loading" ? { status: "off" } : s));
      return;
    }
    let alive = true;
    const load = () =>
      api
        .weather()
        // "indisponível" passageiro não apaga o último tempo bom.
        .then((data) => alive && setSt((s) => (!data.available && data.reason === "indisponivel" && s.status === "ok" && s.data.available ? s : { status: "ok", data })))
        .catch(() => alive && setSt((s) => (s.status === "ok" ? s : { status: "ok", data: { available: false, reason: "indisponivel" } })));
    void load();
    const t = setInterval(load, REFRESH);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [online]);
  return st;
}

/** O card aparece? (carregando = esqueleto no lugar; sem local = convite pra Ajustes; indisponível = some). */
export function weatherShown(st: WeatherState): boolean {
  if (st.status === "off") return false;
  return st.status === "loading" || st.data.available || st.data.reason === "sem_local";
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "qua, 14 de out · 19:40" (sem os pontos de abreviação do Intl). */
function when(now: number) {
  const d = new Date(now);
  return `${dateFmt.format(d).replace(/\./g, "")} · ${timeFmt.format(d)}`;
}

export function WeatherCard({ st, now, className }: { st: WeatherState; now: number; className?: string }) {
  if (st.status === "loading") {
    return (
      <section className={cn("ini-wx is-sk", className)} aria-busy="true" aria-label="Carregando o tempo">
        <div className="ini-wx-top">
          <span className="sk ini-wx-skh" />
          <div className="ini-wx-tx">
            <span className="sk" style={{ width: 88, height: 14 }} />
            <span className="sk" style={{ width: 120, height: 12 }} />
          </div>
          <span className="sk" style={{ width: 64, height: 36 }} />
        </div>
        <div className="ini-wx-m" aria-hidden>
          <span className="sk" />
          <span className="sk" />
          <span className="sk" />
        </div>
      </section>
    );
  }
  if (st.status === "off") return null;
  const w = st.data;
  if (!w.available) {
    return (
      <section className={cn("ini-wx ini-wx-cta", className)} aria-label="Tempo">
        <HexTile icon={MapPin} variant="soft" />
        <div className="ini-wx-tx">
          <b>Defina o local da casa em Ajustes</b>
          <span>Com ele a colmeia mostra o tempo daqui e acerta o nascer e o pôr do sol.</span>
        </div>
        <Link className="btn btn-sec btn-sm" to="/ajustes#aj-casa">
          Definir
        </Link>
      </section>
    );
  }
  const Icon = weatherIcon(w.icon);
  return (
    <section className={cn("ini-wx", className)} aria-label="Tempo agora">
      <div className="ini-wx-top">
        <HexTile icon={Icon} />
        <div className="ini-wx-tx">
          <b>
            <Swap value={w.condition} />
          </b>
          <span>{when(now)}</span>
        </div>
        <span className="sr">{int.format(Math.round(w.temp_c))} °C</span>
        <span className="hero-num ini-wx-t" aria-hidden>
          <Swap value={Math.round(w.temp_c)} />
          <small>°C</small>
        </span>
      </div>
      <dl className="ini-wx-m">
        <div>
          <dt>Umidade</dt>
          <dd>
            <Droplets className="i i-sm" aria-hidden />
            <Swap value={w.humidity}>{int.format(w.humidity)}%</Swap>
          </dd>
        </div>
        <div>
          <dt>Visibilidade</dt>
          <dd>
            <Eye className="i i-sm" aria-hidden />
            {w.visibility_km === null ? "–" : <Swap value={w.visibility_km}>{int.format(w.visibility_km)} km</Swap>}
          </dd>
        </div>
        <div>
          <dt>Vento</dt>
          <dd>
            <Wind className="i i-sm" aria-hidden />
            <Swap value={w.wind_kmh}>{int.format(w.wind_kmh)} km/h</Swap>
          </dd>
        </div>
      </dl>
    </section>
  );
}
