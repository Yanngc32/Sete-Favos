"""Popula uma central SIMULADA com a casa de exemplo do plano (aparelhos, rotinas, automações).

    CASA_SIMULAR=1 CASA_DATA_DIR=.demo uv run casa      # em outro terminal
    uv run casa-demo [--url http://127.0.0.1:38471]

Usa só a API pública, pelo localhost (= o PC). Recusa rodar se a central não estiver em modo simulado.
"""

from __future__ import annotations

import argparse
import time
from typing import Any

import httpx

ROOMS = {"sim-luz-sala": "Sala", "sim-tv-sala": "Sala", "sim-robo": "Sala", "sim-fita-quarto": "Quarto",
         "sim-ar-quarto": "Quarto", "sim-cafeteira": "Cozinha",
         "sim-interruptor": "Corredor"}
WEEKDAYS = [0, 1, 2, 3, 4]


def main() -> None:
    parser = argparse.ArgumentParser(description="Casa de exemplo numa colmeia simulada.")
    parser.add_argument("--url", default="http://127.0.0.1:38471")
    args = parser.parse_args()
    api = httpx.Client(base_url=f"{args.url}/api", timeout=20)

    def call(method: str, path: str, body: Any = None) -> Any:
        r = api.request(method, path, json=body)
        r.raise_for_status()
        return r.json() if r.content else None

    if not any(v["vendor"] == "simulado" for v in call("GET", "/vendors")):
        raise SystemExit("A colmeia não está em modo simulado (CASA_SIMULAR=1). Nada foi feito.")
    if call("GET", "/devices"):
        raise SystemExit("A colmeia já tem aparelhos. Use um CASA_DATA_DIR novo.")

    job = call("POST", "/vendors/simulado/discover", {"credentials": {}})
    while not (job := call("GET", f"/discovery/{job['id']}"))["done"]:
        time.sleep(0.3)
    ids: dict[str, str] = {}
    for cand in job["candidates"]:
        if cand["needs_pairing"]:
            call("POST", f"/discovery/{job['id']}/candidates/{cand['key']}/pair")
        dev = call("POST", f"/discovery/{job['id']}/candidates/{cand['key']}/add",
                   {"name": cand["name"], "room": ROOMS.get(cand["key"]), "kind": cand["kind"]})
        ids[cand["key"]] = dev["id"]
    call("POST", "/rooms", {"name": "Escritório"})

    visita = call("POST", "/virtuals", {"name": "Modo visita", "pinned": True})["id"]
    dormindo = call("POST", "/virtuals", {"name": "Dormindo", "pinned": True})["id"]
    call("POST", "/virtuals", {"name": "Férias"})

    def dev(key: str, capability: str, value: Any = None) -> dict[str, Any]:
        action = {"type": "device", "device_id": ids[key], "capability": capability}
        return action if value is None else {**action, "value": value}

    def devs(key: str, **values: Any) -> dict[str, Any]:
        """Vários ajustes do mesmo aparelho numa ação só."""
        return {"type": "device", "device_id": ids[key], "values": values}

    call("POST", "/routines", {"name": "Sair de casa", "pinned": True, "actions": [
        dev("sim-luz-sala", "power", False), dev("sim-fita-quarto", "power", False),
        dev("sim-tv-sala", "power", False), dev("sim-ar-quarto", "power", False), dev("sim-robo", "start")]})
    call("POST", "/routines", {"name": "Dormir", "pinned": True, "actions": [
        dev("sim-luz-sala", "power", False), devs("sim-fita-quarto", brightness=10, color_temp=0),
        devs("sim-ar-quarto", power=True, target_temp=23, ac_mode="cool", fan_speed="low"),
        {"type": "virtual", "virtual_id": dormindo, "value": True}]})
    call("POST", "/routines", {"name": "Cinema", "pinned": True, "actions": [
        dev("sim-luz-sala", "brightness", 15), dev("sim-tv-sala", "source", "HDMI_1")]})

    call("POST", "/automations", {
        "name": "Ar antes de dormir", "enabled": True,
        "trigger": {"type": "time", "at": "22:30", "days": list(range(7))},
        "conditions": [{"type": "virtual_is", "virtual_id": dormindo, "value": False}],
        "actions": [devs("sim-ar-quarto", target_temp=23, ac_mode="cool")]})
    call("POST", "/automations", {
        "name": "Robô quando sair", "enabled": False,
        "trigger": {"type": "virtual", "virtual_id": visita, "to": False},
        "conditions": [{"type": "weekday", "days": WEEKDAYS},
                       {"type": "time_between", "start": "09:00", "end": "17:00"}],
        "actions": [dev("sim-robo", "start")]})
    call("POST", "/automations", {
        "name": "Cafeteira de manhã", "enabled": True,
        "trigger": {"type": "time", "at": "06:50", "days": WEEKDAYS},
        "conditions": [],
        "actions": [dev("sim-cafeteira", "power", True), {"type": "delay", "minutes": 40},
                    dev("sim-cafeteira", "power", False)]})
    print(f"Casa de exemplo pronta: {len(ids)} aparelhos, 3 objetos virtuais, 3 rotinas, 3 automações.")


if __name__ == "__main__":
    main()
