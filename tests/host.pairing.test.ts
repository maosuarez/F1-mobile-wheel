import { describe, expect, it } from 'vitest';
import { pairingHint, wheelUrl } from '../src/host/pairing';

describe('wheelUrl', () => {
  it('modo USB: localhost', () => {
    const r = wheelUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }, { lan_ips: ['192.168.1.20'], public_url: null }, 'ABCD');
    expect(r).toEqual({ url: 'http://localhost:5173/wheel/?room=ABCD', mode: 'usb' });
    expect(pairingHint(r.mode, '5173')).toContain('adb reverse tcp:5173 tcp:5173');
  });
  it('modo WiFi: HTTPS desde una IP de la red local', () => {
    const r = wheelUrl({ protocol: 'https:', hostname: '192.168.1.20', port: '5173' }, { lan_ips: ['192.168.1.20'], public_url: null }, 'XY23');
    expect(r).toEqual({ url: 'https://192.168.1.20:5173/wheel/?room=XY23', mode: 'wifi' });
  });
  it('URL pública configurada', () => {
    const r = wheelUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }, { lan_ips: [], public_url: 'https://f1.example.net/' }, 'ABCD');
    expect(r).toEqual({ url: 'https://f1.example.net/wheel/?room=ABCD', mode: 'public' });
  });
  it('sin /api/info sigue funcionando', () => {
    expect(wheelUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }, null, 'ABCD').mode).toBe('usb');
  });
});
