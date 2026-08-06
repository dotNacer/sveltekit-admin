import { describe, it, expect } from 'vitest';
import { notFoundView } from '../../../src/lib/server/views/notFound.js';

describe('notFoundView', () => {
  it('affiche le message', () => {
    expect(notFoundView('Model "x" not found')).toContain('Model &quot;x&quot; not found');
  });

  it('échappe le message', () => {
    expect(notFoundView('<script>')).not.toContain('<script>');
  });

  // Défaut connu (corrigé en tâche 15) : le lien "Back to Dashboard" est émis
  // avec href="" quel que soit le message, faute d'un paramètre basePath.
  it('émet un href vide pour le lien de retour (défaut connu, corrigé en tâche 15)', () => {
    expect(notFoundView('anything')).toContain('href="" class="ska-btn ska-btn--secondary"');
  });
});
