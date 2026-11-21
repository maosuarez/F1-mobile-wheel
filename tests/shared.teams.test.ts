import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { driverAt, TEAMS } from '../src/shared/teams';

// Lista de comprobación: equipos, pilotos (apellidos) y patrocinadores reales de F1 (palabras completas, sin tildes).
const BANNED_WORDS = [
  'ferrari', 'mercedes', 'mclaren', 'alpine', 'williams', 'haas', 'sauber', 'kick', 'rb', 'alphatauri', 'renault',
  'audi', 'cadillac', 'lotus', 'brawn', 'jordan', 'minardi', 'benetton', 'tyrrell', 'toyota', 'honda', 'bmw', 'jaguar',
  'stake', 'visa', 'cashapp', 'moneygram', 'petronas', 'oracle', 'shell', 'aramco', 'pirelli', 'rolex', 'dhl',
  'heineken', 'santander', 'marlboro', 'monster', 'puma', 'castrol', 'mobil', 'ineos', 'bwt', 'crypto', 'cognizant',
  'verstappen', 'hamilton', 'leclerc', 'norris', 'piastri', 'sainz', 'russell', 'alonso', 'stroll', 'ocon', 'gasly',
  'albon', 'tsunoda', 'hulkenberg', 'magnussen', 'bottas', 'zhou', 'sargeant', 'ricciardo', 'lawson', 'bearman',
  'colapinto', 'antonelli', 'doohan', 'hadjar', 'bortoleto', 'perez', 'vettel', 'raikkonen', 'schumacher', 'senna',
  'prost', 'lauda', 'button', 'rosberg', 'massa', 'webber', 'kubica', 'grosjean', 'kvyat', 'giovinazzi', 'latifi',
  'mazepin', 'fittipaldi', 'piquet', 'barrichello', 'mansell', 'hill', 'hakkinen', 'coulthard', 'montoya', 'villeneuve',
  'lindblad', 'iwasa', 'drugovich', 'pourchaire',
];
const BANNED_PHRASES = ['red bull', 'aston martin', 'racing bulls', 'alfa romeo', 'toro rosso', 'force india', 'racing point',
  'oracle red bull', 'scuderia ferrari'];
const REAL_CODES = ['VER', 'HAM', 'LEC', 'NOR', 'PIA', 'SAI', 'RUS', 'ALO', 'STR', 'OCO', 'GAS', 'ALB', 'TSU', 'HUL', 'MAG',
  'BOT', 'ZHO', 'SAR', 'RIC', 'LAW', 'BEA', 'COL', 'ANT', 'DOO', 'HAD', 'BOR', 'PER', 'VET', 'RAI', 'MSC', 'LIN'];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

describe('Identidad ficticia', () => {
  const names = TEAMS.flatMap((t) => [t.name, ...t.drivers.map((d) => d.name)]);

  it('5 escuderías × 2 pilotos con códigos únicos de 3 letras y colores sRGB', () => {
    expect(TEAMS.length).toBe(5);
    const codes = TEAMS.flatMap((t) => t.drivers.map((d) => d.code));
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{3}$/);
    for (const t of TEAMS) { expect(t.primary).toMatch(/^#[0-9a-f]{6}$/i); expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i); }
    expect(TEAMS[0].primary).toBe(config.carVisual.colors.primary);
    expect(driverAt(0)).toEqual({ team: 0, driver: TEAMS[0].drivers[0] });
    expect(driverAt(9).team).toBe(4);
  });

  it('ningún nombre coincide con un equipo, piloto o patrocinador real', () => {
    for (const n of names) {
      const s = norm(n);
      const words = s.split(/[^a-z]+/).filter(Boolean);
      for (const w of BANNED_WORDS) expect(words, `${n} contiene ${w}`).not.toContain(w);
      for (const p of BANNED_PHRASES) expect(s.includes(p), `${n} contiene ${p}`).toBe(false);
    }
    for (const t of TEAMS) for (const d of t.drivers) expect(REAL_CODES).not.toContain(d.code);
  });
});
