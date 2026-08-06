import { describe, it, expect } from 'vitest';
import { escapeHtml, toLabel, adjustColor, formatValue } from '../../../src/lib/server/views/html.js';

describe('escapeHtml', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
    ['<b>&"\'</b>', '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;'],
    ['plain', 'plain'],
    ['', '']
  ])('%s → %s', (input, expected) => expect(escapeHtml(input)).toBe(expected));

  it('échappe & avant les autres entités', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('toLabel', () => {
  it.each([['email', 'email'], ['createdAt', 'created At'], ['User', 'User'], ['isActive', 'is Active']])(
    '%s → %s', (input, expected) => expect(toLabel(input)).toBe(expected)
  );
});

describe('adjustColor', () => {
  // Valeur recalculée à la main, pas recopiée depuis la sortie du code :
  // amt = round(2.55 * -15) = -38 ; 0x63-38=0x3d, 0x66-38=0x40, 0xf1-38=0xcb.
  it('assombrit', () => expect(adjustColor('#6366f1', -15)).toBe('#3d40cb'));
  it('éclaircit', () => expect(adjustColor('#000000', 10)).toBe('#1a1a1a'));
  it('borne à 255', () => expect(adjustColor('#ffffff', 50)).toBe('#ffffff'));
  it('borne à 0', () => expect(adjustColor('#000000', -50)).toBe('#000000'));
  it('accepte un hex sans dièse', () => expect(adjustColor('000000', 0)).toBe('#000000'));
});

describe('formatValue', () => {
  it('rend un tiret pour null', () => expect(formatValue(null, 'String')).toContain('—'));
  it('rend un tiret pour undefined', () => expect(formatValue(undefined, 'String')).toContain('—'));
  it('rend une date localisée', () => {
    expect(formatValue(new Date('2026-01-15T10:30:00Z'), 'DateTime')).toMatch(/2026/);
  });
  it('rend une coche pour vrai', () => expect(formatValue(true, 'Boolean')).toBe('✓'));
  it('rend une croix pour faux', () => expect(formatValue(false, 'Boolean')).toBe('✗'));
  it('rend zéro sans le confondre avec null', () => expect(formatValue(0, 'Int')).toBe('0'));
  it('tronque au-delà de 50 caractères', () => {
    expect(formatValue('a'.repeat(60), 'String')).toBe('a'.repeat(50) + '...');
  });
  it('échappe une valeur courte', () => expect(formatValue('<b>', 'String')).toBe('&lt;b&gt;'));
  it('échappe une valeur tronquée', () => {
    expect(formatValue('<'.repeat(60), 'String')).toBe('&lt;'.repeat(50) + '...');
  });
});
