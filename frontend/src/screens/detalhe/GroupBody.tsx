// Corpo do Detalhe de um grupo (mock aprovado "Criar e editar grupo", "Detalhe do grupo"):
// linha liga/desliga com switch grande, os controles em comum (a central já manda só a interseção) e
// "Aparelhos do grupo" (linhas de 56px que abrem o detalhe do membro).
import { ChevronRight, WifiOff } from "lucide-react";
import { Link } from "react-router";
import { groupCounts, has, isOffline, isOn, kindIcon, stateText } from "@/lib/devices";
import { useLive } from "@/lib/live";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AcBody, LightBody, TvBody, type BodyProps } from "./bodies";

/** Frase curta do membro na lista: "Ligada · 80%", "Desligada", "Sem resposta". */
function memberText(m: Device): string {
  if (isOffline(m)) return "Sem resposta";
  const text = stateText(m);
  return m.kind === "light" ? text.split(" · ").slice(0, 2).join(" · ") : text;
}

export function GroupBody({ device, ctl, disabled, inHero }: BodyProps) {
  const { devices } = useLive();
  const { total, on: onCount, offline } = groupCounts(device);
  const power = ctl.value("power") === true;
  const members = (device.members ?? []).flatMap((id) => devices.find((d) => d.id === id) ?? []);
  const actions = device.capabilities.filter((c) => c.type === "action" && !c.readonly);
  const light = has(device, "brightness") || has(device, "color_temp") || has(device, "color");
  const ac = has(device, "target_temp") || has(device, "ac_mode") || has(device, "fan_speed");
  const tv = has(device, "volume") || has(device, "source");

  return (
    <>
      {has(device, "power") && !inHero && (
        <div className={cn("g-main", power && !disabled && "on")}>
          <div className="g-main-tx">
            <span className="g-main-t">{power ? "Ligado" : "Desligado"}</span>
            <span className="g-main-s num">
              {onCount} de {total} ligados
              {offline > 0 && (
                <>
                  {" · "}
                  <span className="g-main-w">{offline} sem resposta</span>
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            className="sw sw-lg"
            role="switch"
            aria-checked={power}
            aria-busy={ctl.pending("power") || undefined}
            aria-label={`${power ? "Desligar" : "Ligar"} ${device.name}`}
            disabled={disabled}
            onClick={() => void ctl.send("power", !power)}
          />
        </div>
      )}
      {light && <LightBody device={device} ctl={ctl} disabled={disabled} />}
      {ac && <AcBody device={device} ctl={ctl} disabled={disabled} />}
      {/* Com o grupo desligado a TV não responde a volume nem entrada: some, como no detalhe da TV. */}
      {tv && power && <TvBody device={device} ctl={ctl} disabled={disabled} />}
      {actions.length > 0 && (
        <div className="g-acts">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn btn-sec"
              disabled={disabled}
              aria-busy={ctl.pending(a.id) || undefined}
              onClick={() => void ctl.send(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="ctl ctl-m">
        <div className="ctl-h">
          <span className="lbl" id={`mems-${device.id}`}>
            Aparelhos do grupo
          </span>
          <span className="ctl-v num">{members.length}</span>
        </div>
        <ul className="mems" aria-labelledby={`mems-${device.id}`}>
          {members.map((m) => {
            const Icon = kindIcon(m.kind);
            const off = isOffline(m);
            return (
              <li key={m.id}>
                <Link className={cn("mem", off && "is-off")} to={`/aparelho/${m.id}`}>
                  <span className={cn("tile sm", isOn(m) && !off && "fill")}>
                    <Icon className="i" aria-hidden />
                  </span>
                  <span className="mem-tx">
                    <span className="mem-n">{m.name}</span>
                    <span className="mem-s">
                      {off && <WifiOff className="i i-sm" aria-hidden />}
                      {memberText(m)}
                    </span>
                  </span>
                  <ChevronRight className="i i-sm" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
