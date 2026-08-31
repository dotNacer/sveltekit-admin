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
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: appdir,
    stdio: 'ignore'
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
  const written = await fetch(`${BASE}/admin/user/${firstId}`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '_action=update&email=smoke@packaged.test&name=Smoke',
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
  server?.kill();
  if (!KEEP) rmSync(workdir, { recursive: true, force: true });
  else console.log(`\nrépertoire conservé : ${workdir}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} vérification(s) en échec sur le paquet publié :`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nLe paquet publié fonctionne dans une application consommatrice réelle.');
