from __future__ import annotations

from casa.adapters.base import Adapter
from casa.vault import Vault


def build_adapters(vault: Vault, *, simulate: bool = False) -> dict[str, Adapter]:
    from casa.adapters.lg import LgAdapter
    from casa.adapters.midea import MideaAdapter
    from casa.adapters.tuya import PositivoAdapter, TuyaAdapter
    from casa.adapters.xiaomi import XiaomiAdapter

    adapters: list[Adapter] = [
        TuyaAdapter(vault),
        PositivoAdapter(vault),
        MideaAdapter(vault),
        LgAdapter(vault),
        XiaomiAdapter(vault),
    ]
    if simulate:
        from casa.adapters.sim import SimAdapter

        adapters.append(SimAdapter(vault))
    return {a.vendor: a for a in adapters}
