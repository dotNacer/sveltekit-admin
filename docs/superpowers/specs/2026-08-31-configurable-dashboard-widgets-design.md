# Widgets de dashboard configurables (design)

## Contexte

Le dashboard est figé. `handler.ts` (branche `route.view === 'dashboard'`) compte
chaque modèle visible, additionne les totaux, et passe le tout à
`views/Dashboard.svelte`, qui rend toujours la même page : deux cartes globales
(nombre de modèles, total d'enregistrements) puis une grille d'une carte par
modèle.

Rien n'est configurable — ni l'ordre, ni le contenu, ni le titre — et la page
n'est pas un point d'entrée utile : elle annonce des chiffres et n'offre aucune
action. Pour créer un enregistrement il faut aller sur la liste, puis cliquer
« Create ». Pour voir ce qui a bougé, il faut ouvrir chaque liste une par une.
À quinze modèles, la grille plate devient un mur de cartes sans hiérarchie.

C'est l'item P2 « Configurable dashboard widgets » de la roadmap
[#25](https://github.com/dotNacer/sveltekit-admin/issues/25). L'item V1+
« Advanced plugin dashboard widgets » reste distinct et hors périmètre : ici,
tout est déclaratif et passe par la config, sans surface de rendu arbitraire.

## Objectif

1. **Composer le dashboard depuis la config** : choisir quels widgets
   s'affichent, dans quel ordre, avec quels titres, et pouvoir regrouper les
   modèles en sections nommées.
2. **Faire du dashboard une vraie interface** : actions rapides, compteurs
   filtrés qui pointent vers la liste correspondante, blocs d'enregistrements
   récents.
3. **Ne rien coûter à qui ne configure rien** : la page par défaut est
   relookée et gagne les actions rapides, mais n'émet pas une requête de plus
   qu'aujourd'hui.

Parité stricte Prisma / Drizzle (règle de travail 4 de l'issue #25).

## Hors périmètre

- **Widgets de plugin.** Un `AdminPlugin` ne gagne pas de slot dashboard ici ;
  c'est l'item V1+ « Advanced plugin dashboard widgets », et il suppose une
  surface de rendu HTML arbitraire que cette feature n'ouvre pas.
- **Widgets à callback** (`(ctx) => valeur`). Écartés pour la même raison :
  aucune validation possible au boot, et l'API plugin couvre déjà le besoin de
  rendu sur mesure.
- **Graphiques / séries temporelles.** Un compteur est un scalaire ; agréger sur
  un axe temporel demanderait un `groupBy` au `DataAdapter`, donc une méthode de
  plus à porter sur les deux adapters. Pas justifié par cet item.
- **Dashboard par utilisateur / persistance de préférences.** La config est
  statique, définie par le développeur, pas par l'utilisateur final.
- **Filtres à date glissante** (« créés cette semaine »). Le langage de filtre
  retenu est celui de la liste, qui a ses raccourcis de date validés ; rien
  au-delà.

## Approches écartées

1. **Objet structuré par préoccupation** (`dashboard: { stats, sections,
   counters, recent }`). Plus lisible à la lecture, mais l'ordre des blocs
   redevient implicite — figé dans le template — et deux blocs de même genre
   demandent un sous-tableau de plus. L'ordre est précisément ce qu'on veut
   rendre configurable.
2. **AST `Filter` pour les compteurs** (`{ op: 'eq', field, value }`, le type
   déjà exporté). Plus expressif que la liste : `OR` imbriqués, champs non
   filtrables, champs sensibles. Cette expressivité est le problème — il
   faudrait ré-appliquer à la main l'exclusion des champs sensibles, soit un
   **deuxième** endroit qui décide de ce qui est filtrable, exactement la classe
   de dérive que `isSensitiveFieldName` existe pour empêcher. Et le lien « voir
   la liste » ne serait plus dérivable du filtre.
3. **Filtre en fonction `(locals) => Filter`.** Souple (dates glissantes), mais
   invalidable au boot et même surface de risque que l'AST.

**Retenu** : un tableau ordonné de widgets typés, dont les filtres s'expriment
dans la query string que la vue liste comprend déjà.

## Surface de config

```ts
dashboard?: {
  title?: string;      // défaut « Dashboard »
  subtitle?: string;   // défaut « Welcome to your admin panel »
  widgets?: DashboardWidget[];
};

type DashboardWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; models?: string[] }
  | { type: 'count'; model: string; label: string; query?: string }
  | {
      type: 'recent';
      model: string;
      title?: string;
      limit?: number;              // 1..50, défaut 5
      sort?: string;
      dir?: 'asc' | 'desc';
    };
```

Exemple :

```ts
dashboard: {
  widgets: [
    { type: 'stats' },
    { type: 'count', model: 'Order', label: 'Commandes en attente', query: 'f.status=PENDING' },
    { type: 'count', model: 'Order', label: 'Gros paniers', query: 'f.total__gte=100' },
    { type: 'models', title: 'Contenu', models: ['Post', 'Comment'] },
    { type: 'models', title: 'Facturation', models: ['Order', 'Invoice'] },
    { type: 'recent', model: 'User', limit: 5 }
  ];
}
```

**Défaut, sans clé `dashboard`** : `[{ type: 'stats' }, { type: 'models' }]`,
c'est-à-dire le contenu d'aujourd'hui — plus la nouvelle mise en page et les
actions rapides, qui sont des liens et ne coûtent aucune requête. Personne ne
voit son dashboard ralentir en montant de version.

`widgets: []` rend un dashboard vide. C'est un choix légitime (un consommateur
qui veut une page d'accueil nue), pas une erreur de config.

Un widget peut être répété : deux `count` sur le même modèle avec deux filtres,
deux `models` disjoints pour former des sections. Aucune contrainte d'unicité.

## Architecture

```
Boot (createAdminRuntime, une fois)
   │
   └─ resolveDashboardWidgets(runtime)
        ├─ valide chaque widget            → AdminConfigError si invalide
        ├─ parse chaque `query` via parseListQuery → ListQuery mémorisé
        └─ normalise le lien liste de chaque `count`
                       │
                       ▼
              ResolvedDashboard  (stocké sur AdminRuntime)

Requête GET /admin
   │
   ├─ loadDashboardData(runtime, resolved, event)
   │     ├─ compteur mémoïsé par modèle (un countRecords par modèle et par requête)
   │     ├─ count widget  : buildWhere(listQuery, scope) → countRecords
   │     └─ recent widget : listRecords(scope, orderBy, take) → redactForAudit
   │
   ├─ groupWidgetRows(données)   [pure]
   │     └─ replie les widgets-cartes adjacents dans une même rangée
   │
   └─ render(Dashboard, { rows, title, subtitle, basePath })
```

Le tout vit dans un nouveau module `src/lib/server/dashboard.ts`. `handler.ts`
fait déjà 681 lignes ; sa branche dashboard se réduit à deux appels.

### Validation au boot

`resolveDashboardWidgets` est appelée depuis `createAdminRuntime`, aux côtés de
`validateListFilterConfig` et `resolvePluginRegistry`, et lève un
`AdminConfigError` — le patron déjà en place. Elle refuse :

| Cas | Raison |
|---|---|
| `type` inconnu | Faute de frappe silencieuse sinon. |
| `model` inconnu, ou listé dans `exclude` | Un modèle exclu ne doit pas redevenir visible par la porte de derrière — même règle que partout ailleurs. |
| Une entrée de `models[]` inconnue ou exclue | Idem. |
| `query` dont un filtre est rejeté par `parseListQuery` | Champ inconnu, non filtrable, sensible, ou valeur incoercible. |
| `sort` hors des colonnes réellement rendues par la liste | Même whitelist que `?sort=`, via `resolveListColumns`. |
| `limit` non entier ou hors 1..50 | — |
| `label` vide sur un `count` | Une carte sans nom n'a pas de sens. |

Le point central est la ligne `query`. Le widget est parsé par **la fonction de
la liste**, avec les `searchFields` et `filterableFields` de ce modèle :

- il ne peut donc rien exprimer que la liste ne sache montrer ;
- la whitelist d'opérateurs et l'exclusion via `isSensitiveFieldName`
  s'appliquent sans deuxième implémentation ;
- une faute de frappe échoue **au démarrage**, pas en silence à l'écran ;
- le lien « voir » du compteur pointe vers une liste dont le total égale
  forcément le chiffre affiché.

Le `ListQuery` résultant est mémorisé dans le widget résolu : une requête HTTP
ne re-parse plus rien.

Seuls `q=` et `f.*=` sont acceptés dans une `query` de widget. Tout autre
paramètre (`page`, `perPage`, `sort`, `dir`, ou n'importe quelle clé inconnue)
est refusé au boot : aucun n'a d'effet sur un comptage, et les accepter
laisserait croire le contraire. Le lien « voir » est construit à partir de la
query normalisée — clés triées, comme `buildListUrl` le fait déjà pour rester
déterministe — sous la forme `${basePath}/${model.toLowerCase()}?${query}`,
c'est-à-dire la convention de segment déjà utilisée par les cartes modèle.

### Chargement par requête

`loadDashboardData` construit un compteur **mémoïsé par nom de modèle** pour la
requête en cours. `stats` (qui compte tous les modèles visibles) et deux widgets
`models` qui se recouvrent n'émettent qu'un `countRecords` par modèle. Sans
cette mémoïsation, « composer son dashboard » se paierait en requêtes
dupliquées.

`stats` reste global : il compte tous les modèles visibles et la somme de leurs
lignes, indépendamment des sous-ensembles choisis dans les widgets `models`.
C'est la carte « vue d'ensemble » ; la restreindre au sous-ensemble d'un autre
widget la rendrait dépendante de l'ordre du tableau.

L'ordre d'un `recent` est `defaultSortOf(model)` quand il est configuré, sinon
la clé primaire décroissante (le défaut de l'adapter) — jamais une devinette sur
un champ nommé `createdAt`. C'est la même position que celle prise pour
`defaultSort` : deviner réordonnerait silencieusement, et la devinette
divergerait de ce que la vue rend. Un `sort`/`dir` explicite sur le widget
l'emporte.

### Tolérance aux erreurs

Le `try/catch` actuel autour des counts (« modèle absent de la base » — le cas
du développeur qui n'a pas encore migré) est conservé et appliqué à l'identique
aux nouveaux widgets : un `count` en échec affiche 0, un `recent` en échec
affiche sa liste vide. Pas de nouvelle politique d'erreur inventée pour
l'occasion.

## Invariants de sécurité

1. **Chaque lecture de widget compose `modelScopeFrom` en `AND`**, comme les
   counts actuels et comme toute autre lecture servie par le handler.

2. **Les counts du dashboard composent aussi `listWhere`.** *Changement de
   comportement assumé.* Aujourd'hui une carte modèle peut afficher 40 alors que
   la liste, scopée par `listWhere`, en montre 12 : le compteur annonce déjà des
   lignes que la vue ne montrera jamais. Un widget `count` liant vers une liste
   dont le total doit égaler le compteur rend cette incohérence visible et
   fausse. La composition est strictement plus restrictive — jamais dans le sens
   de la fuite — mais elle change un chiffre affiché chez un consommateur qui
   utilise `listWhere`. Ça se dit dans le changeset.

3. **Les lignes d'un `recent` passent par `redactForAudit`** (`hidden` +
   `isSensitiveFieldName`) et seuls le label (`resolveLabel`) et la clé primaire
   sont rendus. Pas de colonne arbitraire à l'écran, donc pas de nouveau canal
   d'exposition — même position que pour les payloads de plugin.

4. **Un `:id` hors scope n'existe pas par construction** dans un `recent` : la
   requête est scopée, pas filtrée après coup.

5. **Un modèle exclu reste invisible**, refusé au boot plutôt que filtré au
   rendu.

6. Les chaînes de config (`title`, `label`) sont interpolées dans des templates
   Svelte, donc échappées ; aucune ne transite par une concaténation HTML brute.

## Rendu

- `Dashboard.svelte` devient un dispatcher sur les rangées produites par
  `groupWidgetRows` ; plus rien de figé dedans.
- `StatCard.svelte` gagne un `href?` optionnel — un widget `count` lie vers sa
  liste filtrée, les stats globales non — et une icône supplémentaire. Un seul
  composant carte-chiffre, pas deux familles parallèles.
- `ModelCard.svelte` gagne l'action rapide « + Nouveau » vers `/{model}/new`.
  La carte est aujourd'hui un `<a>` entier : on ne peut pas y imbriquer un
  second lien (HTML invalide, navigation au lecteur d'écran cassée). Elle
  devient un `<article>` avec le titre en lien principal étendu à toute la carte
  (`::after` en overlay) et le lien « + Nouveau » au-dessus en `z-index` — le
  motif *stretched link*, deux liens aux noms accessibles distincts.
- Nouveau `RecentPanel.svelte` : titre (défaut « Derniers <Label> »), N lignes
  `label → /{model}/{id}`, un lien « voir tout » vers la liste, et un état vide
  explicite.
- `theme.ts` reçoit les styles, comme tout le reste. Pas de framework ; la
  palette slate et les rayons actuels sont conservés. Le relookage porte sur la
  hiérarchie : vrai en-tête de page, titres de section, grille `auto-fill` qui
  tient à quinze modèles, et le comportement responsive déjà posé par le pass
  a11y.

`groupWidgetRows` replie les widgets-cartes adjacents (`stats` → 2 cartes,
`count` → 1 carte) dans une même rangée. Sans ce repli, deux `count` consécutifs
tomberaient dans deux `<section>` distinctes et s'empileraient verticalement au
lieu de s'aligner. La logique est pure et testée en table ; elle ne vit pas dans
le template.

## Tests

Le gate 100 % (lignes / branches / fonctions / statements sur `src/lib/**`)
s'applique : chaque branche ajoutée a un test réel, pas de `exclude`, pas de
`v8 ignore`.

- **Validation** — un test par refus du tableau ci-dessus.
- **Résolution** — défaut sans config, `widgets: []`, query normalisée, lien de
  liste construit.
- **`groupWidgetRows`** — pure, testée en table.
- **Chargement (`prismaMock`)** — la mémoïsation est assertable directement :
  deux widgets sur le même modèle ⇒ **un seul** appel `countRecords`. C'est le
  genre de propriété qui se casse silencieusement plus tard sans test dédié.
- **Sécurité** — un `count` sur un modèle scopé ne compte que les lignes du
  tenant ; un `recent` ne rend ni champ sensible ni champ `hidden` ; le compteur
  d'une carte et le total de la liste vers laquelle elle pointe coïncident quand
  `listWhere` est posé.
- **Intégration** (`handler.db.test.ts`, SQLite jetable) — un dashboard
  configuré rendu de bout en bout, et la parité Drizzle sur les mêmes widgets.

## Découpage en PRs

Une behavior cohérente par PR (règle de travail 2), chacune avec son changeset.

| PR | Contenu | Bump |
|---|---|---|
| 1 | Relookage + actions rapides. Chemin par défaut, zéro config, zéro requête en plus. | minor |
| 2 | `dashboard.widgets` + validation au boot + widgets `stats` et `models` (ordre, sections, masquage). | minor |
| 3 | Widget `count` : langage de query, validation, lien vers la liste filtrée, et la composition de `listWhere` dans les counts (invariant 2). | minor |
| 4 | Widget `recent` : rédaction, tri, état vide. | minor |

La PR 1 est autonome et livrable même si la suite est abandonnée. Les PR 3 et 4
dépendent de la 2. La doc (`docs/`) et l'`example/` sont mis à jour dans la PR
qui introduit la capacité concernée, pas repoussés en fin de chaîne.
