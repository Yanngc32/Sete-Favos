"""Diagnóstico da rede de casa: `uv run casa-diag` no PC que fica ligado.

Só escuta e pergunta "quem está aí?" na LAN; não manda comando para aparelho
nenhum. O teste do robô (`--xiaomi-ip/--xiaomi-token`) faz só leituras.
Nada de segredo é impresso nem salvo no relatório.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import platform
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from casa import net

SSDP_LG = (
    b"M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n"
    b"ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n"
)
MIIO_HELLO = bytes.fromhex("21310020" + "ff" * 28)
TUYA_PORTS = (6666, 6667, 7000)


def _print(title: str, lines: list[str]) -> None:
    print(f"\n== {title}")
    for line in lines or ["(nada)"]:
        print(f"   {line}")


def windows_network() -> dict[str, Any]:
    if sys.platform != "win32":
        return {}
    script = (
        "$p = Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory;"
        "$f = Get-NetFirewallProfile | Select-Object Name,Enabled;"
        "@{perfis=@($p); firewall=@($f)} | ConvertTo-Json -Depth 3"
    )
    try:
        out = subprocess.run(  # noqa: S603
            ["powershell", "-NoProfile", "-Command", script],  # noqa: S607
            capture_output=True, text=True, timeout=20, check=False,
        )
        return json.loads(out.stdout or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}


def scan_tuya(seconds: float) -> list[dict[str, Any]]:
    from tinytuya.core.udp_helper import decrypt_udp

    from casa.adapters.tuya import _send_app_discovery

    socks = []
    for port in TUYA_PORTS:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("", port))
        except OSError as exc:
            print(f"   aviso: porta UDP {port} ocupada ({exc}); a colmeia está rodando?")
            s.close()
            continue
        s.setblocking(False)
        socks.append(s)
    found: dict[str, dict[str, Any]] = {}
    end = time.monotonic() + seconds
    next_ask = 0.0
    while time.monotonic() < end and socks:
        # Aparelhos 3.5 só se anunciam quando o "app" pergunta (mesmo pedido que a central faz).
        if time.monotonic() >= next_ask:
            _send_app_discovery()
            next_ask = time.monotonic() + 4
        for s in socks:
            try:
                data, addr = s.recvfrom(4096)
            except (BlockingIOError, OSError):
                continue
            try:
                payload = json.loads(decrypt_udp(data))
            except Exception:  # noqa: BLE001, S112 - pacote de outro aparelho
                continue
            dev_id = payload.get("gwId") or payload.get("devId")
            if dev_id and dev_id not in found:
                found[dev_id] = {"id": dev_id, "ip": payload.get("ip") or addr[0],
                                 "versao": payload.get("version"), "produto": payload.get("productKey")}
        time.sleep(0.05)
    for s in socks:
        s.close()
    return list(found.values())


async def scan_midea(seconds: float) -> list[dict[str, Any]]:
    from msmart.discover import Discover

    devices = await Discover.discover(timeout=seconds, auto_connect=False)
    return [
        {"id": d.id, "ip": d.ip, "tipo": hex(int(d.type)) if d.type is not None else None,
         "versao": getattr(d, "version", None), "nome": getattr(d, "name", None)}
        for d in devices
    ]


def scan_lg(seconds: float) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for local in net.lan_ipv4s():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        try:
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(local))
            s.bind((local, 0))
            s.settimeout(0.5)
            for _ in range(2):
                s.sendto(SSDP_LG, ("239.255.255.250", 1900))
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                try:
                    data, addr = s.recvfrom(4096)
                except TimeoutError:
                    continue
                headers = {
                    k.strip().upper(): v.strip()
                    for k, _, v in (ln.partition(":") for ln in data.decode(errors="replace").split("\r\n"))
                    if v
                }
                found.setdefault(addr[0], {"ip": addr[0], "servidor": headers.get("SERVER")})
        except OSError as exc:
            print(f"   aviso: SSDP pela placa {local} falhou ({exc})")
        finally:
            s.close()
    return list(found.values())


def scan_miio(seconds: float) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for local in net.lan_ipv4s():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.bind((local, 0))
            s.settimeout(0.5)
            for _ in range(3):
                s.sendto(MIIO_HELLO, ("255.255.255.255", 54321))
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                try:
                    data, addr = s.recvfrom(1024)
                except TimeoutError:
                    continue
                if len(data) >= 16 and data[:2] == b"\x21\x31":
                    found.setdefault(addr[0], {"ip": addr[0], "did": int.from_bytes(data[8:12], "big")})
        except OSError as exc:
            print(f"   aviso: hello miIO pela placa {local} falhou ({exc})")
        finally:
            s.close()
    return list(found.values())


def probe_xiaomi(ip: str, token: str) -> dict[str, Any]:
    """Só leitura: info do miIO + status (siid 2) e bateria (siid 3) pelo MIoT."""
    from miio import Device

    dev = Device(ip, token, timeout=5)
    out: dict[str, Any] = {}
    try:
        info = dev.info()
        out["modelo"] = info.model
        out["firmware"] = info.firmware_version
    except Exception as exc:  # noqa: BLE001
        out["erro_info"] = f"{type(exc).__name__}: {exc}"
        return out
    try:
        props = dev.send("get_properties", [
            {"did": "status", "siid": 2, "piid": 1},
            {"did": "bateria", "siid": 3, "piid": 1},
        ])
        out["miot"] = [{"did": p.get("did"), "code": p.get("code"), "value": p.get("value")} for p in props]
    except Exception as exc:  # noqa: BLE001
        out["erro_miot"] = f"{type(exc).__name__}: {exc}"
    out["controle_local"] = "erro_miot" not in out and all(p["code"] == 0 for p in out.get("miot", []))
    return out


def probe_xiaomi_account(username: str) -> list[dict[str, Any]]:
    """Busca os aparelhos na conta Mi (token só em memória) e testa a leitura local dos robôs."""
    import getpass

    from casa.adapters.base import AdapterError
    from casa.adapters.xiaomi import _cloud_devices

    password = getpass.getpass("Senha da conta Mi (não é salva): ")
    try:
        devices = _cloud_devices(username, password, "auto")
    except AdapterError as exc:
        return [{"erro": exc.message, **({"abrir": exc.data["url"]} if exc.data.get("url") else {})}]
    finally:
        del password
    out = []
    for d in devices:
        model = str(d.get("model") or "")
        if "vacuum" not in model and "robot" not in model:
            continue
        row: dict[str, Any] = {"nome": d.get("name"), "modelo": model, "ip": d.get("localip")}
        if d.get("localip") and d.get("token"):
            row.update(probe_xiaomi(d["localip"], d["token"]))
        out.append(row)
    return out or [{"aviso": f"{len(devices)} aparelhos na conta, nenhum robô aspirador"}]


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnóstico da rede de casa (só leitura).")
    parser.add_argument("--segundos", type=float, default=12, help="tempo ouvindo a Tuya (padrão 12)")
    parser.add_argument("--xiaomi-ip")
    parser.add_argument("--xiaomi-token", help="token de 32 caracteres do robô (não é salvo)")
    parser.add_argument("--xiaomi-conta", help="e-mail/telefone da conta Mi: busca o token na nuvem (a senha é "
                        "pedida na hora e não é salva) e testa a leitura local de cada robô")
    parser.add_argument("--saida", type=Path, default=Path("diagnostico.json"))
    args = parser.parse_args()

    report: dict[str, Any] = {
        "python": sys.version.split()[0],
        "sistema": platform.platform(),
        "ips_lan": net.lan_ipv4s(),
        "ip_tailscale": net.tailnet_ipv4(),
    }
    try:
        from casa.vault import Vault
        report["cofre"] = Vault().backend_name
    except Exception as exc:  # noqa: BLE001
        report["cofre"] = f"ERRO {exc}"
    report["windows"] = windows_network()
    _print("PC", [f"{k}: {v}" for k, v in report.items() if k != "windows"])
    if report["windows"]:
        _print("Windows", [json.dumps(report["windows"], ensure_ascii=False)])

    print(f"\nOuvindo anúncios Tuya/Positivo por {args.segundos:.0f} s…")
    report["tuya"] = scan_tuya(args.segundos)
    _print("Tuya / Positivo", [json.dumps(d, ensure_ascii=False) for d in report["tuya"]])

    try:
        report["midea"] = asyncio.run(scan_midea(6))
    except Exception as exc:  # noqa: BLE001
        report["midea"] = [{"erro": f"{type(exc).__name__}: {exc}"}]
    _print("Midea", [json.dumps(d, ensure_ascii=False) for d in report["midea"]])

    report["lg"] = scan_lg(4)
    _print("LG webOS", [json.dumps(d, ensure_ascii=False) for d in report["lg"]])

    report["xiaomi"] = scan_miio(4)
    _print("Xiaomi (miIO)", [json.dumps(d, ensure_ascii=False) for d in report["xiaomi"]])

    if args.xiaomi_ip and args.xiaomi_token:
        report["xiaomi_teste"] = [{"ip": args.xiaomi_ip, **probe_xiaomi(args.xiaomi_ip, args.xiaomi_token)}]
    elif args.xiaomi_conta:
        report["xiaomi_teste"] = probe_xiaomi_account(args.xiaomi_conta)
    if "xiaomi_teste" in report:
        _print("Teste de leitura do robô", [json.dumps(d, ensure_ascii=False) for d in report["xiaomi_teste"]])

    nothing = not any(report[k] for k in ("tuya", "midea", "lg", "xiaomi"))
    if nothing:
        _print("Nada respondeu", [
            "Este PC está no mesmo Wi-Fi/roteador dos aparelhos?",
            "Rede do Windows como 'Pública' bloqueia descoberta: mude para 'Privada'.",
            "Rode ops/instalar.ps1 (cria as regras do Firewall) e tente de novo.",
        ])
    args.saida.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRelatório salvo em {args.saida.resolve()}")


if __name__ == "__main__":
    main()
