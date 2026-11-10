"""Relay WebSocket del volante móvil (FastAPI). Sin lógica de juego.

Une un host (PC) y un volante (celular) en una sala y reenvía los mensajes
de texto tal cual. Solo inspecciona si un mensaje es {"t":"ping"} o {"t":"pong"}.

Protocolo (JSON, una línea por mensaje; espejo de src/shared/protocol.ts):
  in    volante -> host   60 Hz   seq, ts, steer[-1,1], thr[0,1], brk[0,1], ers(bool), rtt(num|null)
  ev    volante -> host   evento  k: up | down | drs | cam | pause | recal
  tel   host -> volante   20 Hz   spd, gear(-1=R,0=N,1-8), rpm, leds(0-16), drs(0|1|2), ers[0,1], ot,
                                  lap, delta, warn, echo(último ts recibido), hold(ms), dbg?{steer,thr,brk,gear}
  fx    host -> volante   evento  k: kerb | grass | limits | shift | limiter
  peer  relay -> ambos            role(host|wheel), connected(bool)
  ping  relay -> ambos    cada RELAY_PING_S; pong responde y no se reenvía

Cierres: 4400 petición inválida, 4001 reemplazado, 4002 sin latido.
"""
import asyncio
import os
import re
import socket
import time
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket
from starlette.websockets import WebSocketDisconnect

PING_S = float(os.environ.get("RELAY_PING_S", "2"))
TIMEOUT_S = float(os.environ.get("RELAY_TIMEOUT_S", "6"))
MAX_BYTES = 4096
ROOM_RE = re.compile(r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$")
ROLES = ("host", "wheel")
PING = '{"t":"ping"}'
PONG = '{"t":"pong"}'

app = FastAPI()


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    last_seen: float = field(default_factory=time.monotonic)


@dataclass
class Room:
    host: Conn | None = None
    wheel: Conn | None = None


rooms: dict[str, Room] = {}


def other_of(role: str) -> str:
    return "wheel" if role == "host" else "host"


def peer_msg(role: str, connected: bool) -> str:
    return '{"t":"peer","role":"%s","connected":%s}' % (role, "true" if connected else "false")


async def safe_send(conn: Conn | None, text: str) -> None:
    if conn is None:
        return
    try:
        await conn.ws.send_text(text)
    except Exception:
        pass


async def safe_close(conn: Conn, code: int) -> None:
    try:
        await conn.ws.close(code)
    except Exception:
        pass


async def heartbeat(conn: Conn) -> None:
    """Envía ping y cierra con 4002 si no hay mensajes dentro del tiempo límite."""
    while True:
        await asyncio.sleep(PING_S)
        if time.monotonic() - conn.last_seen > TIMEOUT_S:
            await safe_close(conn, 4002)
            return
        await safe_send(conn, PING)


@app.websocket("/ws/{room}")
async def ws_endpoint(ws: WebSocket, room: str, role: str = "") -> None:
    await ws.accept()
    if role not in ROLES or not ROOM_RE.match(room):
        await ws.close(4400)
        return

    r = rooms.setdefault(room, Room())
    conn = Conn(ws)
    old: Conn | None = getattr(r, role)
    setattr(r, role, conn)
    if old is not None:
        await safe_close(old, 4001)

    other: Conn | None = getattr(r, other_of(role))
    if other is not None:
        await safe_send(other, peer_msg(role, True))
        await safe_send(conn, peer_msg(other_of(role), True))

    hb = asyncio.create_task(heartbeat(conn))
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            conn.last_seen = time.monotonic()
            text = msg.get("text")
            if text is None or len(text.encode()) > MAX_BYTES:
                continue
            if text.strip() in (PING, PONG):
                continue
            await safe_send(getattr(r, other_of(role)), text)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hb.cancel()
        # Si fue reemplazada, el slot ya es de otra conexión: no avisar ni limpiar.
        if getattr(r, role) is conn:
            setattr(r, role, None)
            await safe_send(getattr(r, other_of(role)), peer_msg(role, False))
            if r.host is None and r.wheel is None and rooms.get(room) is r:
                del rooms[room]


def lan_ips() -> list[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


@app.get("/api/info")
def info() -> dict:
    return {"lan_ips": lan_ips(), "public_url": os.environ.get("PUBLIC_URL") or None}
