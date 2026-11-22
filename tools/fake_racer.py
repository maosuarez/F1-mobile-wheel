"""Piloto online simulado: se une a /ws/race/{code} y envía `st` sintéticos a 20 Hz (src/shared/protocol.ts).

Mensajes: envía `time` (reloj), `hello` y `st`; recibe `lobby`, `time`, `r` (envuelto) y `ping` (responde `pong`).
Salida: 0 éxito, 1 no conecta en 5 s o cierre del relay (el código de cierre va a stderr).
"""
import argparse
import asyncio
import json
import math
import sys
import time

from websockets.asyncio.client import connect


def dumps(o) -> str:
    return json.dumps(o, separators=(",", ":"))


async def run(a) -> int:
    url = f"{a.url.rstrip('/')}/race/{a.code}?name={a.name}"
    try:
        ws = await asyncio.wait_for(connect(url), 5)
    except Exception as e:  # noqa: BLE001
        print(f"No se pudo conectar a {url} en 5 s: {e}", file=sys.stderr)
        return 1
    st = {"slot": None, "recv": 0, "owner": None}
    offset = [0.0]

    async def recv():
        async for raw in ws:
            m = json.loads(raw)
            t = m.get("t")
            if t == "ping":
                await ws.send('{"t":"pong"}')
            elif t == "lobby":
                st["slot"], st["owner"] = m["you"], m["owner"]
                print(f"lobby: plaza {m['you']}, propietario {m['owner']}, jugadores "
                      f"{[(p['slot'], p['name']) for p in m['players']]}")
            elif t == "time":
                offset[0] = m["srv"] - time.time() * 1000.0
            elif t == "r":
                st["recv"] += 1

    rtask = asyncio.create_task(recv())
    code = 0
    try:
        for _ in range(3):
            await ws.send('{"t":"time"}')
        await ws.send(dumps({"t": "hello", "name": a.name, "team": 0}))
        t0 = time.monotonic()
        n = 0
        next_print = t0 + 1
        while time.monotonic() - t0 < a.duration:
            if rtask.done():
                print(f"Conexión cerrada por el relay: {ws.close_code}", file=sys.stderr)
                code = 1
                break
            el = time.monotonic() - t0
            ang = el * 0.5 + (st["slot"] or 0)
            await ws.send(dumps({
                "t": "st", "ts": round(time.time() * 1000.0 + offset[0], 1), "x": round(100 * math.cos(ang), 3),
                "y": 0, "z": round(100 * math.sin(ang), 3), "yaw": round(-ang, 3), "pitch": 0, "roll": 0, "v": 50,
                "steer": 0, "s": round(el * 50, 3), "d": 0, "laps": 0, "prog": round(el * 0.01, 3), "drs": 0,
                "fin": False, "tt": None, "best": None}))
            n += 1
            if time.monotonic() >= next_print:
                print(f"enviados={n} recibidos={st['recv']}")
                next_print += 1
            await asyncio.sleep(max(0.0, t0 + n / 20 - time.monotonic()))
    finally:
        rtask.cancel()
        await ws.close()
    return code


def main() -> None:
    p = argparse.ArgumentParser(description="Piloto online simulado")
    p.add_argument("--code", required=True, help="código de sala de 6 caracteres")
    p.add_argument("--name", default="BOT")
    p.add_argument("--url", default="ws://localhost:5173/ws")
    p.add_argument("--duration", type=float, default=10)
    sys.exit(asyncio.run(run(p.parse_args())))


if __name__ == "__main__":
    main()
