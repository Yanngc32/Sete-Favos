"""Fluxo da tela "Adicionar aparelho": conta do fabricante, descoberta, pareamento e cadastro.

Os candidatos (com local_key/token em memória) vivem só aqui, por até 30 min.
Segredos só vão para o cofre quando o aparelho é cadastrado.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from casa.adapters.base import AccountField, Adapter, AdapterError, Candidate
from casa.events import EventBus
from casa.hub import Hub
from casa.model import DeviceView, Kind, new_id
from casa.net import is_lan_device_ip

log = logging.getLogger(__name__)

JOB_TTL = 1800.0
DISCOVERY_TIMEOUT = 10.0
PAIR_TIMEOUT = 75.0


class NotFound(Exception):
    pass


@dataclass
class _Job:
    vendor: str
    id: str = field(default_factory=new_id)
    candidates: dict[str, Candidate] = field(default_factory=dict)
    done: bool = False
    error: str | None = None
    error_code: str | None = None
    error_data: dict[str, Any] = field(default_factory=dict)
    created: float = field(default_factory=time.monotonic)
    task: asyncio.Task | None = None


class Onboarding:
    def __init__(self, hub: Hub, adapters: dict[str, Adapter], bus: EventBus) -> None:
        self.hub = hub
        self.adapters = adapters
        self.bus = bus
        self._jobs: dict[str, _Job] = {}
        self._manual_slots = asyncio.Semaphore(2)

    def adapter(self, vendor: str) -> Adapter:
        try:
            return self.adapters[vendor]
        except KeyError:
            raise NotFound(vendor) from None

    def vendors(self) -> list[dict[str, Any]]:
        return [
            {
                "vendor": a.vendor,
                "label": a.label,
                "description": a.description,
                "account_required": a.account_required,
                "account_configured": a.account_configured(),
                "account_fields": [_field(f) for f in a.account_fields],
                "transient_fields": [_field(f) for f in a.transient_fields],
                "transient_required": a.transient_required,
                # "Adicionar pelo IP" só aparece pra quem implementa o cadastro manual.
                "manual_add": type(a).manual_candidate is not Adapter.manual_candidate,
            }
            for a in self.adapters.values()
            if a.listed
        ]

    async def save_account(self, vendor: str, values: dict[str, str]) -> None:
        await self.adapter(vendor).save_account(values)

    def clear_account(self, vendor: str) -> None:
        self.adapter(vendor).clear_account()

    # Descoberta ---------------------------------------------------------------

    def start_discovery(self, vendor: str, credentials: dict[str, str] | None = None) -> dict[str, Any]:
        adapter = self.adapter(vendor)
        if adapter.account_required and not adapter.account_configured():
            raise AdapterError("sem_conta", f"Conecte a conta {adapter.label} antes de procurar.")
        creds = {f.name: (credentials or {}).get(f.name, "").strip() for f in adapter.transient_fields}
        if adapter.transient_required:
            missing = [f.label for f in adapter.transient_fields if f.required and not creds[f.name]]
            if missing:
                raise AdapterError("campos_faltando", "Preencha: " + ", ".join(missing) + ".")
        self._gc()
        for old in self._jobs.values():  # uma busca por fabricante: a nova substitui a que ainda roda
            if old.vendor == vendor and not old.done and old.task:
                old.task.cancel()
        job = _Job(vendor=vendor)
        self._jobs[job.id] = job

        def found(candidate: Candidate) -> None:
            if job.done or candidate.key in job.candidates:
                return
            job.candidates[candidate.key] = candidate
            self.bus.publish({"t": "discovery", "job": job.id, "candidate": self._candidate_view(candidate)})

        async def run() -> None:
            try:
                await adapter.discover(found, DISCOVERY_TIMEOUT, creds)
            except AdapterError as exc:
                job.error = exc.message
                job.error_code = exc.code
                job.error_data = exc.data
            except Exception:
                log.exception("descoberta %s falhou", vendor)
                job.error = "A busca falhou. Veja o log da colmeia."
            finally:
                job.done = True
                self.bus.publish({"t": "discovery_done", "job": job.id, **self.job(job.id)})

        job.task = asyncio.create_task(run(), name=f"discover:{vendor}")
        return self.job(job.id)

    async def manual(self, vendor: str, ip: str, device_id: str | None, secret: str | None) -> dict[str, Any]:
        adapter = self.adapter(vendor)
        if not is_lan_device_ip(ip):
            raise AdapterError("ip_invalido", "Use o IP do aparelho na rede de casa (ex.: 192.168.1.20).")
        async with self._manual_slots:
            candidate = await adapter.manual_candidate(
                ip.strip(), (device_id or "").strip() or None, (secret or "").strip() or None
            )
        self._gc()
        job = _Job(vendor=vendor, done=True)
        job.candidates[candidate.key] = candidate
        self._jobs[job.id] = job
        return {"job": job.id, "candidate": self._candidate_view(candidate)}

    def job(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        return {
            "id": job.id, "vendor": job.vendor, "done": job.done,
            "error": job.error, "error_code": job.error_code, "error_data": job.error_data,
            "candidates": [self._candidate_view(c) for c in job.candidates.values()],
        }

    async def pair(self, job_id: str, key: str) -> dict[str, Any]:
        job = self._job(job_id)
        candidate = self._candidate(job, key)
        try:
            paired = await asyncio.wait_for(self.adapter(job.vendor).pair(candidate), PAIR_TIMEOUT)
        except TimeoutError:
            raise AdapterError("tempo_esgotado", "O aparelho não confirmou a tempo. Tente de novo.") from None
        paired.needs_pairing = False
        job.candidates[key] = paired
        return self._candidate_view(paired)

    async def add(self, job_id: str, key: str, *, name: str, room: str | None, kind: Kind) -> DeviceView:
        job = self._job(job_id)
        candidate = self._candidate(job, key)
        if candidate.problem:
            raise AdapterError("nao_suportado", candidate.problem)
        if candidate.needs_pairing:
            raise AdapterError("falta_parear", "Confirme o pareamento antes de concluir.")
        view = await self.hub.add_device(candidate, name=name, room=room, kind=kind)
        job.candidates.pop(key, None)
        return view

    # Interno ------------------------------------------------------------------

    def _candidate_view(self, c: Candidate) -> dict[str, Any]:
        data = c.model_dump()
        data["already_added"] = self.hub.is_added(c.vendor, c.key)
        return data

    def _job(self, job_id: str) -> _Job:
        job = self._jobs.get(job_id)
        if job is None or time.monotonic() - job.created > JOB_TTL:
            raise NotFound(job_id)
        return job

    @staticmethod
    def _candidate(job: _Job, key: str) -> Candidate:
        try:
            return job.candidates[key]
        except KeyError:
            raise NotFound(key) from None

    def _gc(self) -> None:
        now = time.monotonic()
        for job_id in [j.id for j in self._jobs.values() if now - j.created > JOB_TTL]:
            job = self._jobs.pop(job_id)
            if job.task and not job.task.done():
                job.task.cancel()


def _field(f: AccountField) -> dict[str, Any]:
    return {
        "name": f.name, "label": f.label, "secret": f.secret, "required": f.required, "help": f.help,
        "hidden": f.hidden,
        "options": [{"value": v, "label": label} for v, label in f.options] if f.options else None,
    }
