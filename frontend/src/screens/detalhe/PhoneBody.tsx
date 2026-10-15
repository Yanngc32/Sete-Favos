// Detalhe do celular (sensor do app Android): bateria, carregando, em casa ou a quantos km, e o mapa.
import { useEffect, useState } from "react";
import { BatteryCharging, House, LocateFixed, MapPin, Navigation } from "lucide-react";
import { ago, dec } from "@/lib/format";
import type { BodyProps } from "./bodies";
import { Ring } from "./controls";

declare global {
  interface Window {
    /** Ponte do app Android (só existe dentro dele). */
    SeteFavos?: { locationStatus(): "none" | "foreground" | "always"; requestLocation(): void };
  }
}

/** Permissão de localização deste celular, se o painel está no app; o app avisa quando muda. */
function useAppLocation() {
  const read = () => window.SeteFavos?.locationStatus() ?? null;
  const [status, setStatus] = useState(read);
  useEffect(() => {
    const on = () => setStatus(read());
    window.addEventListener("sete-favos-location", on);
    return () => window.removeEventListener("sete-favos-location", on);
  }, []);
  return status;
}

export function PhoneBody({ device, inHero }: BodyProps) {
  const appLocation = useAppLocation();
  const s = device.state;
  const battery = typeof s.battery === "number" ? s.battery : null;
  const lat = typeof s.lat === "number" ? s.lat : null;
  const lon = typeof s.lon === "number" ? s.lon : null;
  const where =
    s.at_home === true ? "Em casa"
    : typeof s.distance_km === "number" ? `A ${dec.format(s.distance_km)} km de casa`
    : lat !== null ? "Fora de casa" : "Sem localização (permita no app)";
  return (
    <>
      {!inHero && (
      <div className="rb">
        <Ring pct={battery ?? 0} size={88} label={battery === null ? "Bateria desconhecida" : `Bateria ${battery} por cento`}>
          {battery === null ? "–" : `${battery}%`}
        </Ring>
        <div>
          <p className="rb-st">{s.charging === true ? "Carregando" : "Na bateria"}</p>
          {s.charging === true && <BatteryCharging className="i" aria-hidden />}
        </div>
      </div>
      )}
      <div className="np">
        <span className="tile">{s.at_home === true ? <House className="i" aria-hidden /> : <MapPin className="i" aria-hidden />}</span>
        <div className="np-tx">
          <b>{where}</b>
          <small>
            {typeof s.located_at === "number" ? `Local de ${ago(s.located_at * 1000)}` : ""}
            {typeof s.accuracy_m === "number" ? ` · precisão ${Math.round(s.accuracy_m)} m` : ""}
          </small>
        </div>
        {lat !== null && lon !== null && (
          <a className="btn btn-sec btn-sm btn-ico" href={`https://www.google.com/maps?q=${lat},${lon}`} target="_blank" rel="noreferrer">
            <Navigation className="i i-sm" aria-hidden />
            Mapa
          </a>
        )}
      </div>
      {appLocation !== null && appLocation !== "always" && (
        <div className="np">
          <span className="tile"><LocateFixed className="i" aria-hidden /></span>
          <div className="np-tx">
            <b>{appLocation === "none" ? "Localização desligada neste celular" : "Localização só com o app aberto"}</b>
            <small>Para avisar quando você chega ou sai de casa, mesmo com o app fechado.</small>
          </div>
          <button type="button" className="btn btn-sec btn-sm" onClick={() => window.SeteFavos?.requestLocation()}>
            {appLocation === "none" ? "Permitir" : "Permitir sempre"}
          </button>
        </div>
      )}
    </>
  );
}
