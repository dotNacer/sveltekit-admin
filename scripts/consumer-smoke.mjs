/**
 * Éprouve le PAQUET PUBLIÉ, pas les sources.
 *
 * `example/` consomme la bibliothèque via le workspace pnpm : ce qu'il exerce,
 * ce sont les fichiers du dépôt. Rien ne garantissait jusqu'ici que ce qui part
 * réellement sur npm — le contenu du tarball, la carte `exports`, les
 * `peerDependencies` — fonctionne dans une application tierce.
 *
 * Ce script empaquette la bibliothèque, l'installe dans une COPIE de
 * `example/` posée hors du workspace (sinon pnpm/npm relierait les sources), la
 * construit avec Vite, la démarre, et l'interroge en HTTP.
 *
 * Chaque assertion vise une classe de panne distincte :
 *
 * 1. le shell de l'admin se rend        → les vues `.svelte` du tarball ont
 *    bien été compilées par le bundler du consommateur (elles sont publiées en
 *    source, pas en JS : un `import` Node direct échouerait, et c'est normal) ;
 * 2. la liste porte les contrôles P1     → la version publiée est bien la
 *    version courante, pas un `dist/` périmé ;
 * 3. une écriture aboutit                → le chemin POST complet fonctionne
 *    depuis un vrai navigateur, en-tête `Origin` compris ;
 * 4. deux tenants voient des lignes disjointes → `scope` tient dans le paquet ;
 * 5. une fiche d'un autre tenant ne rend aucune donnée ;
 * 6. le sous-chemin `sveltekit-admin/adapters/drizzle` se résout → la carte
 *    `exports` est correcte pour une entrée qu'aucune application d'exemple
 *    n'importe, donc que rien d'autre ne couvre.
 *
 * `--keep` conserve le répertoire temporaire pour inspection.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEEP = process.argv.includes('--keep');
const PORT = 4599;
const BASE = `http://localhost:${PORT}`;
const ROOT = process.cwd();

let step = 'setup';
const failures = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `[${step}] ${command} ${args.join(' ')} a échoué (${result.status})\n` +
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-4000)
    );
  }
  return result.stdout ?? '';
}

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Ids des lignes cochables de la liste : la sortie HTML fait foi. */
function rowIds(html) {
  return [...html.matchAll(/name="ids" value="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Valeur actuellement sélectionnée d'un <select name="…"> donné.
 *
 * Le run précédent prenait la première balise `<option>` de TOUT le
 * document, qui n'appartient pas forcément au `<select>` visé — une autre
 * relation, un filtre, ou même l'option non sélectionnée d'un tenant
 * différent. On isole d'abord le `<select>` par son attribut `name`, puis on
 * lit l'option marquée `selected` à l'intérieur — c'est la valeur que le
 * serveur a effectivement rendue pour le tenant courant, celle qu'un vrai
 * navigateur soumettrait sans y toucher.
 */
function selectedOptionValue(html, selectName) {
  const select = html.match(new RegExp(`<select[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)</select>`));
  if (!select) return undefined;
  const selected = select[1].match(/<option value="([^"]+)"[^>]*selected/);
  return selected?.[1];
}

const workdir = mkdtempSync(join(tmpdir(), 'ska-consumer-'));
const appdir = join(workdir, 'app');
let server;

try {
  step = 'package';
  console.log('→ construction du paquet');
  run('pnpm', ['run', 'package'], { cwd: ROOT });

  step = 'pack';
  console.log('→ npm pack');
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', workdir], { cwd: ROOT }));
  const tarball = join(workdir, packed[0].filename);

  step = 'copy';
  console.log('→ copie de example/ hors du workspace');
  cpSync(join(ROOT, 'example'), appdir, {
    recursive: true,
    filter: (src) =>
      !src.includes('node_modules') && !src.includes('.svelte-kit') && !src.endsWith('dev.db')
  });

  const manifestPath = join(appdir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['sveltekit-admin'] = `file:${tarball}`;
  // Retiré volontairement : `packageManager` renverrait l'installation vers
  // pnpm, qui rebrancherait le workspace du dépôt et masquerait le tarball.
  delete manifest.packageManager;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  step = 'install';
  console.log('→ npm install du tarball');
  run('npm', ['install', '--no-audit', '--no-fund'], { cwd: appdir });

  step = 'prisma';
  console.log('→ base de données de démonstration');
  run('npx', ['prisma', 'db', 'push', '--skip-generate'], { cwd: appdir });
  run('npx', ['prisma', 'generate'], { cwd: appdir });
  run('npx', ['tsx', 'prisma/seed.ts'], { cwd: appdir });

  step = 'build';
  console.log('→ vite build');
  run('npx', ['vite', 'build'], { cwd: appdir });

  step = 'serve';
  console.log('→ démarrage du serveur');
  // Filet de sécurité : un run précédent qui aurait planté avant le `finally`
  // (process tué à la dure, machine éteinte en plein run…) peut laisser un
  // `vite preview` orphelin sur ce port fixe. Le nettoyage normal se fait
  // dans le `finally` ci-dessous ; ceci couvre le cas où CE run hérite d'un
  // orphelin laissé par un run antérieur, pas par lui-même. `fuser` renvoie
  // un statut non nul quand le port est libre — c'est le cas attendu, pas
  // une erreur à faire remonter.
  spawnSync('fuser', ['-k', `${PORT}/tcp`], { stdio: 'ignore' });
  // `detached: true` place `vite preview` (et le processus `npx` qui le lance)
  // dans son propre groupe de processus : `server.kill()` seul ne tue que
  // `npx`, pas l'enfant `vite` qu'il a exec'é, qui restait alors lié au port
  // fixe (4599) bien après la fin du script. Un run ultérieur sur la même
  // machine pouvait alors dialoguer avec CE serveur orphelin — construit sur
  // une DB de démo antérieure, dans un état différent du seed frais — plutôt
  // qu'avec celui tout juste démarré. `process.kill(-pid, …)` cible le groupe
  // entier, pas seulement `npx`.
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: appdir,
    stdio: 'ignore',
    detached: true
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${BASE}/`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('[serve] le serveur n’a jamais répondu');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  step = 'assertions';
  console.log('→ vérifications');

  const dashboard = await (await fetch(`${BASE}/admin`)).text();
  check(
    'le shell de l’admin se rend depuis le paquet',
    dashboard.includes('Multi-tenant demo') && dashboard.includes('ska-layout')
  );

  const list = await (await fetch(`${BASE}/admin/user`)).text();
  check('la liste rend sa table', list.includes('ska-table'));
  check('les en-têtes sont triables', list.includes('aria-sort='));
  check('la sélection multiple est présente', list.includes('Delete selected'));
  check('le lien d’évitement est présent', list.includes('ska-skip'));

  const [firstId] = rowIds(list);
  const editForm = await (await fetch(`${BASE}/admin/user/${firstId}`)).text();
  const organizationId = selectedOptionValue(editForm, 'organizationId');
  const written = await fetch(`${BASE}/admin/user/${firstId}`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `_action=update&email=smoke@packaged.test&name=Smoke&organizationId=${organizationId}`,
    redirect: 'manual'
  });
  check('une écriture répond par une redirection', written.status === 303, `reçu ${written.status}`);
  const afterWrite = await (await fetch(`${BASE}/admin/user`)).text();
  check('la valeur écrite est relue', afterWrite.includes('smoke@packaged.test'));

  const acme = rowIds(await (await fetch(`${BASE}/admin/user`, { headers: { cookie: 'tenant=acme' } })).text());
  const globex = rowIds(await (await fetch(`${BASE}/admin/user`, { headers: { cookie: 'tenant=globex' } })).text());
  check('chaque tenant voit des lignes', acme.length > 0 && globex.length > 0);
  check(
    'les deux tenants voient des lignes disjointes',
    acme.every((id) => !globex.includes(id)),
    `acme=${acme.length} globex=${globex.length}`
  );

  const crossTenant = await (await fetch(`${BASE}/admin/user/${globex[0]}`, {
    headers: { cookie: 'tenant=acme' }
  })).text();
  check(
    'la fiche d’un autre tenant ne rend aucune donnée',
    !crossTenant.includes('value="') || crossTenant.includes('not found')
  );

  step = 'exports';
  const resolved = spawnSync(
    'node',
    ['--input-type=module', '-e', "import.meta.resolve('sveltekit-admin/adapters/drizzle'); console.log('ok')"],
    { cwd: appdir, encoding: 'utf8' }
  );
  check(
    'le sous-chemin adapters/drizzle se résout',
    resolved.status === 0,
    (resolved.stderr ?? '').trim().split('\n')[0]
  );
} finally {
  // Cible le groupe de processus entier (`-pid`), pas seulement `npx` : voir
  // le commentaire au démarrage du serveur plus haut. `server` peut être
  // `undefined` si une étape antérieure a levé.
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // Le groupe a déjà disparu (serveur jamais démarré, ou déjà mort) —
      // rien à nettoyer.
    }
  }
  if (!KEEP) rmSync(workdir, { recursive: true, force: true });
  else console.log(`\nrépertoire conservé : ${workdir}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} vérification(s) en échec sur le paquet publié :`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nLe paquet publié fonctionne dans une application consommatrice réelle.');
