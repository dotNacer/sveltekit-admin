import { describe, it, expect } from 'vitest';
import { notFoundView } from '../../../src/lib/server/views/notFound.js';

describe('notFoundView', () => {
  it('affiche le message', () => {
    expect(notFoundView('Model "x" not found', '/admin')).toContain('Model &quot;x&quot; not found');
  });

  it('échappe le message', () => {
    expect(notFoundView('<script>', '/admin')).not.toContain('<script>');
  });

  it('renvoie vers le dashboard', () => {
    expect(notFoundView('x', '/admin')).toContain('href="/admin"');
  });

  it('respecte un basePath personnalisé', () => {
    expect(notFoundView('x', '/back/office')).toContain('href="/back/office"');
  });
});
