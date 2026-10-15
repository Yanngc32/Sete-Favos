// Dispositivos (Sete Favos · mock exploracao-favos, telas 3, 6 e 7): bloco mel com título, resumo ao vivo, busca e
// pílulas de cômodo; no painel, os grupos e os aparelhos por cômodo. A seta de cada card abre os controles ali
// mesmo; o nome abre o Detalhe. Busca e cômodo ficam na URL (?q=&comodo=) pra sobreviver à ida ao Detalhe.
import { Layers, Plus, PlugZap, SearchX } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { FilterPills, HexTile, HoneyPage, HoneySearch, Swap, type PillOption } from "@/components/favos";
import { devicesByRoom, isGroup, isOn, KIND_LABEL, NO_ROOM } from "@/lib/devices";
import { useLive } from "@/lib/live";
import type { Device } from "@/lib/types";
import { openGroupDialog } from "@/screens/grupos/groupDialog";
import { DeviceItem } from "./DeviceItem";
import { plural, vendorShort } from "./wizard/model";
import "./dispositivos.css";

const ALL = "todos";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

function matches(d: Device, q: string): boolean {
  if (!q) return true;
  const hay = [d.name, d.room ?? NO_ROOM, d.vendor_label, vendorShort(d.vendor_label), d.ip ?? "", d.model ?? "", KIND_LABEL[d.kind] ?? ""];
  return hay.some((h) => norm(h).includes(q));
}

export function Aparelhos() {
  const { devices: all, loaded } = useLive();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const roomParam = params.get("comodo") ?? ALL;

  const set = (key: string, value: string, empty: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value === empty) n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );

  // Grupo não é um aparelho: fica numa seção própria no topo (e não entra nas contagens de aparelho).
  const devices = useMemo(() => all.filter((d) => !isGroup(d)), [all]);
  const groups = useMemo(() => all.filter(isGroup).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [all]);
  const byRoom = useMemo(() => devicesByRoom(devices), [devices]);

  // Cômodo que sumiu (último aparelho saiu dele): volta pra Todos.
  const room = roomParam === ALL || byRoom.some(([r]) => r === roomParam) ? roomParam : ALL;
  const nq = norm(q.trim());

  const pills: PillOption[] = [
    { value: ALL, label: "Todos", count: devices.length },
    ...byRoom.map(([r, list]) => ({ value: r, label: r, count: list.length })),
  ];

  const inRoom = (d: Device) => room === ALL || (d.room ?? NO_ROOM) === room;
  const sections = byRoom
    .filter(([r]) => room === ALL || r === room)
    .map(([r, list]) => [r, list.filter((d) => matches(d, nq))] as const)
    .filter(([, list]) => list.length > 0);
  const groupList = groups.filter((g) => inRoom(g) && matches(g, nq));

  const scope = devices.filter(inRoom);
  const lit = scope.filter((d) => d.online !== false && isOn(d)).length;
  const nothing = loaded && devices.length === 0 && groups.length === 0;
  const noHits = loaded && !nothing && sections.length === 0 && groupList.length === 0;

  return (
    <HoneyPage
      className="apl"
      title="Dispositivos"
      liveSubtitle
      subtitle={
        loaded && devices.length > 0 ? (
          <>
            {room !== ALL && <>{room} · </>}
            <Swap value={scope.length}>{plural(scope.length, "aparelho", "aparelhos")}</Swap>
            {" · "}
            <Swap value={lit}>{lit === 1 ? "1 ligado" : `${lit} ligados`}</Swap>
          </>
        ) : loaded ? (
          "Nenhum aparelho ainda"
        ) : (
          <span className="apl-sk-s">Carregando…</span>
        )
      }
      actions={
        <>
          {loaded && devices.length >= 2 && (
            <button type="button" className="ibtn bd" data-group-opener aria-label="Novo grupo" title="Novo grupo" onClick={() => openGroupDialog()}>
              <Layers className="i" aria-hidden />
            </button>
          )}
          <Link className="ibtn bd" to="/dispositivos/novo" aria-label="Adicionar aparelho" title="Adicionar aparelho">
            <Plus className="i" aria-hidden />
          </Link>
        </>
      }
      headerContent={
        !nothing && (
          <>
            <HoneySearch
              label="Buscar aparelho"
              placeholder="Buscar aparelho"
              value={q}
              onChange={(e) => set("q", e.target.value, "")}
              onKeyDown={(e) => e.key === "Escape" && q && (e.preventDefault(), set("q", "", ""))}
            />
            {loaded && byRoom.length > 1 && (
              <FilterPills label="Filtrar por cômodo" value={room} onChange={(v) => set("comodo", v, ALL)} options={pills} />
            )}
          </>
        )
      }
      bodyClassName="apl-b"
    >
      {!loaded ? (
        <div className="apl-g" aria-busy="true" aria-label="Carregando aparelhos">
          <span className="sk apl-sk-h" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="apl-sk">
              <span className="sk apl-sk-hx" />
              <span className="apl-sk-tx">
                <span className="sk" style={{ width: `${48 - i * 6}%` }} />
                <span className="sk" style={{ width: `${30 - i * 3}%` }} />
              </span>
              <span className="sk apl-sk-sw" />
            </div>
          ))}
        </div>
      ) : nothing ? (
        <div className="apl-empty">
          <HexTile icon={PlugZap} variant="soft" size="xl" />
          <h2>Nenhum aparelho ainda</h2>
          <p>Adicione as luzes, tomadas, o ar, a TV e o robô pra controlar tudo daqui.</p>
          <Link className="btn btn-ico" to="/dispositivos/novo">
            <Plus className="i" aria-hidden />
            Adicionar aparelho
          </Link>
        </div>
      ) : noHits ? (
        <div className="apl-empty" role="status">
          <HexTile icon={SearchX} size="xl" />
          <h2>Nada encontrado</h2>
          <p>
            {q ? <>Nenhum aparelho com “{q.trim()}”{room !== ALL && <> em {room}</>}.</> : <>Nada em {room}.</>}
          </p>
          <button type="button" className="btn btn-sec" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Limpar busca e filtro
          </button>
        </div>
      ) : (
        <>
          {groupList.length > 0 && (
            <section className="apl-g" aria-labelledby="apl-grupos">
              <div className="apl-h">
                <h2 id="apl-grupos">
                  Grupos <span className="cnt">{groupList.length}</span>
                </h2>
              </div>
              {groupList.map((g) => (
                <DeviceItem key={g.id} device={g} />
              ))}
            </section>
          )}
          {sections.map(([r, list], i) => (
            <section key={r} className="apl-g" aria-labelledby={`apl-r-${i}`}>
              <div className="apl-h">
                <h2 id={`apl-r-${i}`}>
                  {r} <span className="cnt">{list.length}</span>
                </h2>
              </div>
              {list.map((d) => (
                <DeviceItem key={d.id} device={d} />
              ))}
            </section>
          ))}
        </>
      )}
    </HoneyPage>
  );
}
