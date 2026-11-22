"""Relay WebSocket del volante móvil (FastAPI). Sin lógica de juego.

Une un host (PC) y un volante (celular) en una sala y reenvía los mensajes
de texto tal cual. Solo inspecciona si un mensaje es {"t":"ping"} o {"t":"pong"}.

Protocolo (JSON, una línea por mensaje; espejo de src/shared/protocol.ts):
  in    volante -> host   60 Hz   seq, ts, steer[-1,1], thr[0,1], brk[0,1], ers(bool), rtt(num|null)
  ev    volante -> host   evento  k: up | down | drs | cam | pause | recal | restart
  tel   host -> volante   20 Hz   spd, gear(-1=R,0=N,1-8), rpm, leds(0-16), drs(0|1|2), ers[0,1], ot,
                                  lap, delta, warn, echo(último ts recibido), hold(ms), dbg?{steer,thr,brk,gear},
                                  pos?, laps? (carrera: posición y vueltas totales),
                                  vr?, cal? (b20: host en VR / pide calibrar; solo si true)
  fx    host -> volante   evento  k: kerb | grass | limits | shift | limiter
  peer  relay -> ambos            role(host|wheel), connected(bool)
  ping  relay -> ambos    cada RELAY_PING_S; pong responde y no se reenvía

Carrera online (/ws/race/{code}?name=, code de 6 caracteres; hasta RACE_MAX=6 PCs):
  lobby   relay -> todos    you(plaza), owner(plaza), players[{slot,name}]; al entrar/salir alguien
  time    cliente -> relay  {"t":"time"}; el relay responde {"t":"time","srv":<ms epoch>} solo a quien pregunta
  started cliente -> relay  solo del propietario: marca la sala empezada (no se reenvía)
  r       relay -> demás    {"t":"r","f":<plaza origen>,"m":<mensaje tal cual>}; todo texto ≤4 KB que empiece por "{"
                            (hello, cfg, start, st, ai, res...: ver NetMsg en src/shared/protocol.ts; el relay no los parsea)
  ping    relay -> cada uno cada RELAY_PING_S; pong responde y no se reenvía
  RACE_TEST_DELAY_MS (entorno, 0 por defecto): retardo artificial de reenvío solo para pruebas.
Cierres de carrera: 4400 petición inválida, 4001 sala llena, 4002 sala ya empezada (o sin latido, una vez dentro).

Cierres del volante: 4400 petición inválida, 4001 reemplazado, 4002 sin latido.
"""
import asyncio
import os
import re
import socket
import time
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect

PING_S = float(os.environ.get("RELAY_PING_S", "2"))
TIMEOUT_S = float(os.environ.get("RELAY_TIMEOUT_S", "6"))
MAX_BYTES = 4096
ROOM_RE = re.compile(r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$")
RACE_RE = re.compile(r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$")
RACE_MAX = 6
NAME_MAX = 16
RACE_DELAY_S = float(os.environ.get("RACE_TEST_DELAY_MS", "0")) / 1000.0
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


@dataclass
class RaceRoom:
    slots: dict[int, Conn] = field(default_factory=dict)
    names: dict[int, str] = field(default_factory=dict)
    started: bool = False

    def owner(self) -> int:
        return min(self.slots)


race_rooms: dict[str, RaceRoom] = {}


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


def _json_str(s: str) -> str:
    out = ['"']
    for c in s:
        if c in '"\\':
            out.append("\\" + c)
        elif ord(c) < 0x20:
            out.append("\\u%04x" % ord(c))
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def lobby_msg(r: RaceRoom, you: int) -> str:
    players = ",".join('{"slot":%d,"name":%s}' % (n, _json_str(r.names[n])) for n in sorted(r.slots))
    return '{"t":"lobby","you":%d,"owner":%d,"players":[%s]}' % (you, r.owner(), players)


async def delayed_send(conn: Conn, text: str) -> None:
    await asyncio.sleep(RACE_DELAY_S)
    await safe_send(conn, text)


async def broadcast_lobby(r: RaceRoom) -> None:
    for n, c in list(r.slots.items()):
        await safe_send(c, lobby_msg(r, n))


@app.websocket("/ws/race/{code}")
async def race_endpoint(ws: WebSocket, code: str, name: str = "") -> None:
    await ws.accept()
    if not RACE_RE.match(code):
        await ws.close(4400)
        return
    r = race_rooms.setdefault(code, RaceRoom())
    if r.started:
        await ws.close(4002)
        return
    slot = next((i for i in range(RACE_MAX) if i not in r.slots), None)
    if slot is None:
        await ws.close(4001)
        return
    conn = Conn(ws)
    r.slots[slot] = conn
    r.names[slot] = name.strip()[:NAME_MAX] or f"P{slot + 1}"
    await broadcast_lobby(r)

    hb = asyncio.create_task(heartbeat(conn))
    pending: set[asyncio.Task] = set()
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
            if not text.startswith("{"):
                continue
            if text.startswith('{"t":"time"'):
                await safe_send(conn, '{"t":"time","srv":%d}' % int(time.time() * 1000))
                continue
            if text.startswith('{"t":"started"'):
                if slot == r.owner():
                    r.started = True
                continue
            wrapped = '{"t":"r","f":%d,"m":%s}' % (slot, text)
            for n, c in list(r.slots.items()):
                if n == slot:
                    continue
                if RACE_DELAY_S > 0:
                    t = asyncio.create_task(delayed_send(c, wrapped))
                    pending.add(t)
                    t.add_done_callback(pending.discard)
                else:
                    await safe_send(c, wrapped)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hb.cancel()
        if r.slots.get(slot) is conn:
            del r.slots[slot]
            r.names.pop(slot, None)
            if not r.slots:
                if race_rooms.get(code) is r:
                    del race_rooms[code]
            else:
                await broadcast_lobby(r)


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


# Estáticos del juego (build de Vite). Va al final para no tapar /ws ni /api.
_dist = os.environ.get("DIST_DIR", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="static")
