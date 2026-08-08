import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import NotFound from '../../../src/lib/server/views/NotFound.svelte';

const renderNotFound = (message: string, basePath: string) =>
  render(NotFound, { props: { message, basePath } }).body;

describe('NotFound.svelte', () => {
  it('affiche le message', () => {
    expect(renderNotFound('Model "x" not found', '/admin')).toContain('Model "x" not found');
  });

  it('échappe le message', () => {
    expect(renderNotFound('<script>', '/admin')).not.toContain('<script>');
  });

  it('renvoie vers le dashboard', () => {
    expect(renderNotFound('x', '/admin')).toContain('href="/admin"');
  });

  it('respecte un basePath personnalisé', () => {
    expect(renderNotFound('x', '/back/office')).toContain('href="/back/office"');
  });
});
