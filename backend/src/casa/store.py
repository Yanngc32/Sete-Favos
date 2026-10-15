"""Persistência em SQLite: cada tabela guarda documentos JSON por id.

Nenhum segredo passa por aqui (ver secrets.py).
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

TABLES = ("rooms", "devices", "virtuals", "routines", "automations", "access_devices", "dashboard", "settings")


class Store:
    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        for table in TABLES:
            self._conn.execute(
                f"CREATE TABLE IF NOT EXISTS {table} ("
                "id TEXT PRIMARY KEY, data TEXT NOT NULL, created REAL NOT NULL)"
            )

    def all(self, table: str) -> list[dict[str, Any]]:
        # Nome de tabela vem só da lista fixa TABLES (_check); valores sempre por parâmetro.
        rows = self._conn.execute(f"SELECT data FROM {_check(table)} ORDER BY created, id")  # noqa: S608
        return [json.loads(data) for (data,) in rows]

    def get(self, table: str, id: str) -> dict[str, Any] | None:
        row = self._conn.execute(f"SELECT data FROM {_check(table)} WHERE id = ?", (id,)).fetchone()  # noqa: S608
        return json.loads(row[0]) if row else None

    def put(self, table: str, id: str, data: dict[str, Any]) -> None:
        self._conn.execute(
            f"INSERT INTO {_check(table)} (id, data, created) VALUES (?, ?, ?) "  # noqa: S608
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (id, json.dumps(data, ensure_ascii=False), time.time()),
        )

    def delete(self, table: str, id: str) -> bool:
        cur = self._conn.execute(f"DELETE FROM {_check(table)} WHERE id = ?", (id,))  # noqa: S608
        return cur.rowcount > 0

    def backup(self, dest: Path) -> None:
        """Cópia consistente do banco (API de backup do SQLite, segura com WAL e escrita em curso)."""
        target = sqlite3.connect(str(dest))
        try:
            self._conn.backup(target)
        finally:
            target.close()

    def close(self) -> None:
        self._conn.close()


def _check(table: str) -> str:
    if table not in TABLES:
        raise ValueError(f"tabela desconhecida: {table}")
    return table
