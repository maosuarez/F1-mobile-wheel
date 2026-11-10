import { RoomClient } from '../host/net/roomClient';
import { decodeAtWheel, encode, type EvKey, type FxKey, type InMsg, type TelMsg } from '../shared/protocol';

// Conexión del volante con el relay: decodifica lo recibido y numera los `in`.

export interface NetHandlers {
  onStatus: (s: 'connecting' | 'open' | 'closed') => void;
  onPeer: (hostConnected: boolean) => void;
  onTel: (t: TelMsg) => void;
  onFx: (k: FxKey) => void;
}

export class WheelNet {
  private readonly client: RoomClient;
  private seq = 0;
  last: InMsg | null = null;

  constructor(room: string, h: NetHandlers) {
    this.client = new RoomClient('wheel', room);
    this.client.onStatus = h.onStatus;
    this.client.onMessage = (raw) => {
      const m = decodeAtWheel(raw);
      if (!m) return;
      if (m.t === 'tel') h.onTel(m);
      else if (m.t === 'fx') h.onFx(m.k);
      else if (m.t === 'peer' && m.role === 'host') h.onPeer(m.connected);
    };
  }

  connect(): void { this.client.connect(); }

  sendIn(v: { steer: number; thr: number; brk: number; ers: boolean; rtt: number | null }): void {
    const msg: InMsg = { t: 'in', seq: ++this.seq, ts: Math.round(performance.now()), ...v };
    this.last = msg;
    this.client.send(encode(msg));
  }

  sendEv(k: EvKey): void { this.client.send(encode({ t: 'ev', k })); }
}
