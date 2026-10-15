// Ajustes > Localização da casa: base do nascer/pôr do sol e de "celular em casa". Editar só no PC.
import { LocateFixed, MapPin, Sunrise, Sunset } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "@/components/toast";
import { HexTile } from "@/components/favos";
import { api, type HomeLocation } from "@/lib/api";

/** "-22.9068, -43.1729" (como o Google Maps copia) -> [lat, lon]. */
function parseCoords(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", "."));
  const lon = Number(m[2].replace(",", "."));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

export function LocalCasa({ pc }: { pc: boolean }) {
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.home.get().then((h) => alive && setHome(h), () => {});
    return () => {
      alive = false;
    };
  }, []);

  const save = async (lat: number, lon: number) => {
    setBusy(true);
    try {
      setHome(await api.home.set({ lat, lon, radius_m: home?.radius_m ?? 150 }));
      setText("");
      toast({ tone: "ok", message: "Localização da casa salva" });
    } catch (e) {
      toast({ tone: "error", message: "Não consegui salvar", detail: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = parseCoords(text);
    if (!c) return toast({ tone: "error", message: "Cole as coordenadas como no Google Maps: -22.9068, -43.1729" });
    void save(c[0], c[1]);
  };

  const here = () => {
    if (!("geolocation" in navigator)) return toast({ tone: "error", message: "Este navegador não dá a localização." });
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => void save(Number(p.coords.latitude.toFixed(5)), Number(p.coords.longitude.toFixed(5))),
      () => {
        setBusy(false);
        toast({ tone: "error", message: "Não deu para pegar a localização. Cole as coordenadas." });
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const set = home && home.lat !== null && home.lon !== null;
  return (
    <>
      <li className="aj-r">
        <HexTile icon={MapPin} variant={set ? "soft" : "neutral"} size="sm" />
        <div className="tx">
          <p className="t">Localização da casa</p>
          <p className="s num">
            {!home ? "…" : set ? `${home.lat!.toFixed(4)}, ${home.lon!.toFixed(4)}` : "Não definida: usada pelo nascer/pôr do sol e pelo celular em casa"}
          </p>
          {set && home.sunrise && home.sunset && (
            <p className="s num aj-sun">
              <Sunrise className="i i-sm" aria-hidden /> {home.sunrise}
              <Sunset className="i i-sm" aria-hidden /> {home.sunset}
              <span className="sr">nascer e pôr do sol hoje</span>
            </p>
          )}
        </div>
      </li>
      {pc && (
        <li className="aj-r aj-sub">
          <form className="tx aj-tok" onSubmit={submit}>
            <div className="aj-tok-row">
              <span className="inp">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label="Coordenadas da casa"
                  placeholder="-22.9068, -43.1729"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </span>
              <button type="submit" className="btn btn-sm" disabled={!text.trim() || busy}>
                Salvar
              </button>
            </div>
            <button type="button" className="btn btn-sec btn-sm btn-ico" disabled={busy} onClick={here}>
              <LocateFixed className="i i-sm" aria-hidden />
              Usar a localização deste aparelho
            </button>
          </form>
        </li>
      )}
    </>
  );
}
