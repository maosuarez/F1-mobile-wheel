"""Volante simulado: habla el protocolo del celular (src/shared/protocol.ts) por el relay.

Mensajes: envía `in` (60 Hz) y `ev` (up/down); recibe `tel`, `ping` (responde `pong`), ignora `peer`/`fx`.
Salida: 0 éxito, 1 no conecta en 5 s, 2 timeout, 3 `lap` sin `dbg`.
"""
import argparse
import asyncio
import json
import math
import random
import sys
import time

from websockets.asyncio.client import connect


def now_ms() -> float:
    return time.time() * 1000.0


async def run(a) -> int:
    rng = random.Random(a.seed)
    url = f"{a.url.rstrip('/')}/{a.room}?role=wheel"
    try:
        ws = await asyncio.wait_for(connect(url), 5)
    except Exception as e:  # noqa: BLE001
        print(f"No se pudo conectar a {url} en 5 s: {e}", file=sys.stderr)
        return 1

    st = {"tel": None, "n": 0, "first_tel": None, "dbg": None, "lap_seen": None, "lap_t": None, "done": None}
    max_spd = 0.0
    seq = 0
    t0 = time.monotonic()
    last_shift = 0.0
    rnd = [0.0, 0.0, 0.0]  # estado de la entrada aleatoria suave

    async def recv():
        nonlocal max_spd
        async for raw in ws:
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            t = m.get("t")
            if t == "ping":
                await ws.send('{"t":"pong"}')
            elif t == "tel":
                st["tel"] = m
                st["n"] += 1
                if st["first_tel"] is None:
                    st["first_tel"] = time.monotonic()
                if m.get("dbg"):
                    st["dbg"] = m["dbg"]
                max_spd = max(max_spd, m.get("spd", 0))
                lap = m.get("lap")
                if st["lap_seen"] is not None and lap != st["lap_seen"]:
                    print(f"Vuelta {st['lap_seen']} completada en {time.monotonic() - st['lap_t']:.3f} s")
                    st["lap_t"] = time.monotonic()
                if st["lap_seen"] is None:
                    st["lap_t"] = time.monotonic()
                st["lap_seen"] = lap
                if a.script == "lap" and lap is not None and lap >= a.laps + 1:
                    st["done"] = 0

    rtask = asyncio.create_task(recv())
    code = 0
    next_print = t0 + 1
    next_tick = t0
    try:
        while True:
            now = time.monotonic()
            el = now - t0
            tel = st["tel"]
            if st["done"] is not None or rtask.done():
                code = st["done"] if st["done"] is not None else 1
                if rtask.done() and st["done"] is None:
                    print("Conexión cerrada por el relay", file=sys.stderr)
                break
            if a.script == "lap":
                if el > a.timeout:
                    print(f"Timeout de {a.timeout} s sin completar {a.laps} vuelta(s)", file=sys.stderr)
                    code = 2
                    break
                if st["first_tel"] and st["dbg"] is None and now - st["first_tel"] > 3:
                    print("No llega `dbg`: abre el juego con ?debug=1", file=sys.stderr)
                    code = 3
                    break
            elif el >= a.duration:
                break

            steer, thr, brk, target = 0.0, 0.0, 0.0, None
            if a.script == "straight":
                thr = 1.0
                if tel:
                    target = min(8, 1 + int(tel.get("spd", 0) // 60))
            elif a.script == "circle":
                steer, thr = 0.5, 0.5
            elif a.script == "random":
                for i in range(3):
                    rnd[i] += (rng.uniform(-1, 1) - rnd[i]) * 0.02
                steer, thr, brk = rnd[0], max(0.0, rnd[1]), max(0.0, rnd[2]) * 0.5
            elif a.script == "lap" and st["dbg"]:
                d = st["dbg"]
                steer, thr, brk, target = d["steer"], d["thr"], d["brk"], d["gear"]
            if target is not None and tel and now - last_shift >= 0.15:
                g = tel.get("gear", 1)
                if target > g:
                    await ws.send('{"t":"ev","k":"up"}')
                    last_shift = now
                elif target < g:
                    await ws.send('{"t":"ev","k":"down"}')
                    last_shift = now

            rtt = None
            if tel and tel.get("echo"):
                rtt = round(max(0.0, now_ms() - tel["echo"] - tel.get("hold", 0)), 1)
            seq += 1
            await ws.send(json.dumps({"t": "in", "seq": seq, "ts": round(now_ms(), 1), "steer": round(steer, 3),
                                      "thr": round(thr, 3), "brk": round(brk, 3), "ers": False, "rtt": rtt},
                                     separators=(",", ":")))
            if now >= next_print:
                if tel:
                    print(f"spd={tel.get('spd')} gear={tel.get('gear')} lap={tel.get('lap')} "
                          f"delta={tel.get('delta')} warn={tel.get('warn')!r} tel={st['n']}")
                else:
                    print("tel=0 (esperando telemetría)")
                st["n"] = 0
                next_print += 1
            next_tick += 1 / 60
            await asyncio.sleep(max(0.0, next_tick - time.monotonic()))
    finally:
        rtask.cancel()
        await ws.close()
    if code == 0 and a.script != "lap":
        print(f"Fin: velocidad máxima {max_spd:.0f} km/h")
    return code


def main() -> None:
    p = argparse.ArgumentParser(description="Volante simulado")
    p.add_argument("--room", required=True)
    p.add_argument("--url", default="ws://localhost:5173/ws")
    p.add_argument("--script", choices=["straight", "circle", "lap", "random"], default="straight")
    p.add_argument("--duration", type=float, default=10, help="segundos (no aplica a lap)")
    p.add_argument("--timeout", type=float, default=400, help="límite en s del guion lap")
    p.add_argument("--laps", type=int, default=1)
    p.add_argument("--seed", type=int, default=0)
    sys.exit(asyncio.run(run(p.parse_args())))


if __name__ == "__main__":
    main()
