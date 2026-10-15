// Vitrine da base Sete Favos (só em dev: /_favos?v=hero|compacta|detalhe). Mostra cada peça nos estados
// principais pra conferir visual e movimento. Não entra no build de produção (rota registrada só em DEV).
import { AirVent, Bell, ChevronLeft, CloudSun, Ellipsis, Lamp, LampCeiling, Plus, Tv } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DeviceRow } from "./DeviceRow";
import { Expandable } from "./Expandable";
import { FilterPills } from "./FilterPills";
import { HexTile } from "./HexTile";
import { HoneySearch } from "./HoneyHeader";
import { HoneyPage } from "./HoneyPage";
import { Swap } from "./Swap";
import "./favos-preview.css";

type Room = "todos" | "sala" | "quarto" | "cozinha";

export function FavosPreview() {
  const [sp] = useSearchParams();
  const v = (sp.get("v") ?? "compacta") as "hero" | "compacta" | "detalhe";
  const [room, setRoom] = useState<Room>("todos");
  const [luz, setLuz] = useState(true);
  const [tv, setTv] = useState(true);
  const [ar, setAr] = useState(false);
  const [vol, setVol] = useState(18);
  const ligados = [luz, tv, ar].filter(Boolean).length;

  const pills = (
    <FilterPills<Room>
      label="Filtrar por cômodo"
      value={room}
      onChange={setRoom}
      options={[
        { value: "todos", label: "Todos", count: 6 },
        { value: "sala", label: "Sala", count: 3 },
        { value: "quarto", label: "Quarto", count: 2 },
        { value: "cozinha", label: "Cozinha", count: 1 },
      ]}
    />
  );

  const header =
    v === "hero"
      ? { variant: "hero" as const, brand: true, title: "Boa noite", subtitle: <><Swap value={ligados} /> ligados · colmeia conectada</>, lift: true }
      : v === "detalhe"
        ? {
            variant: "detalhe" as const,
            title: "Luz da sala",
            leading: (
              <Link className="ibtn bd" to="/_favos" aria-label="Voltar">
                <ChevronLeft className="i" aria-hidden />
              </Link>
            ),
            actions: (
              <button type="button" className="ibtn bd" aria-label="Mais opções">
                <Ellipsis className="i" aria-hidden />
              </button>
            ),
            headerContent: (
              <div className="fvp-lead">
                <span className="fv-s">Sala</span>
                <button type="button" className="sw" role="switch" aria-checked={luz} aria-label="Ligar Luz da sala" onClick={() => setLuz(!luz)} />
                <span className="hero-num fvp-hero">
                  <Swap value={luz ? 70 : 0} />
                  <small>%</small>
                </span>
              </div>
            ),
          }
        : {
            variant: "compacta" as const,
            title: "Dispositivos",
            subtitle: <>6 aparelhos · <Swap value={ligados} /> ligados</>,
            liveSubtitle: true,
            actions: (
              <button type="button" className="ibtn bd" aria-label="Adicionar aparelho">
                <Plus className="i" aria-hidden />
              </button>
            ),
            headerContent: (
              <>
                <HoneySearch label="Buscar aparelho" placeholder="Buscar aparelho" />
                {pills}
              </>
            ),
          };

  return (
    <HoneyPage
      {...header}
      actions={
        v === "hero" ? (
          <button type="button" className="ibtn bd" aria-label="Avisos">
            <Bell className="i" aria-hidden />
          </button>
        ) : (
          header.actions
        )
      }
    >
      {v === "hero" && (
        <section className="fvp-card fv-lift" aria-label="Tempo agora">
          <HexTile icon={CloudSun} />
          <div>
            <b>Nublado</b>
            <span className="muted"> · qua, 14 de out</span>
          </div>
          <span className="hero-num fvp-wx">
            19<small>°C</small>
          </span>
        </section>
      )}

      <h2 className="fvp-h">Sala <span className="muted num">3</span></h2>
      <DeviceRow
        icon={Lamp}
        title="Luz da sala"
        meta={luz ? "Ligada · 70% · laranja" : "Desligada"}
        on={luz}
        to="/_favos?v=detalhe"
        switch={{ checked: luz, onChange: setLuz, label: "Ligar Luz da sala" }}
      >
        <p className="muted">Brilho e cor entram aqui (controles da tela).</p>
      </DeviceRow>
      <DeviceRow
        icon={Tv}
        title="TV da sala"
        meta={tv ? <>Ligada · Netflix · vol <Swap value={vol} /></> : "Desligada"}
        on={tv}
        defaultOpen
        switch={{ checked: tv, onChange: setTv, label: "Ligar TV da sala" }}
      >
        <div className="fvp-step">
          <button type="button" className="btn btn-sec" onClick={() => setVol((x) => Math.max(0, x - 1))}>−</button>
          <span className="hero-num fvp-vol">
            <Swap value={vol} />
            <small>vol</small>
          </span>
          <button type="button" className="btn btn-sec" onClick={() => setVol((x) => x + 1)}>+</button>
        </div>
      </DeviceRow>
      <DeviceRow
        icon={AirVent}
        title="Ar do quarto"
        meta={ar ? "Frio · 22 °C" : "Desligado"}
        on={ar}
        switch={{ checked: ar, onChange: setAr, label: "Ligar Ar do quarto" }}
      />
      <DeviceRow icon={LampCeiling} title="Luz da cozinha" meta="Sem resposta há 3 min" offline switch={{ checked: false, onChange: () => {}, label: "Ligar Luz da cozinha", disabled: true }} />

      <h2 className="fvp-h">Favos</h2>
      <div className="fvp-row">
        <HexTile icon={Lamp} size="sm" />
        <HexTile icon={Lamp} />
        <HexTile icon={Lamp} variant="soft" />
        <HexTile icon={Lamp} variant="on" />
        <HexTile icon={LampCeiling} variant="on" size="xl" label="Luz ligada" />
      </div>

      <h2 className="fvp-h">Pílulas na página</h2>
      <FilterPills
        tone="page"
        mode="tabs"
        label="Tipo"
        value={room}
        onChange={(x) => setRoom(x as Room)}
        options={[
          { value: "todos", label: "Rotinas", count: 3 },
          { value: "sala", label: "Automações", count: 3 },
          { value: "quarto", label: "Objetos", count: 2 },
          { value: "cozinha", label: "Desativado", disabled: true },
        ]}
      />

      <h2 className="fvp-h">Abrir/recolher</h2>
      <div className="fvp-card fvp-exp">
        <Expandable summary={<b>Horários da luz</b>} label="horários da luz">
          <p className="muted">Noite na sala · 18:30 até 23:00</p>
        </Expandable>
      </div>
    </HoneyPage>
  );
}
