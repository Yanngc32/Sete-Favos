"""Utilidades de rede local."""

from __future__ import annotations

import ipaddress
import socket

import netifaces

TAILNET = ipaddress.ip_network("100.64.0.0/10")


def ipv4_addresses() -> list[ipaddress.IPv4Address]:
    out = []
    for iface in netifaces.interfaces():
        for addr in netifaces.ifaddresses(iface).get(netifaces.AF_INET, []):
            try:
                out.append(ipaddress.IPv4Address(addr["addr"]))
            except (KeyError, ValueError):
                continue
    return out


def lan_ipv4s() -> list[str]:
    """IPs privados das placas de rede (sem loopback, link-local nem Tailscale)."""
    return [
        str(ip) for ip in ipv4_addresses()
        if ip.is_private and not ip.is_loopback and not ip.is_link_local and ip not in TAILNET
    ]


def is_lan_device_ip(value: str) -> bool:
    """IPv4 literal de rede privada (RFC 1918): o único tipo de endereço que o backend aceita sondar a pedido."""
    try:
        ip = ipaddress.IPv4Address(value.strip())
    except ValueError:
        return False
    return ip.is_private and not (ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip in TAILNET)


def tailnet_ipv4() -> str | None:
    return next((str(ip) for ip in ipv4_addresses() if ip in TAILNET), None)


def wake_on_lan(mac: str) -> None:
    """Manda o 'magic packet' por broadcast em todas as placas da LAN."""
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    if len(raw) != 6:
        raise ValueError(f"MAC inválido: {mac}")
    packet = b"\xff" * 6 + raw * 16
    for local in lan_ipv4s() or ["0.0.0.0"]:  # noqa: S104
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            try:
                sock.bind((local, 0))
                sock.sendto(packet, ("255.255.255.255", 9))
            except OSError:
                continue
