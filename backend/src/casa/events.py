"""Barramento de eventos: alimenta os WebSockets do front e o motor de automações."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

log = logging.getLogger(__name__)

Event = dict[str, Any]


class Subscription:
    def __init__(self, maxsize: int) -> None:
        self.queue: asyncio.Queue[Event] = asyncio.Queue(maxsize)
        # Cliente lento demais: o WebSocket fecha e o front reconecta com um retrato novo.
        self.overflowed = False
        self.closed = asyncio.Event()


class EventBus:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._listeners: list[Callable[[Event], None]] = []

    def subscribe(self, maxsize: int = 1000) -> Subscription:
        sub = Subscription(maxsize)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        self._subs.discard(sub)

    def listen(self, callback: Callable[[Event], None]) -> None:
        """Ouvinte interno (síncrono, não pode bloquear)."""
        self._listeners.append(callback)

    def publish(self, event: Event, *, internal: bool = False) -> None:
        for callback in self._listeners:
            try:
                callback(event)
            except Exception:
                log.exception("ouvinte falhou para %s", event.get("t"))
        if internal:
            return
        for sub in list(self._subs):
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                sub.overflowed = True
                sub.closed.set()
                self._subs.discard(sub)
