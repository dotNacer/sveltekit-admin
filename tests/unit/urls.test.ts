import { describe, it, expect } from 'vitest';
import { buildListUrl, hiddenParams } from '../../src/lib/server/query/urls.js';

function url(pathAndQuery: string): URL {
  return new URL(pathAndQuery, 'http://localhost');
}

describe('buildListUrl', () => {
  it('ajoute un nouveau param sur une URL sans query string', () => {
    expect(buildListUrl(url('/admin/post'), { q: 'hello' })).toBe('/admin/post?q=hello');
  });

  it('remplace un param existant', () => {
    expect(buildListUrl(url('/admin/post?q=old'), { q: 'new' })).toBe('/admin/post?q=new');
  });

  it('supprime un param quand la valeur du patch est null', () => {
    expect(buildListUrl(url('/admin/post?q=x&f.published=true'), { q: null })).toBe(
      '/admin/post?f.published=true'
    );
  });

  it('retire toujours `page` sauf si le patch le fixe explicitement', () => {
    expect(buildListUrl(url('/admin/post?page=3&q=x'), { q: 'y' })).toBe('/admin/post?q=y');
  });

  it('la pagination peut fixer `page` explicitement', () => {
    expect(buildListUrl(url('/admin/post?q=x'), { page: '2' })).toBe('/admin/post?page=2&q=x');
  });

  it('conserve les autres params non touchés par le patch', () => {
    expect(buildListUrl(url('/admin/post?f.published=true&q=x'), { q: 'y' })).toBe(
      '/admin/post?f.published=true&q=y'
    );
  });

  it('trie les clés pour une URL déterministe', () => {
    const withZ = buildListUrl(url('/admin/post?z=1'), { a: '2' });
    expect(withZ).toBe('/admin/post?a=2&z=1');
  });

  it('renvoie le pathname nu quand la query string finale est vide', () => {
    expect(buildListUrl(url('/admin/post?q=x'), { q: null })).toBe('/admin/post');
  });

  it('conserve plusieurs valeurs pour une même clé répétée', () => {
    const withRepeats = buildListUrl(url('/admin/post?__rel__tags=1&__rel__tags=2'), { q: 'x' });
    expect(withRepeats).toContain('__rel__tags=1');
    expect(withRepeats).toContain('__rel__tags=2');
  });

  it('un patch avec plusieurs clés s\'applique toutes ensemble', () => {
    expect(buildListUrl(url('/admin/post'), { q: 'x', 'f.published': 'true' })).toBe(
      '/admin/post?f.published=true&q=x'
    );
  });
});

describe('hiddenParams', () => {
  it('renvoie tous les params sauf ceux exclus et `page`', () => {
    const params = hiddenParams(url('/admin/post?q=x&f.published=true&page=2'), ['q']);
    expect(params).toEqual([{ name: 'f.published', value: 'true' }]);
  });

  it('exclut toujours `page` même sans le lister explicitement', () => {
    const params = hiddenParams(url('/admin/post?page=3&f.a=1'), []);
    expect(params).toEqual([{ name: 'f.a', value: '1' }]);
  });

  it('renvoie un tableau vide sans query string', () => {
    expect(hiddenParams(url('/admin/post'), [])).toEqual([]);
  });

  it('exclut plusieurs clés à la fois', () => {
    const params = hiddenParams(url('/admin/post?q=x&f.a=1&f.b=2'), ['q', 'f.a']);
    expect(params).toEqual([{ name: 'f.b', value: '2' }]);
  });

  it('préserve l\'ordre d\'apparition dans la query string (pas de tri ici)', () => {
    const params = hiddenParams(url('/admin/post?f.b=2&f.a=1'), []);
    expect(params).toEqual([
      { name: 'f.b', value: '2' },
      { name: 'f.a', value: '1' }
    ]);
  });
});
