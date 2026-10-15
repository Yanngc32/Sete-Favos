import httpx
import pytest

from casa.home import Home
from casa.weather import Weather, describe

_OK = {
    "current": {
        "temperature_2m": 18.6, "relative_humidity_2m": 71.6, "weather_code": 3,
        "wind_speed_10m": 11.8, "visibility": 8200.0, "is_day": 0, "time": "2026-10-14T19:40",
    }
}


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_without_home_location() -> None:
    assert await Weather(_client(lambda r: httpx.Response(500))).current(None) == {"available": False, "reason": "sem_local"}


@pytest.mark.asyncio
async def test_parses_and_caches_and_rounds_position() -> None:
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return httpx.Response(200, json=_OK)

    w = Weather(_client(handler))
    home = Home(lat=-23.561234, lon=-46.655678)
    data = await w.current(home)
    assert data == {
        "available": True, "temp_c": 19, "humidity": 72, "wind_kmh": 12, "visibility_km": 8,
        "condition": "Nublado", "icon": "cloud", "is_day": False, "time": "2026-10-14T19:40",
    }
    assert await w.current(home) == data
    assert len(calls) == 1
    # Só a posição arredondada sai da colmeia.
    assert calls[0].url.params["latitude"] == "-23.56"
    assert calls[0].url.params["longitude"] == "-46.66"


@pytest.mark.asyncio
async def test_failure_is_reported_not_raised() -> None:
    w = Weather(_client(lambda r: httpx.Response(503)))
    assert await w.current(Home(lat=1, lon=1)) == {"available": False, "reason": "indisponivel"}


def test_describe_night_icons() -> None:
    assert describe(0, True) == ("Céu limpo", "sun")
    assert describe(0, False) == ("Céu limpo", "moon")
    assert describe(2, False)[1] == "cloud-moon"
    assert describe(999, True) == ("Sem dados", "cloud")


@pytest.mark.asyncio
async def test_failure_keeps_last_good_value(monkeypatch) -> None:
    import casa.weather as wmod

    ok = True

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_OK) if ok else httpx.Response(503)

    clock = [1000.0]
    monkeypatch.setattr(wmod.time, "monotonic", lambda: clock[0])
    w = Weather(_client(handler))
    home = Home(lat=1, lon=1)
    good = await w.current(home)
    ok = False
    clock[0] += 700  # cache venceu
    assert await w.current(home) == good
