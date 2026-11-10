"""Comprueba el relay (server/main.py) contra specs/wheel-relay. Sale != 0 si algo falla."""
import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from websockets.asyncio.client import connect

ROOT = Path(__file__).resolve().parent.parent
PING = '{"t":"ping"}'
PONG = '{"t":"pong"}'
results: list[tuple[str, bool, str]] = []


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int, extra_env: dict | None = None) -> subprocess.Popen:
    env = {k: v for k, v in os.environ.items() if k != "PUBLIC_URL"}
    env.update({"RELAY_PING_S": "0.3", "RELAY_TIMEOUT_S": "1.0", **(extra_env or {})})
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.main:app", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT, env=env,
    )
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=0.5).read()
            return proc
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("el relay no arrancó")


class Client:
    """Cliente con lector en segundo plano; responde pong salvo que auto_pong=False."""

    def __init__(self, ws, auto_pong=True):
        self.ws, self.auto_pong, self.q = ws, auto_pong, asyncio.Queue()
        self.task = asyncio.create_task(self._read())

    async def _read(self):
        try:
            async for raw in self.ws:
                if raw.strip() == PING:
                    if self.auto_pong:
                        await self.ws.send(PONG)
                else:
                    await self.q.put(raw)
        except Exception:
            pass

    async def get(self, timeout=1.0):
        return await asyncio.wait_for(self.q.get(), timeout)

    async def quiet(self, secs=0.5) -> list[str]:
        await asyncio.sleep(secs)
        out = []
        while not self.q.empty():
            out.append(self.q.get_nowait())
        return out

    async def closed(self, timeout=3.0) -> int | None:
        await asyncio.wait_for(self.ws.wait_closed(), timeout)
        return self.ws.close_code

    async def close(self):
        await self.ws.close()


async def conn(port, room, role, auto_pong=True) -> Client:
    ws = await connect(f"ws://127.0.0.1:{port}/ws/{room}?role={role}")
    return Client(ws, auto_pong)


def peer(role, connected):
    return json.dumps({"t": "peer", "role": role, "connected": connected}, separators=(",", ":"))


async def case(name, coro):
    try:
        await coro
        results.append((name, True, ""))
    except Exception as e:  # noqa: BLE001
        results.append((name, False, f"{type(e).__name__}: {e}"))


def check(cond, msg="aserción falsa"):
    if not cond:
        raise AssertionError(msg)


async def t_pairing(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    check(await h.get() == peer("wheel", True) and await w.get() == peer("host", True), "sin peer")
    check(not h.ws.close_code and not w.ws.close_code, "cerrada")
    await h.close(); await w.close()


async def t_replace(p):
    h, w1 = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w1.get()
    w2 = await conn(p, "ABCD", "wheel")
    check(await w1.closed() == 4001, "código distinto de 4001")
    check(await w2.get() == peer("host", True), "w2 sin peer")
    await h.get()  # peer del nuevo volante
    await w2.ws.send("hola2")
    check(await h.get() == "hola2", "host no recibe del segundo")
    check(await h.quiet(0.3) == [], "host recibió peer disconnected espurio")
    await h.close(); await w2.close()


async def t_invalid(p):
    for room, role in (("ABCD", "spectator"), ("ABC", "host"), ("ABCDE", "host"), ("AB0D", "host"), ("abcd", "host")):
        c = await conn(p, room, role)
        check(await c.closed() == 4400, f"{room}/{role} no cerró con 4400")


async def t_cleanup(p):
    h, w = await conn(p, "WXYZ", "host"), await conn(p, "WXYZ", "wheel")
    await h.get(); await w.get()
    await h.close(); await w.close()
    await asyncio.sleep(0.3)
    h2 = await conn(p, "WXYZ", "host")  # sala vacía: sin peer de un volante fantasma
    check(await h2.quiet(0.4) == [], "la sala conservaba estado")
    await h2.close()


async def t_wheel_to_host(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w.get()
    msg = '{"t":"in","seq":1,"ts":5,"steer":0.5,"thr":1,"brk":0,"ers":false}'
    await w.ws.send(msg)
    check(await h.get() == msg, "cadena distinta")
    await h.close(); await w.close()


async def t_host_to_wheel(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w.get()
    for i in range(100):
        await h.ws.send(f"m{i}")
    got = [await w.get() for _ in range(100)]
    check(got == [f"m{i}" for i in range(100)], "orden roto")
    await h.close(); await w.close()


async def t_no_dest(p):
    h = await conn(p, "ABCD", "host")
    await h.ws.send("perdido")
    await asyncio.sleep(0.2)
    check(not h.ws.close_code, "host cerrado")
    w = await conn(p, "ABCD", "wheel")
    check(await w.get() == peer("host", True), "sin peer")
    check(await w.quiet(0.3) == [], "llegó el mensaje descartado")
    await h.close(); await w.close()


async def t_big(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w.get()
    await w.ws.send("x" * 5000)
    await w.ws.send("ok")
    check(await h.get() == "ok", "se reenvió el mensaje grande")
    await h.close(); await w.close()


async def t_peer_arrival(p):
    h = await conn(p, "ABCD", "host")
    check(await h.quiet(0.2) == [], "peer sin volante")
    w = await conn(p, "ABCD", "wheel")
    check(await h.get() == peer("wheel", True) and await w.get() == peer("host", True), "peer incorrecto")
    await h.close(); await w.close()


async def t_peer_leave(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w.get()
    t0 = time.monotonic()
    await w.close()
    check(await h.get(1.0) == peer("wheel", False), "sin peer disconnected")
    check(time.monotonic() - t0 < 1.0, "tardó >= 1 s")
    await h.close()


async def t_silent(p):
    h = await conn(p, "ABCD", "host")
    w = await conn(p, "ABCD", "wheel", auto_pong=False)  # nunca envía nada
    await h.get(); await w.get()
    check(await w.closed(4.0) == 4002, "código distinto de 4002")
    check(await h.get(1.0) == peer("wheel", False), "host sin aviso")
    await h.close()


async def t_pong(p):
    h, w = await conn(p, "ABCD", "host"), await conn(p, "ABCD", "wheel")
    await h.get(); await w.get()
    await w.ws.send(PONG)
    await w.ws.send(PING)
    check(await h.quiet(0.5) == [], "ping/pong reenviado")
    await h.close(); await w.close()


async def t_info(p):
    d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{p}/api/info"))
    check(isinstance(d["lan_ips"], list) and all(isinstance(i, str) and i.count(".") == 3 for i in d["lan_ips"]), "lan_ips")
    check(not any(i.startswith("127.") for i in d["lan_ips"]), "incluye 127.*")
    check(d["public_url"] is None, "public_url no es null")


async def t_public(p):
    d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{p}/api/info"))
    check(d["public_url"] == "https://ejemplo.test", f"public_url={d['public_url']}")


async def main() -> int:
    p1, p2 = free_port(), free_port()
    s1 = start_server(p1)
    s2 = start_server(p2, {"PUBLIC_URL": "https://ejemplo.test"})
    try:
        for name, fn in [
            ("Emparejamiento", t_pairing), ("Volante de reemplazo", t_replace),
            ("Petición inválida", t_invalid), ("Limpieza de salas", t_cleanup),
            ("Volante hacia host", t_wheel_to_host), ("Host hacia volante", t_host_to_wheel),
            ("Sin destinatario", t_no_dest), ("Mensaje demasiado grande", t_big),
            ("Llegada del volante", t_peer_arrival), ("Salida del volante", t_peer_leave),
            ("Conexión silenciosa", t_silent), ("Pong no reenviado", t_pong),
            ("Consulta /api/info", t_info),
        ]:
            await case(name, fn(p1))
        await case("URL pública", t_public(p2))
    finally:
        s1.terminate(); s2.terminate()
        s1.wait(); s2.wait()
    for name, ok, err in results:
        print(f"{'OK  ' if ok else 'FAIL'} {name}" + (f" -> {err}" if err else ""))
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
