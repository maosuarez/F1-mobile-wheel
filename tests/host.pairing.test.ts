import { describe, expect, it } from 'vitest';
import { pairingHint, shouldShowWheelButton, wheelUrl } from '../src/host/pairing';

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
  it('dominio público vía túnel sin PUBLIC_URL: modo public', () => {
    const r = wheelUrl({ protocol: 'https:', hostname: 'f1.midominio.com', port: '' }, { lan_ips: [], public_url: null }, 'ABCD');
    expect(r).toEqual({ url: 'https://f1.midominio.com/wheel/?room=ABCD', mode: 'public' });
    const hint = pairingHint(r.mode, '');
    expect(hint).toBe('Escanea el QR o escribe el código en /wheel/');
    expect(hint.length).toBe(44);
  });
  it('rangos privados: 10.x y 172.16-31.x son wifi; 172.40.x es public', () => {
    const info = { lan_ips: [], public_url: null };
    const m = (hostname: string) => wheelUrl({ protocol: 'http:', hostname, port: '5173' }, info, 'ABCD').mode;
    expect(m('10.0.0.5')).toBe('wifi');
    expect(m('172.20.1.1')).toBe('wifi');
    expect(m('172.40.1.1')).toBe('public');
    expect(m('169.254.3.4')).toBe('wifi');
    expect(m('mipc.local')).toBe('wifi');
  });
  it('sin /api/info sigue funcionando', () => {
    expect(wheelUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }, null, 'ABCD').mode).toBe('usb');
  });
});

describe('shouldShowWheelButton', () => {
  it('solo en táctil sin Quest/VR', () => {
    expect(shouldShowWheelButton(true, false)).toBe(true);
    expect(shouldShowWheelButton(true, true)).toBe(false);
    expect(shouldShowWheelButton(false, false)).toBe(false);
    expect(shouldShowWheelButton(false, true)).toBe(false);
  });
});
