"""API HTTP + WebSocket e entrega do front já compilado."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import mimetypes
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import date
from pathlib import PurePath
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from casa import __version__
from casa import access as acc
from casa import engine as eng
from casa import hub as hub_mod
from casa import onboarding as onb
from casa.access import Access, AccessMiddleware, HostNames, PairingError, Principal, public_view
from casa.adapters import build_adapters
from casa.adapters.base import Adapter, AdapterError
from casa.dashboard import DashboardConflict, Dashboards, DashView
from casa.engine import Engine, EngineError
from casa.events import EventBus
from casa.home import Home, home_view, load_home, save_home
from casa.hub import CommandError, Hub
from casa.model import CardKeyError, CardPrefs, Kind
from casa.net import lan_ipv4s, tailnet_ipv4
from casa.onboarding import Onboarding
from casa.settings import Settings
from casa.store import Store
from casa.updater import Updater
from casa.vault import Vault
from casa.weather import Weather

log = logging.getLogger(__name__)

WS_PING_EVERY = 25.0
WS_MAX_PER_CLIENT = 8


@dataclass
class Ctx:
    settings: Settings
    store: Store
    vault: Vault
    bus: EventBus
    hub: Hub
    engine: Engine
    access: Access
    hosts: HostNames
    onboarding: Onboarding
    dashboard: Dashboards
    updater: Updater
    weather: Weather = field(default_factory=Weather)
    ws_open: dict[str, int] = field(default_factory=dict)


def ctx(request: Request) -> Ctx:
    return request.app.state.ctx


def principal(request: Request) -> Principal:
    return request.scope["state"]["principal"]


def pc_only(request: Request) -> Principal:
    p: Principal | None = request.scope["state"].get("principal")
    if p is None or not p.is_pc:
        raise _Forbidden()
    return p


class _Forbidden(Exception):
    pass


# Corpos de requisição -----------------------------------------------------------


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    room: str | None = None
    clear_room: bool = False
    pinned: bool | None = None
    kind: Kind | None = None
    # Nome de cada tecla de um interruptor: {"switch_1": "Luz da entrada"}; "" volta ao padrão.
    labels: dict[str, str] | None = Field(default=None, max_length=6)
    # Aparência do card: {"size": "s"|"m"|"l", "show": {"level", "room", "status", "quick"}}. Substitui a inteira.
    card: CardPrefs | None = None
    clear_card: bool = False  # "Voltar ao padrão"


class PhoneReport(BaseModel):
    battery: int = Field(ge=0, le=100)
    charging: bool
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)


class RemoteBody(BaseModel):
    key: str = Field(max_length=20)


class TimerBody(BaseModel):
    # None cancela; até 12 h.
    minutes: int | None = Field(default=None, ge=1, le=720)


class TokenBody(BaseModel):
    token: str = Field(max_length=300)


class CommandBody(BaseModel):
    capability: str
    value: Any = None


class RoomBody(BaseModel):
    name: str


class AccountBody(BaseModel):
    values: dict[str, str]


class ManualBody(BaseModel):
    ip: str
    device_id: str | None = None
    secret: str | None = None


class DiscoverBody(BaseModel):
    credentials: dict[str, str] = Field(default_factory=dict)


class AddBody(BaseModel):
    name: str
    room: str | None = None
    kind: Kind


class PinnedBody(BaseModel):
    pinned: bool


class EnabledBody(BaseModel):
    enabled: bool


class ValueBody(BaseModel):
    value: bool


class TestBody(BaseModel):
    actions: list[dict[str, Any]] = Field(min_length=1)


class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    room: str | None = Field(default=None, max_length=60)
    members: list[str] = Field(max_length=20)


class GroupMembersBody(BaseModel):
    members: list[str] = Field(max_length=20)


class DashboardBody(BaseModel):
    views: list[DashView] = Field(max_length=10)
    expected_rev: int = Field(ge=0)


class PairBody(BaseModel):
    code: str = Field(max_length=16)
    name: str | None = Field(default=None, max_length=80)


class NameBody(BaseModel):
    name: str


# Rotas ------------------------------------------------------------------------

api = APIRouter(prefix="/api")


@api.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True}


@api.get("/version")
async def get_version() -> dict[str, Any]:
    return {"version": __version__}


@api.get("/home")
async def get_home(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return home_view(load_home(c.store), date.today())


# Modo simulado (demo/testes) não sai pra internet: devolve um clima fixo.
_SIM_WEATHER: dict[str, Any] = {
    "available": True, "temp_c": 19, "humidity": 72, "wind_kmh": 12, "visibility_km": 8,
    "condition": "Nublado", "icon": "cloud", "is_day": False, "time": None,
}


@api.get("/weather")
async def get_weather(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    if c.settings.simulate:
        return _SIM_WEATHER
    return await c.weather.current(load_home(c.store))


@api.put("/home", dependencies=[Depends(pc_only)])
async def put_home(body: Home, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    save_home(c.store, body)
    return home_view(body, date.today())


@api.post("/phone/report")
async def phone_report(body: PhoneReport, request: Request, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    """O app Android manda bateria/carregando/local; vira o aparelho "Celular" deste acesso."""
    p = principal(request)
    if p.is_pc or p.device is None:
        raise ValueError("Só o app do celular (pareado) envia estes dados.")
    view = await c.hub.phone_report(p.device.id, p.device.name, body.model_dump(), load_home(c.store))
    return view.model_dump()


@api.get("/app")
async def android_app(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    """APK servido pela própria central (vem no instalador, mesma versão da central)."""
    root = c.settings.frontend_dir
    available = bool(root and (root / "app" / "central.apk").is_file())
    return {"available": available, "version": __version__ if available else None, "url": "/app/central.apk"}


@api.get("/update")
async def update_status(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.updater.view()


@api.post("/update/check")
async def update_check(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    # Em segundo plano: baixar e conferir o instalador leva alguns segundos; a tela acompanha pelo GET.
    if c.updater.status.state not in ("verificando", "baixando", "instalando"):
        c.updater.status.state = "verificando"
        _background(c.updater.check(), "update-check")
    return c.updater.view()


@api.put("/update/token", dependencies=[Depends(pc_only)])
async def update_token(body: TokenBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    await c.updater.set_token(body.token)
    _background(c.updater.check(), "update-check")
    return c.updater.view()


@api.delete("/update/token", dependencies=[Depends(pc_only)])
async def update_token_clear(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    c.updater.clear_token()
    return c.updater.view()


_tasks: set[asyncio.Task[Any]] = set()


def _background(coro: Any, name: str) -> None:
    task = asyncio.create_task(coro, name=name)
    _tasks.add(task)  # sem referência o asyncio pode coletar a tarefa no meio
    task.add_done_callback(_tasks.discard)


@api.get("/session")
async def session(request: Request) -> dict[str, Any]:
    p: Principal | None = request.scope["state"].get("principal")
    if p is None:
        return {"access": "none"}
    if p.is_pc:
        return {"access": "pc"}
    assert p.device
    return {"access": "device", "device": public_view(p.device)}


@api.get("/state")
async def full_state(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return _snapshot(c)


# Aparelhos


@api.get("/devices")
async def list_devices(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return [v.model_dump() for v in c.hub.views()]


@api.get("/devices/{device_id}")
async def get_device(device_id: str, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.view(device_id).model_dump()


@api.patch("/devices/{device_id}")
async def patch_device(device_id: str, body: DevicePatch, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.update_device(
        device_id, name=body.name, room=body.room, pinned=body.pinned, clear_room=body.clear_room, kind=body.kind,
        labels=body.labels, card=body.card, clear_card=body.clear_card,
    ).model_dump()


@api.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: str, c: Ctx = Depends(ctx)) -> Response:
    await c.hub.remove_device(device_id)
    return Response(status_code=204)


@api.post("/devices/{device_id}/command")
async def command(device_id: str, body: CommandBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return (await c.hub.command(device_id, body.capability, body.value)).model_dump()


@api.post("/devices/{device_id}/remote", status_code=204)
async def device_remote(device_id: str, body: RemoteBody, c: Ctx = Depends(ctx)) -> Response:
    await c.hub.remote(device_id, body.key)
    return Response(status_code=204)


@api.put("/devices/{device_id}/timer")
async def device_timer(device_id: str, body: TimerBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.set_timer(device_id, body.minutes).model_dump()


@api.post("/devices/{device_id}/test", status_code=204)
async def test_device(device_id: str, c: Ctx = Depends(ctx)) -> Response:
    await c.hub.test(device_id)
    return Response(status_code=204)


# Grupos de aparelhos (renomear, mudar de cômodo, fixar e desfazer usam as rotas de /devices).


@api.post("/groups", status_code=201)
async def create_group(body: GroupBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.create_group(name=body.name, room=body.room, members=body.members).model_dump()


@api.post("/groups/preview")
async def preview_group(body: GroupMembersBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.preview_group(body.members)


@api.put("/groups/{group_id}/members")
async def set_group_members(group_id: str, body: GroupMembersBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.hub.set_group_members(group_id, body.members).model_dump()


# Painel personalizável da Início (um só, igual em todos os aparelhos)


@api.get("/dashboard")
async def get_dashboard(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.dashboard.get()


@api.put("/dashboard")
async def put_dashboard(body: DashboardBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.dashboard.save(body.views, body.expected_rev)


@api.delete("/dashboard")
async def reset_dashboard(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.dashboard.reset()


@api.get("/rooms")
async def rooms(c: Ctx = Depends(ctx)) -> list[str]:
    return c.hub.rooms()


@api.post("/rooms")
async def add_room(body: RoomBody, c: Ctx = Depends(ctx)) -> list[str]:
    return c.hub.add_room(body.name)


# Fabricantes / cadastro


@api.get("/vendors")
async def vendors(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return c.onboarding.vendors()


@api.put("/vendors/{vendor}/account", status_code=204, dependencies=[Depends(pc_only)])
async def save_account(vendor: str, body: AccountBody, c: Ctx = Depends(ctx)) -> Response:
    await c.onboarding.save_account(vendor, body.values)
    return Response(status_code=204)


@api.delete("/vendors/{vendor}/account", status_code=204, dependencies=[Depends(pc_only)])
async def clear_account(vendor: str, c: Ctx = Depends(ctx)) -> Response:
    c.onboarding.clear_account(vendor)
    return Response(status_code=204)


@api.post("/vendors/{vendor}/discover")
async def discover(vendor: str, body: DiscoverBody | None = None, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.onboarding.start_discovery(vendor, body.credentials if body else None)


@api.post("/vendors/{vendor}/manual")
async def manual(vendor: str, body: ManualBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return await c.onboarding.manual(vendor, body.ip, body.device_id, body.secret)


@api.get("/discovery/{job_id}")
async def discovery(job_id: str, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.onboarding.job(job_id)


@api.post("/discovery/{job_id}/candidates/{key}/pair")
async def pair_candidate(job_id: str, key: str, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return await c.onboarding.pair(job_id, key)


@api.post("/discovery/{job_id}/candidates/{key}/add")
async def add_candidate(job_id: str, key: str, body: AddBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    view = await c.onboarding.add(job_id, key, name=body.name, room=body.room, kind=body.kind)
    return view.model_dump()


# Rotinas


@api.get("/routines")
async def list_routines(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return [r.model_dump(mode="json") for r in c.engine.routines.values()]


@api.post("/routines")
async def create_routine(body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.save_routine(body).model_dump(mode="json")


@api.put("/routines/{routine_id}")
async def update_routine(routine_id: str, body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.save_routine(body, routine_id).model_dump(mode="json")


@api.patch("/routines/{routine_id}")
async def pin_routine(routine_id: str, body: PinnedBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.set_routine_pinned(routine_id, body.pinned).model_dump(mode="json")


@api.delete("/routines/{routine_id}", status_code=204)
async def delete_routine(routine_id: str, c: Ctx = Depends(ctx)) -> Response:
    c.engine.delete_routine(routine_id)
    return Response(status_code=204)


@api.post("/routines/{routine_id}/run")
async def run_routine(routine_id: str, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return (await c.engine.run_routine(routine_id)).model_dump(mode="json")


@api.post("/runs/{run_id}/undo")
async def undo_run(run_id: str, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return (await c.engine.undo(run_id)).model_dump(mode="json")


# Automações


@api.get("/automations")
async def list_automations(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return [a.model_dump(mode="json") for a in c.engine.automations.values()]


@api.post("/automations")
async def create_automation(body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.save_automation(body).model_dump(mode="json")


@api.put("/automations/{automation_id}")
async def update_automation(
    automation_id: str, body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)
) -> dict[str, Any]:
    return c.engine.save_automation(body, automation_id).model_dump(mode="json")


@api.patch("/automations/{automation_id}")
async def enable_automation(automation_id: str, body: EnabledBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.set_enabled(automation_id, body.enabled).model_dump(mode="json")


@api.delete("/automations/{automation_id}", status_code=204)
async def delete_automation(automation_id: str, c: Ctx = Depends(ctx)) -> Response:
    c.engine.delete_automation(automation_id)
    return Response(status_code=204)


@api.post("/actions/test")
async def test_actions(body: TestBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return (await c.engine.test_actions(body.actions)).model_dump(mode="json")


# Objetos virtuais


@api.get("/virtuals")
async def list_virtuals(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return [c.engine.virtual_view(v) for v in c.engine.virtuals.values()]


@api.post("/virtuals")
async def create_virtual(body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.virtual_view(c.engine.save_virtual(body))


@api.put("/virtuals/{virtual_id}")
async def update_virtual(virtual_id: str, body: dict[str, Any] = Body(...), c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.virtual_view(c.engine.save_virtual(body, virtual_id))


@api.post("/virtuals/{virtual_id}/value")
async def set_virtual(virtual_id: str, body: ValueBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.engine.virtual_view(c.engine.set_virtual(virtual_id, body.value))


@api.delete("/virtuals/{virtual_id}", status_code=204)
async def delete_virtual(virtual_id: str, c: Ctx = Depends(ctx)) -> Response:
    c.engine.delete_virtual(virtual_id)
    return Response(status_code=204)


# Acesso (gestão só no PC)


@api.post("/access/pair")
async def pair(body: PairBody, request: Request, response: Response, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    device, token = c.access.pair(body.code, body.name)
    response.set_cookie(
        acc.COOKIE, token, max_age=acc.COOKIE_MAX_AGE, httponly=True, samesite="strict",
        secure=request.url.scheme == "https", path="/",
    )
    return {"device": public_view(device)}


@api.get("/access/devices", dependencies=[Depends(pc_only)])
async def access_devices(c: Ctx = Depends(ctx)) -> list[dict[str, Any]]:
    return [public_view(d) for d in sorted(c.access.devices.values(), key=lambda d: d.created_at)]


@api.patch("/access/devices/{device_id}", dependencies=[Depends(pc_only)])
async def rename_access_device(device_id: str, body: NameBody, c: Ctx = Depends(ctx)) -> dict[str, Any]:
    if device_id not in c.access.devices:
        raise hub_mod.NotFound(device_id)
    return public_view(c.access.rename(device_id, body.name))


@api.delete("/access/devices/{device_id}", status_code=204, dependencies=[Depends(pc_only)])
async def revoke_access_device(device_id: str, c: Ctx = Depends(ctx)) -> Response:
    if device_id not in c.access.devices:
        raise hub_mod.NotFound(device_id)
    c.access.revoke(device_id)
    return Response(status_code=204)


@api.post("/access/pairing", dependencies=[Depends(pc_only)])
async def start_pairing(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    urls = await asyncio.to_thread(panel_urls, c)
    return {**c.access.start_pairing(), "urls": urls}


@api.get("/access/pairing", dependencies=[Depends(pc_only)])
async def pairing_status(c: Ctx = Depends(ctx)) -> dict[str, Any]:
    return c.access.pairing_status()


@api.delete("/access/pairing", status_code=204, dependencies=[Depends(pc_only)])
async def cancel_pairing(c: Ctx = Depends(ctx)) -> Response:
    c.access.cancel_pairing()
    return Response(status_code=204)


# WebSocket


@api.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    c: Ctx = ws.app.state.ctx
    who: Principal = ws.scope["state"]["principal"]
    key = who.device.id if who.device else "pc"
    if c.ws_open.get(key, 0) >= WS_MAX_PER_CLIENT:
        await ws.close(code=1013)
        return
    await ws.accept()
    c.ws_open[key] = c.ws_open.get(key, 0) + 1
    sub = c.bus.subscribe()

    def revoked() -> bool:
        return who.device is not None and who.device.id not in c.access.devices

    async def sender() -> None:
        # Revogado entre o middleware e o subscribe: nenhum evento chegaria pra avisar.
        if revoked():
            await ws.close(code=4401)
            return
        await ws.send_json({"t": "snapshot", **_snapshot(c)})
        while True:
            try:
                event = await asyncio.wait_for(sub.queue.get(), WS_PING_EVERY)
            except TimeoutError:
                if revoked():
                    await ws.close(code=4401)
                    return
                await ws.send_json({"t": "ping"})
                continue
            t = event.get("t")
            if t == "access_revoked":
                if who.device and event["id"] == who.device.id:
                    await ws.close(code=4401)
                    return
                if not who.is_pc:
                    continue
            if event.get("pc_only") and not who.is_pc:
                continue
            await ws.send_json(event)

    async def receiver() -> None:
        while True:
            await ws.receive_text()

    async def overflow() -> None:
        await sub.closed.wait()
        await ws.close(code=1013)

    tasks = [asyncio.create_task(f()) for f in (sender, receiver, overflow)]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                await t
        c.bus.unsubscribe(sub)
        c.ws_open[key] = max(0, c.ws_open.get(key, 1) - 1)


def _snapshot(c: Ctx) -> dict[str, Any]:
    return {
        "devices": [v.model_dump() for v in c.hub.views()],
        "rooms": c.hub.rooms(),
        "virtuals": [c.engine.virtual_view(v) for v in c.engine.virtuals.values()],
        "routines": [r.model_dump(mode="json") for r in c.engine.routines.values()],
        "automations": [a.model_dump(mode="json") for a in c.engine.automations.values()],
    }


def panel_urls(c: Ctx) -> dict[str, str | None]:
    """Endereços do painel para o QR de pareamento: tailnet (funciona dentro e fora) e LAN."""
    port = c.settings.port
    lan_ip = next(iter(lan_ipv4s()), None)
    tail_host = c.hosts.tailnet_name or tailnet_ipv4()
    return {
        "tailnet": f"http://{tail_host}:{port}/parear" if tail_host else None,
        "lan": f"http://{lan_ip}:{port}/parear" if lan_ip else None,
    }


# Montagem ---------------------------------------------------------------------


_ERRORS: list[tuple[type[Exception], int]] = [
    (hub_mod.NotFound, 404), (eng.NotFound, 404), (onb.NotFound, 404),
    (CommandError, 502), (DashboardConflict, 409), (CardKeyError, 422),
    (EngineError, 400), (AdapterError, 400), (PairingError, 400), (ValueError, 400),
]

# O registro de tipos do Windows nem sempre conhece estes (manifest da PWA e ícones).
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/vnd.android.package-archive", ".apk")

_SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def create_app(
    settings: Settings,
    *,
    store: Store | None = None,
    vault: Vault | None = None,
    adapters: dict[str, Adapter] | None = None,
) -> FastAPI:
    store = store or Store(settings.db_path)
    vault = vault or Vault()
    bus = EventBus()
    adapters = adapters if adapters is not None else build_adapters(vault, simulate=settings.simulate)
    hub = Hub(store, vault, bus, adapters)
    engine = Engine(store, hub, bus)
    access = Access(store, bus)
    hosts = HostNames(settings.extra_hosts)
    onboarding = Onboarding(hub, adapters, bus)
    updater = Updater(settings, store, vault)
    context = Ctx(
        settings, store, vault, bus, hub, engine, access, hosts, onboarding, Dashboards(store, bus), updater
    )

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await hosts.refresh()
        hosts_task = asyncio.create_task(hosts.keep_fresh(), name="host-names")
        update_task = asyncio.create_task(updater.run_forever(), name="updater")
        await hub.start()
        await engine.start()
        log.info("central no ar: %d aparelhos, cofre %s", len(hub.ids()), vault.backend_name)
        try:
            yield
        finally:
            hosts_task.cancel()
            update_task.cancel()
            await engine.stop()
            await hub.stop()

    app = FastAPI(title="Sete Favos", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.ctx = context

    for exc_type, status in _ERRORS:
        app.add_exception_handler(exc_type, _error_handler(status))

    async def forbidden(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse({"detail": "so_no_pc"}, status_code=403)

    app.add_exception_handler(_Forbidden, forbidden)

    async def invalid(_: Request, exc: Exception) -> JSONResponse:
        # `detail` sempre texto: o front mostra a mensagem das regras (ValueError dos modelos) como veio.
        errors = exc.errors() if isinstance(exc, RequestValidationError) else []
        first = errors[0] if errors else {}
        message = str(first.get("msg", "Dados inválidos.")).removeprefix("Value error, ")
        return JSONResponse({"detail": message, "code": "invalido"}, status_code=422)

    app.add_exception_handler(RequestValidationError, invalid)

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers.update(_SECURITY_HEADERS)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(api)
    if settings.frontend_dir:
        _mount_frontend(app, settings)
    # Por último = mais externo: roda antes de tudo.
    app.add_middleware(AccessMiddleware, access=access, hosts=hosts)
    return app


def _error_handler(status: int) -> Any:
    async def handler(_: Request, exc: Exception) -> JSONResponse:
        message = getattr(exc, "message", None) or (str(exc) if status != 404 else "nao_encontrado")
        body: dict[str, Any] = {"detail": message}
        if code := getattr(exc, "code", None):
            body["code"] = code
        if data := getattr(exc, "data", None):
            body["data"] = data
        return JSONResponse(body, status_code=status)

    return handler


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    root = settings.frontend_dir
    assert root
    index = root / "index.html"
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise hub_mod.NotFound(path)
        # Nada de caminho que o Windows trate como absoluto/UNC (`\host\share`, `C:x`): resolve()
        # faria I/O de rede síncrono dentro do event loop. Só sobra o fallback do SPA.
        if path and not _unsafe_static_path(path):
            candidate = (root / path).resolve()
            if candidate.is_file() and candidate.is_relative_to(root.resolve()):
                # O service worker e o manifest têm que ser revalidados, senão a PWA fica presa numa versão.
                fresh = path in ("sw.js", "manifest.webmanifest")
                return FileResponse(candidate, headers={"Cache-Control": "no-cache"} if fresh else None)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def _unsafe_static_path(path: str) -> bool:
    return "\\" in path or ":" in path or "\x00" in path or PurePath(path).anchor != "" or ".." in PurePath(path).parts
