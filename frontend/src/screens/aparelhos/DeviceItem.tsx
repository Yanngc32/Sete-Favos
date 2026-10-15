// Um aparelho (ou grupo) na lista Dispositivos: DeviceRow do Sete Favos com switch e os controles que abrem no
// próprio card. Os comandos passam pelo useControl do Detalhe (otimista, volta + toast se falhar).
import { Layers } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { useLive } from "@/lib/live";
import { DeviceRow, Swap } from "@/components/favos";
import { cap, groupCounts, isGroup, isOn, kindIcon, stateText } from "@/lib/devices";
import type { Device } from "@/lib/types";
import { noWol } from "@/screens/detalhe/bodies";
import { useControl } from "@/screens/detalhe/useControl";
import { inlineBody, metaText } from "./inline";
import { plural } from "./wizard/model";

export function DeviceItem({ device }: { device: Device }) {
  const ctl = useControl(device);
  const offline = device.online === false;
  // Colmeia fora: nada chega ao aparelho, então os controles travam (igual ao Detalhe).
  const central = useLive().connection !== "online";
  const group = isGroup(device);

  // Retrato com os valores otimistas: a frase do card e o latão acompanham o toque na hora.
  const view = useMemo<Device>(() => {
    const keys = new Set([...Object.keys(device.state), ...device.capabilities.map((c) => c.id)]);
    const state: Record<string, unknown> = {};
    for (const k of keys) state[k] = ctl.value(k);
    return { ...device, state };
  }, [device, ctl]);

  const power = cap(device, "power");
  const on = view.state.power === true;
  const tvLocked = device.kind === "tv" && !on && !!noWol(device);
  const hasSwitch = !!power && !power.readonly && device.kind !== "vacuum" && device.kind !== "phone";

  let meta: string;
  if (offline) meta = "Sem resposta";
  else if (group) {
    const { total, offline: off } = groupCounts(device);
    const parts = [plural(total, "aparelho", "aparelhos"), stateText(view)];
    if (off > 0) parts.push(`${off} sem resposta`);
    meta = parts.filter(Boolean).join(" · ");
  } else meta = metaText(view, stateText(view)) || device.vendor_label;

  const verb = on ? "Desligar" : "Ligar";
  const location = useLocation();
  return (
    <DeviceRow
      className={group ? "is-group" : undefined}
      icon={group ? Layers : kindIcon(device.kind)}
      title={device.name}
      meta={<Swap value={meta} />}
      on={!offline && isOn(view)}
      offline={offline}
      to={`/aparelho/${device.id}`}
      toState={{ back: location.pathname + location.search }}
      switch={
        hasSwitch
          ? {
              checked: on,
              onChange: (next) => void ctl.send("power", next),
              label: `${verb} ${device.name}`,
              busy: ctl.pending("power"),
              disabled: offline || central || tvLocked,
            }
          : undefined
      }
      expandLabel={`controles de ${device.name}`}
    >
      {inlineBody({ device, ctl, disabled: offline || central })}
    </DeviceRow>
  );
}
