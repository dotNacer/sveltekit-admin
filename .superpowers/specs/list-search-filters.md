# Design — Search and filters on list views

sveltekit-admin v0.5.0 (target)

Written by Opus 5, reviewed and implemented by the assistant. Kept in the
repo verbatim (French, like `relations.md`) as the source of truth for
this feature's design decisions.

---

```
================================================================
DESIGN — Recherche et filtres sur les listes
sveltekit-admin v0.5.0 (cible)
================================================================

----------------------------------------------------------------
0. CHALLENGE DE L'EXISTANT (à lire avant le reste)
----------------------------------------------------------------

Quatre choses, dont une faille.

(a) `?filter=field:value` est une faille de sécurité aujourd'hui,
    pas seulement une dette de design.

      const targetField = model.fields.find(f => f.name === filterField);
      filterWhere = { [filterField]: ... };

    `targetField` sert UNIQUEMENT à choisir la coercition. Il n'y a
    aucune whitelist. Donc :

      /admin/user?filter=passwordHash:$2b$10$abc

    est accepté. La liste ne montre pas la colonne (fix 0.3.0), mais
    elle répond "1 résultat" ou "0 résultat". C'est un oracle : on
    bruteforce un hash caractère par caractère si le mock/provider
    supporte `contains`, ou on confirme une valeur devinée en
    égalité. Même chose pour un `resetToken`. La contrainte n°5 de
    ta demande est donc déjà violée en prod, par le code que cette
    feature doit étendre.
    → Le premier livrable n'est pas la barre de recherche. C'est la
      whitelist. Elle est le socle des deux fonctionnalités.

(b) `?filter=` a aussi un bug de correction : seul `Int` est coercé.
    `?filter=published:true` envoie la string "true" à Prisma sur un
    Boolean → P2009/P2007 → 500. Un `Float`, un `BigInt`, un
    `DateTime` : idem. Aujourd'hui ça ne pète pas parce que
    `RelatedBlock` ne génère que des FK Int/String. Dès qu'un
    utilisateur bricole l'URL, c'est un 500. Toute URL forgée doit
    dégrader, jamais lever.

(c) `{ ...configWhere, ...filterWhere }` (spread) est le prochain
    IDOR. Si le scoping développeur est `{ tenantId: 3 }` et que le
    filtre porte sur `tenantId`, le spread écrase le scoping. Ce
    n'est pas hypothétique : `tenantId`/`ownerId` sont exactement le
    genre de champ qu'on veut filtrer. Non négociable : la
    composition se fait en `AND: [...]`, jamais par spread. Le
    scoping est toujours l'élément [0] du tableau.

(d) Le parser ne connaît pas les enums. Sans ça, pas de filtre par
    choix, qui est LE filtre le plus utile de Django après le
    Boolean. Il faut parser les blocs `enum` et poser
    `field.enumName`. ~30 lignes. C'est un prérequis, pas une
    option. Bonus collatéral gratuit : `FieldInput.svelte` pourra
    rendre un `<select>` au lieu d'un `<input type=text>` — mais
    c'est HORS SCOPE de cette feature, on expose juste la donnée.

Non-objectif déclaré, à écrire dans la doc pour ne pas y revenir à
chaque issue : le TRI de colonne n'existe pas et n'est pas dans
cette feature (§7). Le paramètre `o` est réservé dès maintenant.


----------------------------------------------------------------
1. PÉRIMÈTRE — ce que "chercher et filtrer" veut dire ici
----------------------------------------------------------------

Traduction de la demande en trois capacités distinctes, à ne pas
confondre :

  1. Recherche texte libre    — un champ, plusieurs colonnes, OR
  2. Filtres par facette      — plusieurs champs, AND, valeurs
                                discrètes ou plages
  3. Tri                      — HORS SCOPE (§7)

Les deux premières composent dans une seule URL, avec la
pagination. C'est le contrat.

Ce qui n'est PAS dans la v1, et pourquoi :
  - filtrer par un champ du modèle LIÉ (`author.name contains x`) :
    nested where, surface d'attaque et coût de jointure non
    maîtrisés. On filtre par la FK. §6.
  - recherche full-text (tsvector, FTS5) : dépend du provider,
    demande une migration, le projet ne gère pas les migrations.
  - filtres sauvegardés / vues nommées : produit, pas plomberie.
  - export CSV du résultat filtré : tentant, mais autre feature.


----------------------------------------------------------------
2. RECHERCHE TEXTE
----------------------------------------------------------------

2.1 Quels champs — heuristique ET config, dans cet ordre

Config explicite gagne toujours :

    models: { Post: { searchFields: ['title', 'content'] } }

Sinon, heuristique. Le projet est "zéro config d'abord" (il génère
un admin depuis un schéma nu) : ne pas offrir de recherche par
défaut serait incohérent avec sa promesse. Mais l'heuristique doit
être CONSERVATRICE, sinon on scanne des colonnes `text` de 50 Ko.

    searchable(model) =
      champs de type String
      ∩ non sensibles (même prédicat que getDisplayFields)
      ∩ non relation, non isList
      ∩ nom ∈ labelFields ['name','title','label','email',
                           'username','slug']
      ∪ le champ id s'il est de type String  → NON (voir plus bas)

Décision : on réutilise EXACTEMENT la liste `labelFields` déjà
utilisée pour les labels de relation (§4 de relations.md). Une
seule heuristique dans le projet, pas deux qui divergent. Si tu la
changes pour les labels, la recherche suit.

Si l'intersection est vide → pas de barre de recherche rendue. Pas
de fallback "cherche dans tous les String" : c'est le comportement
qui fait des seq scans sur des colonnes `content`.

Décision sur l'ID : on n'inclut PAS l'id dans la recherche par
défaut, même String. Un `contains` sur un cuid n'a aucun sens et
empêche l'usage de l'index. Si le dev veut, il le met dans
`searchFields` — et là on le traite en `equals`, pas `contains`
(§2.4).

2.2 Un champ ou plusieurs — plusieurs, en OR

    { OR: [ {title:{contains:q}}, {content:{contains:q}} ] }

Django fait ça, c'est ce que l'utilisateur attend d'une barre de
recherche, et le coût d'implémentation est nul par rapport à un
seul champ. Aucune raison de faire moins.

2.3 Multi-mots : un seul terme en v1

`q = "jean dupont"` → un seul `contains "jean dupont"`.

Django fait mieux : split par espaces, AND entre les tokens, OR
entre les champs pour chaque token :

    AND[ OR[f1 contains "jean", f2 contains "jean"],
         OR[f1 contains "dupont", f2 contains "dupont"] ]

C'est objectivement meilleur (trouve "Jean Dupont" quand
`firstName` et `lastName` sont séparés). Mais :
  + coût : parsing des guillemets, tokens vides, limite du nombre
    de tokens (sinon 30 mots × 6 champs = 180 clauses LIKE, DoS
    trivial), et une explosion combinatoire dans le mock de test.
  - gain : réel mais pas sur le cas 80% (un titre, un email).

Décision : terme unique en v1, tokenisation en v2 derrière
`searchMode: 'phrase' | 'terms'` (défaut `phrase`). Le point
d'extension coûte zéro aujourd'hui : la construction du OR est déjà
isolée dans une fonction.

2.4 Opérateur par type de champ dans `searchFields`

    String                  → contains
    String @id / @unique    → equals  (voir 2.1)
    Int/BigInt/Float/Decimal→ equals si q se coerce, sinon la
                              clause est OMISE du OR
    tout le reste           → refusé à la config (erreur au boot)

Le "sinon omise" est important : `searchFields: ['title','id']` avec
`q="bonjour"` ne doit pas générer `{id: {equals: NaN}}`. Si TOUTES
les clauses sont omises, la recherche est un no-op (on n'ajoute
rien au where) — surtout PAS `{OR: []}`, qui en Prisma ne matche
rien du tout et donnerait une liste vide inexplicable. Piège réel.

2.5 Casse — le vrai sujet multi-provider

Statut par provider, pour `contains` :

    postgresql   LIKE, SENSIBLE à la casse. `mode:'insensitive'`
                 supporté (traduit en ILIKE).
    mysql        LIKE, dépend de la collation. Défaut moderne
                 utf8mb4_0900_ai_ci → déjà insensible.
                 `mode` NON supporté par Prisma sur MySQL.
    sqlite       LIKE, insensible pour l'ASCII par défaut, sensible
                 pour le non-ASCII (é/É). `mode` NON supporté.
    sqlserver    dépend de la collation. `mode` non supporté.
    mongodb      `mode:'insensitive'` supporté.
    cockroachdb  comme postgres.

Donc le seul provider où l'on DOIT émettre `mode` est postgres (et
mongo/cockroach). Et c'est aussi le seul où l'émettre à tort est
une erreur dure (Prisma lève `Unknown argument mode`).

Décision : détection automatique du provider.
Le parser lit déjà le `.prisma` : ajouter l'extraction du bloc
`datasource { provider = "..." }`. C'est 5 lignes de regex, dans le
style existant. On expose `schema.provider`.

    caseInsensitiveSearch =
        provider ∈ {postgresql, cockroachdb, mongodb}

Override explicite en config globale :
`search: { mode: 'auto' | 'insensitive' | 'default' }` (défaut
`auto`). Nécessaire pour trois cas réels : provider absent du
schéma (datasource par variable), pgbouncer/proxy exotique, et
surtout un Postgres où le dev a mis un index `citext` ou un index
fonctionnel `lower(col)` — auquel cas `mode:'insensitive'` casse
l'usage de l'index et il veut le désactiver.

À documenter noir sur blanc dans le README : sur SQLite, la
recherche est insensible à la casse en ASCII uniquement ;
"café" ne trouve pas "CAFÉ". C'est une limite du connecteur, pas
un bug de la lib. Ne pas tenter de la contourner (l'astuce
`lower()` demande du raw SQL, donc de sortir du client typé, donc
non).


----------------------------------------------------------------
3. FILTRES — UI
----------------------------------------------------------------

3.1 Position de principe : des liens, pas un formulaire

Django rend `list_filter` en `<ul><li><a href="?...">`. Ce n'est
pas un détail d'époque, c'est le bon choix ici :

  + zéro JS, strictement. Pas de "auto-submit onchange", pas de
    bouton "Appliquer" à cliquer.
  + un clic = un état, et l'état est dans l'URL, donc partageable,
    bookmarkable, et le bouton Retour du navigateur fonctionne.
  + l'a11y est native et parfaite (liste de liens).
  + le rendu est du HTML statique : trivial à tester en 100%.
  - illisible au-delà de ~20 valeurs.
  - une combinaison de 3 filtres = 3 clics et 3 allers-retours.

Le `<select onchange="this.form.submit()">` est un piège dans ce
projet. Il fait fonctionner l'UI SEULEMENT avec JS : sans JS, le
select change et rien ne se passe, aucune indication. C'est une
régression fonctionnelle silencieuse, exactement ce que la
doctrine "zéro JS" interdit. Rejeté.

3.2 Grille de décision par cardinalité

    n = nombre de valeurs distinctes proposables

    n connue statiquement (Boolean, enum)   → liens
    n ≤ filterLinkThreshold (défaut 20)      → liens
    20 < n ≤ selectThreshold (défaut 200)    → <select> DANS un
                                               <form method=GET>
                                               avec bouton
                                               "Appliquer" visible
    n > 200                                  → pas de filtre auto.
                                               Fallback : un
                                               <input> "ID" dans le
                                               form, ou rien si non
                                               configuré.

Le `<select>` + bouton explicite est acceptable : il fonctionne à
100% sans JS. Il est juste moins agréable. Le seuil `selectThreshold`
est déjà dans `relationDefaults` — on le réutilise, on n'en crée
pas un deuxième.

3.3 Le piège n°1 du form GET : la perte des autres paramètres

Un `<form method="GET">` REMPLACE toute la query string à la
soumission. Donc soumettre la barre de recherche efface les
filtres actifs, et soumettre un filtre efface `q`. C'est le bug
que tout le monde écrit la première fois.

Correctif obligatoire, dans les DEUX forms (recherche et select) :
émettre en `<input type="hidden">` tous les params actifs sauf
celui que le form contrôle, et sauf `page`.

    helper : hiddenParams(url, exclude: string[]) -> {name,value}[]

Testé isolément. C'est 15 lignes et ça évite trois issues.

Corollaire pour les liens de filtre : chaque `<a>` doit être
construit à partir de l'URL courante, en remplaçant sa propre clé
et en supprimant `page`. Un seul helper :

    buildListUrl(currentUrl, patch: Record<string,string|null>)
      - applique le patch (null = supprime la clé)
      - supprime toujours `page`
      - trie les clés (URLs déterministes → snapshots stables)

Toute construction d'URL de liste passe par lui. Y compris la
pagination, qui elle fait l'inverse : elle conserve tout et ne
change que `page`.

3.4 Anatomie du rendu

    ┌ Toolbar (au-dessus du tableau) ─────────────────────┐
    │ [ q .................... ] (Rechercher)             │
    │ 42 résultats · Filtres : Publié=Oui ×  Rôle=Admin × │
    │ (Tout effacer)                                      │
    └─────────────────────────────────────────────────────┘
    ┌ Sidebar filtres (droite, comme Django) ─────────────┐
    │ PAR STATUT      PAR RÔLE                            │
    │ • Tout          • Tout                              │
    │   Oui             Admin  ← actif (aria-current)     │
    │   Non             Éditeur                           │
    └─────────────────────────────────────────────────────┘

Décisions de rendu :
  - "Tout" est toujours la première entrée et pointe vers l'URL
    sans cette clé. C'est le seul moyen no-JS de retirer un filtre.
  - l'entrée active porte `aria-current="page"` (pas seulement une
    classe CSS).
  - les "chips" actifs en haut avec un × sont redondants avec la
    sidebar mais indispensables : sur mobile la sidebar passe sous
    le tableau, l'utilisateur ne voit pas pourquoi sa liste est
    vide.
  - le compteur de résultats vient du `count()` que `listRecords`
    fait DÉJÀ. Zéro requête supplémentaire.
  - état vide : "Aucun résultat pour ces critères" + lien "Tout
    effacer", jamais un tableau vide muet.
  - la sidebar n'est rendue que s'il y a au moins un filtre
    disponible. Pas de colonne vide.

3.5 Quels champs sont filtrables

Config explicite d'abord :

    models: { Post: { listFilter: ['published', 'status', 'authorId'] } }

Heuristique par défaut, volontairement étroite — Boolean et enum
uniquement :

  + leur domaine de valeurs est connu STATIQUEMENT depuis le
    schéma. Zéro requête pour rendre la sidebar. C'est décisif :
    une heuristique qui déclenche des `groupBy`/`findMany` sur
    chaque affichage de liste est un piège à perf qu'on ne pourrait
    plus retirer.
  + zéro faux positif : un Boolean se filtre toujours bien.

Explicitement PAS dans l'heuristique :
  - DateTime : aucune valeur discrète évidente, et les raccourcis
    Django sont un choix éditorial. Config explicite requise.
  - FK : demande de charger les options (requête + label + scoping).
    Config explicite requise. §6.
  - String / Int libres : cardinalité inconnue et potentiellement
    égale au nombre de lignes. Jamais en auto.

Et dans TOUS les cas, config comprise, un champ est écarté s'il
est : sensible (même prédicat), listé dans `hidden`, `isList`, de
type Json/Bytes, ou une relation non-to-one.


----------------------------------------------------------------
4. FORMAT DE LA QUERY STRING
----------------------------------------------------------------

4.1 Décision

    ?q=<terme>                  recherche texte
    ?f.<champ>=<valeur>         filtre, égalité
    ?f.<champ>__<op>=<valeur>   filtre, opérateur
    ?page=<n>                   existant, inchangé
    ?o=...                      RÉSERVÉ (tri, hors scope)
    ?filter=<champ>:<valeur>    LEGACY, déprécié (§4.4)

Exemples :

    /admin/post?q=svelte&f.published=true&f.authorId=12
    /admin/order?f.total__gte=100&f.createdAt=7d
    /admin/user?f.deletedAt__isnull=1

4.2 Pourquoi un param par filtre, et pas `?filter=a:1,b:2`

L'option "un seul param encodé" (`filter=a:1,b:2` ou
`filter=a:1&filter=b:2`) :
  - il faut inventer un échappement pour `:` et `,` dans les
    valeurs. Un titre contient une virgule une fois sur trois. On
    réinvente le CSV, avec ses bugs.
  - double encodage : la valeur est URL-encodée, puis le séparateur
    aussi. Illisible dans la barre d'adresse, pénible à débugger.
  - les `<form method=GET>` ne peuvent PAS produire ce format
    nativement. Il faudrait du JS pour assembler la query string.
    Rédhibitoire.

`f.champ=valeur` :
  + `URLSearchParams` fait tout le parsing et tout l'encodage. Zéro
    code d'échappement, donc zéro bug d'échappement.
  + c'est exactement ce qu'un `<input name="f.published">` produit.
    Les forms et les liens génèrent le même format.
  + le préfixe `f.` supprime toute collision avec `page`, `q`, `o`
    et tout param futur.
  + un champ Prisma ne peut pas contenir `.` ni `__` (identifiant
    Prisma = `[A-Za-z][A-Za-z0-9_]*`, et on interdit `__` dans le
    nom de champ au parsing du filtre) → le split est non ambigu :
    on coupe sur le PREMIER `__` après le préfixe.

Le `.` de `f.` plutôt que `f_` : `.` est illégal dans un
identifiant Prisma, donc `f.x` ne peut jamais être confondu avec un
champ nommé `f_x`. Autorisé dans une query string, aucun encodage
nécessaire.

4.3 Whitelist d'opérateurs — FERMÉE et dérivée du TYPE

C'est le point de sécurité de la §4. L'opérateur ne vient jamais
"de la query string vers Prisma". La query string fournit une
CHAÎNE, qu'on cherche dans une table statique indexée par le type
du champ. Inconnue → filtre ignoré.

    String     : (défaut=equals), contains, startsWith
    Int/BigInt/
    Float/
    Decimal    : (défaut=equals), gte, lte
    Boolean    : (défaut=equals)
    DateTime   : (défaut=jour), gte, lte
    enum       : (défaut=equals)
    tous       : isnull  (seulement si !isRequired)

Interdit explicitement et pour toujours : `not`, `notIn`, `mode`,
`AND`/`OR`/`NOT` imbriqués, tout chemin pointé (`f.author.name`),
tout opérateur passé en valeur. Aucun objet Prisma n'est jamais
construit à partir d'une clé venue de l'URL — on construit
`{[op]: coerced}` avec `op` pris dans la table, jamais dans
l'input.

À écrire dans le doc comme règle d'architecture : « la query string
sélectionne dans un ensemble fini, elle ne décrit jamais une
clause ».

4.4 Compatibilité avec `?filter=` legacy

Plan en trois temps, sans rien casser :

  0.5.0  `?filter=f:v` continue de fonctionner. Il est traduit en
         entrée du MÊME pipeline que `f.f=v` — donc il hérite de la
         whitelist, de la coercition correcte et de la composition
         AND. C'est un fix de sécurité au passage, pas seulement de
         la compat.
         `RelatedBlock.svelte` est migré pour émettre `?f.x=y`.
         Si `filter` ET un `f.*` sur le même champ sont présents :
         `f.*` gagne (le legacy est un fallback).
         Aucun avertissement runtime (bruit inutile pour un
         utilisateur qui a juste un vieux bookmark).
  0.6.0  `console.warn` une fois par process si `filter` est reçu.
  0.7.0  suppression.

Coût de la couche de compat : une fonction de 8 lignes qui mappe
`filter` vers la structure interne, + 3 tests. Négligeable. Ne pas
faire un breaking change pour ça.


----------------------------------------------------------------
5. CONSTRUCTION DU `where`
----------------------------------------------------------------

5.1 Module dédié

    src/lib/server/query/listQuery.ts

      parseListQuery(url, model, config, graph) -> ListQuery
      buildWhere(listQuery, scopeWhere)         -> PrismaWhere

`ListQuery` est une structure INERTE, sérialisable, sans rien de
Prisma dedans :

    type ListQuery = {
      q: string | null;
      searchFields: string[];          // déjà validés
      filters: ActiveFilter[];         // déjà validés + coercés
      ignored: IgnoredFilter[];        // pour l'UI (§5.4)
      page: number;
    };
    type ActiveFilter = {
      field: string;
      op: 'equals'|'contains'|'startsWith'|'gte'|'lte'|'isnull';
      value: unknown;                  // déjà au bon type JS
      raw: string;                     // pour re-rendre l'UI
    };

Deux fonctions pures, zéro I/O. C'est ce qui rend le 100% de
couverture trivial : tout le travail difficile est testable en
tableau d'entrées/sorties, sans mock Prisma. Même approche que
`relations.ts` en PR1 de la feature précédente, qui a bien marché.

`List.svelte` reçoit `ListQuery` (pas l'URL brute) pour rendre la
toolbar. Le composant ne parse rien.

5.2 Composition — AND explicite, jamais de spread

    buildWhere(lq, scope):
      const and = [];
      if (scope)            and.push(scope);         // TOUJOURS [0]
      for (f of lq.filters) and.push(clauseOf(f));   // un par filtre
      if (searchOr)         and.push({ OR: searchOr });

      return and.length === 0 ? undefined
           : and.length === 1 ? and[0]
           : { AND: and };

Trois propriétés qui en découlent :
  - le scoping développeur ne peut JAMAIS être écrasé, même si un
    filtre porte sur le même champ (§0.c). Deux clauses sur
    `tenantId` dans un AND = intersection, pas remplacement.
  - deux filtres sur le même champ (`f.price__gte` + `f.price__lte`)
    donnent deux entrées du AND. C'est correct et ça évite de
    fusionner des objets — donc pas de code de merge à tester.
  - `undefined` quand rien n'est actif → `listRecords` reçoit
    exactement ce qu'il reçoit aujourd'hui. Zéro régression sur le
    chemin nominal, et le `where` n'apparaît pas dans les snapshots
    de requêtes existants.

Le cas `and.length === 1` n'est pas de la micro-optimisation : il
garde les requêtes existantes littéralement identiques quand seul
le scoping est présent.

5.3 Coercition par type

    String              -> la string telle quelle
    Int / BigInt        -> /^-?\d+$/ strict, puis Number/BigInt.
                           PAS parseInt : parseInt("12abc") = 12,
                           parseInt("") = NaN silencieux. Le bug
                           actuel de la §0.b.
    Float / Decimal     -> /^-?\d+(\.\d+)?$/ puis Number. Decimal
                           passe en string à Prisma (il l'accepte,
                           et ça évite la perte de précision).
    Boolean             -> "true"/"1" -> true ; "false"/"0" -> false ;
                           autre -> échec.
    DateTime            -> §5.5
    enum                -> valeur ∈ liste des membres, sinon échec.
                           (Sans les enums parsés, on ne PEUT PAS
                           valider. D'où le prérequis §0.d.)
    isnull              -> "1"/"true" -> {equals:null},
                           "0"/"false" -> {not:null}
                           (seul usage autorisé de `not`, câblé en
                           dur, jamais issu de l'URL)

5.4 Cas limites — tout dégrade, rien ne lève

    valeur vide (`?f.x=`)        -> ignoré. Important : c'est ce
                                    qu'émet un <select> sur l'option
                                    "Tout". Le form GET produit
                                    naturellement `f.x=`, et ça doit
                                    signifier "pas de filtre".
    champ inconnu                -> ignoré + entrée `ignored`
    champ sensible / hidden      -> ignoré, traité EXACTEMENT comme
                                    inconnu. Message identique.
                                    Surtout pas "champ interdit" :
                                    ça confirmerait son existence.
    champ non filtrable (Json,
    liste, relation to-many)     -> ignoré
    opérateur hors whitelist     -> ignoré
    coercition échouée           -> ignoré + `ignored`
    `q` vide ou espaces          -> pas de clause de recherche
    `q` très long                -> tronqué à 200 caractères
    même clé répétée
    (`?f.x=1&f.x=2`)             -> on prend la PREMIÈRE
                                    (`searchParams.get`). Décision
                                    arbitraire mais déterministe et
                                    documentée.

`ignored` est rendu dans l'UI : « Filtre ignoré : champ "foo"
inconnu ». Deux raisons : (1) sinon l'utilisateur ne comprend pas
pourquoi son URL bricolée ne fait rien, (2) ça rend la branche
observable, donc testable proprement — pas de code mort à
justifier au coverage. Un champ sensible produit le même message
qu'un champ inexistant.

Ce que ça donne pour l'attaque de la §0.a :
`?filter=passwordHash:$2b$10$abc` → champ sensible → ignoré →
la liste est identique à la liste non filtrée. Plus d'oracle.

5.5 DateTime — raccourcis façon Django

    ?f.createdAt=today      -> [00:00 aujourd'hui, 00:00 demain[
    ?f.createdAt=7d         -> [J-6 00:00, 00:00 demain[
    ?f.createdAt=month      -> mois courant
    ?f.createdAt=year       -> année courante
    ?f.createdAt=2026-08-09 -> ce jour-là (intervalle, PAS égalité :
                               un DateTime stocke l'heure, `equals`
                               sur une date ne matche jamais rien.
                               Erreur classique.)
    ?f.createdAt__gte=...   -> borne, formats ISO date ou datetime
    ?f.createdAt__lte=...

Tous produisent `{gte, lt}`. Borne haute EXCLUSIVE (`lt`), jamais
`lte` : `lte 23:59:59` rate les millisecondes de la dernière
seconde. Bug classique en prod, invisible en test.

Fuseau horaire : tout est calculé en UTC en v1, et c'est DOCUMENTÉ.
"Aujourd'hui" pour un admin à Paris commence à 02:00 heure locale
en été. C'est faux mais prévisible. L'alternative (config `timezone`
+ conversion) demande `Intl`/Temporal et une matrice de tests
horrible. Option `timezone` en v2 ; poser dès maintenant un
`now: () => Date` injectable dans la config interne — sinon les
tests des raccourcis sont non déterministes et tu les verras
casser à minuit UTC en CI. Point non négociable pour le 100%.


----------------------------------------------------------------
6. RELATIONS
----------------------------------------------------------------

6.1 On filtre par la FK scalaire, point

    ?f.authorId=12   ->  { authorId: 12 }

Jamais `{ author: { name: { contains } } }` en v1 :
  - c'est une jointure dont on ne maîtrise ni le coût ni le plan.
  - c'est une deuxième grammaire d'URL (chemins pointés) à parser,
    valider et sécuriser — dont il faudrait vérifier la sensibilité
    des champs sur le modèle CIBLE, avec son propre scoping. Ça
    double la surface de sécurité pour un gain marginal.
  - le besoin réel ("les posts de Jean") est couvert par le filtre
    FK avec label résolu, qui est plus rapide et plus clair.

6.2 UI : labels résolus, pas des IDs

Un filtre `authorId` qui liste « 1, 2, 3 » est inutilisable. On
réutilise TOUT le mécanisme existant de `RelationSelect` :
`relationGraph.scalarToRelation` donne le champ relation, donc le
modèle cible, donc `labelTemplate` / `labelFields`.

Chargement des options :
  1. `count()` sur le modèle cible AVEC son `where` de scoping
  2. si count > selectThreshold (200) → pas de liste. Fallback :
     un `<input name="f.authorId">` dans le form. Pas de liste de
     10 000 liens dans une sidebar.
  3. sinon `findMany({ where: scope, select: champs du label,
     orderBy })`
  4. rendu en liens (≤20) ou en `<select>` (§3.2)

Coût : 2 requêtes par filtre FK affiché. Acceptable parce que c'est
opt-in (config explicite, jamais heuristique — §3.5). C'est
précisément pourquoi l'heuristique auto exclut les FK.

6.3 Doctrine IDOR appliquée aux filtres

Trois points, tous nécessaires :

  a. Les OPTIONS proposées passent par le `where` de scoping de la
     relation. Sinon la sidebar énumère tous les utilisateurs de
     tous les tenants. C'est la fuite la plus évidente.
  b. La VALEUR ACTIVE (le chip « Auteur = Jean ») est résolue par un
     `findFirst({ where: { AND: [ {id: v}, scope ] } })`. Si null,
     on affiche l'ID brut, pas de label. Sans ce AND, on a un
     oracle : je forge `?f.authorId=999`, la liste est vide (bon),
     mais le chip m'affiche « Auteur = Alice Dupont » et je viens
     d'extraire le nom d'un utilisateur d'un autre tenant. C'est le
     piège subtil de cette feature — la fuite passe par l'UI, pas
     par les données listées.
  c. Un ID hors scope n'a PAS besoin d'être rejeté en 400 : le
     `where` du modèle listé s'applique de toute façon (§5.2), la
     liste est vide. Filtrer sur une valeur inatteignable est
     inoffensif tant que (b) est respecté. Ne pas ajouter de
     validation d'existence ici : requête inutile sur le chemin
     chaud.

6.4 Modèle cible masqué (`hidePivotTables`, exclusions)

Si le modèle cible est exclu de l'admin : le filtre FK reste
possible en config explicite, mais les labels ne sont pas des
liens (il n'y a pas de page où aller). Jamais proposé en auto.


----------------------------------------------------------------
7. ÉTAT, PAGINATION, TRI
----------------------------------------------------------------

7.1 Reset de la pagination — OUI, toujours

Tout changement de `q` ou d'un filtre supprime `page`. Sinon :
page 7, on filtre, 3 résultats, page vide, l'utilisateur croit que
le filtre est cassé. C'est garanti structurellement par
`buildListUrl` qui supprime `page` (§3.3) — pas par de la
discipline au call site.

Le formulaire de recherche n'émet pas de hidden `page`. Idem.

7.2 Pagination cohérente

Les liens Précédent/Suivant conservent `q` et tous les `f.*`.
Aujourd'hui `List.svelte` construit `?page=N` à la main : à migrer
vers `buildListUrl(url, {page})`. C'est un changement de props du
composant (il lui faut l'URL courante ou le `ListQuery`) → adapter
tous les call sites et leurs tests, comme demandé en contrainte 8.

7.3 Tri — HORS SCOPE, déclaré

Le tri de colonne n'existe pas dans le projet et n'est pas dans
cette feature. Raisons : c'est une feature indépendante (en-têtes
cliquables, whitelist de champs triables, tri multiple, gestion de
l'ordre stable avec pagination — un `orderBy` non déterministe
produit des doublons entre pages, bug classique).

Ce qu'on fait quand même maintenant, pour zéro coût :
  - `o` est réservé dans la doc
  - `buildListUrl` le préserve comme n'importe quel autre param
  - `listRecords` garde son `orderBy` interne actuel

7.4 « Tout effacer »

Un lien vers le chemin nu du modèle. Rendu seulement si au moins
un critère est actif.


----------------------------------------------------------------
8. CONFIGURATION
----------------------------------------------------------------

Global :

    search: {
      mode: 'auto' | 'insensitive' | 'default',   // défaut 'auto'
      maxLength: 200
    },
    listFilterDefaults: {
      linkThreshold: 20,      // liens vs <select>
      // selectThreshold réutilisé depuis relationDefaults (200)
      autoDetect: true        // Boolean + enum en auto
    }

Par modèle :

    models: {
      Post: {
        searchFields: ['title', 'content'],
        listFilter: [
          'published',                         // forme courte
          { field: 'status' },
          { field: 'createdAt',
            presets: ['today','7d','month','year'] },
          { field: 'authorId', label: 'Auteur' },
          { field: 'price', range: true }      // rend gte + lte
        ]
      }
    }

Décisions :

- `searchFields` / `listFilter` : les noms de Django. Le projet se
  revendique Django-like ; l'utilisateur qui vient de Django ne
  doit pas avoir à deviner. Cohérent avec `listFields` déjà présent
  (Django dit `list_display`, le projet a déjà adapté la casse —
  on reste sur cette convention).
- forme courte (string) OU objet, comme `list_filter` de Django.
  Le cas 90% est un nom de champ.
- pas de `filterFn` custom en v1. Une fonction dans la config
  ouvrirait la porte à construire n'importe quelle clause Prisma
  depuis une valeur d'URL. Si le besoin remonte, la bonne réponse
  est une clause NOMMÉE côté serveur avec des valeurs d'URL
  purement symboliques, jamais une fonction qui reçoit la string.

Validation de la config AU BOOT (dans `createAdminHandler`, où le
schéma est déjà parsé une fois) :

    throw si searchFields/listFilter référence
      - un champ inexistant sur le modèle
      - un champ relation ou isList
      - un champ Json/Bytes
      - un champ sensible ou listé dans `hidden`
      - un opérateur/preset incompatible avec le type

Fail loud, comme le groupe ambigu de `relations.ts`. Une config
invalide est une erreur de développeur, elle doit péter au
démarrage avec un message précis, pas produire un filtre qui
disparaît mystérieusement. À NE PAS confondre avec la §5.4 : une
URL forgée dégrade en silence, une config fausse plante. Deux
chemins, deux politiques, c'est volontaire.


----------------------------------------------------------------
9. DÉCOUPAGE EN PR
----------------------------------------------------------------

PR1 — Socle de requête + recherche texte
  Le fix de sécurité et le gain visible le plus fort, ensemble.

  - parser : extraction du `provider` du bloc datasource
  - `query/listQuery.ts` : parseListQuery + buildWhere, whitelist
    de champs cherchables/filtrables, coercition, `ignored`
  - `query/urls.ts` : buildListUrl + hiddenParams
  - compat `?filter=` → pipeline unifié ; `RelatedBlock.svelte`
    migré vers `f.`
  - handler : remplacement du bloc `filterParam` par
    parseListQuery/buildWhere ; composition en AND
  - `List.svelte` : barre de recherche (form GET), compteur de
    résultats, "Tout effacer", pagination via buildListUrl
  - mock Prisma : `AND`, `OR`, `equals`, `mode` (ignoré)

  Tests attendus :
    - table de coercition par type, y compris "12abc", "", "-0",
      overflow BigInt
    - `?filter=passwordHash:x` → ignoré, liste inchangée (test de
      non-régression de la faille §0.a, nommé comme tel)
    - `?filter=published:true` → ne lève pas, coerce en booléen
    - scoping non écrasable : scope `{tenantId:1}` +
      `?f.tenantId=2` → AND des deux → 0 résultat, pas de fuite
    - OR de recherche sur 2 champs ; searchFields vide → pas de
      barre ; toutes clauses omises → no-op (pas `{OR:[]}`)
    - `mode` émis sur postgres, absent sur sqlite (fixtures de
      schéma par provider)
    - hiddenParams : la recherche préserve un filtre actif
    - `?q=x&page=3` puis clic Suivant → `q` conservé
    - échappement : `?q=<script>` réinjecté dans `value=` → escapé
      (via `html.ts` existant)

  Valeur seule : oui. Recherche fonctionnelle + faille fermée.

PR2 — Filtres Boolean et enum (sidebar)
  - parser : blocs `enum` → `PrismaEnum[]`, `field.enumName`
  - détection auto des champs filtrables (Boolean, enum)
  - `ListFilters.svelte` : sidebar de liens, "Tout",
    `aria-current`, chips actifs avec ×
  - config `listFilter` forme courte + objet, validation au boot

  Tests attendus :
    - parsing d'enums : membres avec `@map`, commentaires, enum
      inutilisé, enum référencé par un champ optionnel/liste
    - rendu : entrée "Tout" active quand aucun filtre ; URLs
      générées exactes ; `page` supprimé des liens de filtre
    - valeur enum inconnue → ignorée + message
    - deux filtres actifs → AND
    - config invalide (champ inexistant, champ sensible) → throw
      au boot, message exact
    - modèle sans champ filtrable → pas de sidebar rendue

PR3 — DateTime, plages numériques, filtre FK
  - presets DateTime + `gte`/`lte`, `now` injectable
  - `range: true` sur les numériques → deux inputs dans un form
  - filtre FK : count + seuil, labels résolus (labelTemplate),
    scoping des options ET du label de la valeur active
  - bascule liens ↔ `<select>` selon `linkThreshold`
  - `isnull` sur champs optionnels
  - mock Prisma : `gte`, `lte`, `lt`, `startsWith`, `not`

  Tests attendus :
    - chaque preset avec un `now` figé ; bornes exactes ; `lt`
      exclusif et non `lte`
    - date invalide `2026-13-45` → ignorée
    - `gte` seul, `lte` seul, les deux, inversés (gte > lte → 0
      résultat, pas d'erreur)
    - FK : count sous/au-dessus du seuil ; label résolu ; label
      NON résolu quand l'ID est hors scope (test d'oracle §6.3.b,
      nommé comme tel) ; modèle cible masqué → pas de lien
    - `isnull=1` et `isnull=0` ; refusé sur un champ required

PR4 (optionnelle) — Confort
  - compteurs par valeur dans la sidebar (`groupBy`), opt-in :
    c'est une requête d'agrégation par filtre, à ne pas activer
    par défaut
  - JS progressif : debounce sur la barre de recherche, strictement
    optionnel, `<script>` inline, nonce CSP réutilisé du mécanisme
    posé en PR4 de la feature relations
  - doc : section perf/index, matrice de casse par provider,
    dépréciation de `?filter=`

  Le JS inline est le même point de friction que la dernière fois :
  décider en amont (module testable inliné au build, ou exclusion
  documentée). Ne pas se rementir dessus.


----------------------------------------------------------------
10. CE QUI VA MERDER
----------------------------------------------------------------

Sécurité
  - Le filtre sur champ sensible (déjà exploitable aujourd'hui).
    Test de non-régression nommé explicitement, pas noyé.
  - Le spread `{...scope, ...filter}` qui écrase le scoping. Test
    dédié avec un filtre sur le champ de scoping lui-même.
  - Le label d'une FK hors scope résolu sans le AND (§6.3.b). La
    liste est vide, donc le test "0 résultat" passe, et la fuite
    est dans le chip. Assertion sur le HTML rendu, pas sur les
    données.
  - `hidden` par modèle vs heuristique de sensibilité : deux
    sources. Un seul prédicat partagé, sinon divergence garantie.
  - Rappel : `getDisplayFields` matche "hash" en sous-chaîne. Un
    champ `hashtag` est déjà non affiché ; il sera aussi non
    cherchable. Cohérent, mais surprenant : à documenter, et
    l'échappatoire est `searchFields` explicite... qui throw sur
    champ sensible (§8). Trancher : soit `hashtag` reste
    incherchable, soit on ajoute une liste `sensitiveOverride`.
    Recommandation : laisser incherchable en v1, c'est le
    comportement sûr, et le cas est rare.

Types et coercition
  - `parseInt` : le bug actuel. `parseInt("12abc")=12`,
    `parseInt("")=NaN`. Regex stricte obligatoire.
  - `Number("")` vaut 0. Piège inverse, même cause.
  - BigInt hors plage Number. Coercer en BigInt, jamais via Number.
  - Decimal : passer la string à Prisma, ne pas faire un aller-
    retour Number (perte de précision sur les montants).
  - `contains` sur un Int → Prisma lève. Whitelist par type.
  - `equals` sur un DateTime avec une date seule → jamais aucun
    résultat, et personne ne comprend pourquoi. D'où l'intervalle.
  - Enums non parsés = validation impossible. Prérequis PR2.

Provider et casse
  - `mode:'insensitive'` sur MySQL/SQLite → Prisma lève
    `Unknown argument`. Détection provider obligatoire.
  - SQLite : insensible ASCII seulement. "café" ≠ "CAFÉ". Limite
    du connecteur, à documenter, ne pas essayer de contourner.
  - MySQL : dépend de la collation, on ne peut pas la connaître
    depuis le `.prisma`. On suppose insensible (défaut moderne) et
    on documente l'override.
  - `provider = env("...")` → pas de provider littéral dans le
    schéma. Fallback : pas de `mode`, comportement sûr.
  - Postgres + `mode:'insensitive'` = ILIKE = l'index B-tree ne
    sert pas. Sur une grosse table c'est un seq scan. À documenter
    avec la recommandation `pg_trgm`.

URL et rendu
  - Le `<form method=GET>` qui écrase les autres params. §3.3.
  - Double échappement : une URL dans un attribut `href` a besoin
    d'un URL-encode ET d'un HTML-escape (`&` → `&amp;`). Deux
    opérations distinctes, souvent l'une des deux est oubliée. Le
    HTML-escape se fait en dernier.
  - `q` réinjecté dans `value="..."` : vecteur XSS direct. Le
    helper de `html.ts` existe, il faut juste ne pas l'oublier.
  - `+` vs `%20` : `URLSearchParams.toString()` encode l'espace en
    `+`, ce qui est correct en query string. Ne pas fabriquer
    d'URL par concaténation à côté, sinon incohérence entre les
    liens et les forms.
  - Snapshots instables si l'ordre des params varie. D'où le tri
    des clés dans `buildListUrl`.
  - `page` non réinitialisé sur un filtre → page vide inexpliquée.

Perf
  - `contains` = `LIKE '%x%'` = seq scan, aucun index utilisable
    (sauf trigram). Sur 100k lignes c'est lent, sur 10M c'est mort.
  - Le `count()` avec un `where` non indexé est souvent PLUS lent
    que le `findMany` paginé, parce qu'il ne peut pas s'arrêter à
    20 lignes. C'est lui qui fera timeout en premier.
  - Le projet ne gère pas les migrations, donc pas d'index
    automatique : documenter la recommandation (index sur les
    champs de `listFilter`, `pg_trgm` pour la recherche) et,
    éventuellement, avertir en dev si `searchFields` cible un champ
    sans `@@index`/`@unique` détectable dans le schéma. Le parser
    a l'info. Simple `console.warn` au boot, pas bloquant.
  - Filtres FK : 2 requêtes par filtre affiché, à chaque page de
    liste. Opt-in seulement.
  - Compteurs par valeur (PR4) : N `groupBy` par affichage. Opt-in
    strict.

Tests et process
  - Le mock Prisma devient le facteur limitant. Il lui faut `AND`,
    `OR`, `gte/lte/lt`, `startsWith`, `not`. Le risque réel : le
    mock accepte quelque chose que le vrai Prisma refuse (ou
    l'inverse) et on découvre le bug en prod. Prévoir au moins un
    test d'intégration sur le SQLite réel des fixtures pour les
    formes de `where` produites — sinon le mock valide le mock.
  - Les raccourcis DateTime sont non déterministes sans `now`
    injectable. Ils casseront en CI à minuit UTC, ou le 1er du
    mois, ou le 1er janvier. Injecter `now` dès la PR3.
  - `List.svelte` change de props → tous les call sites et leurs
    tests. C'est mécanique mais volumineux sur 426 tests.
  - Les branches `ignored` : elles sont rendues dans l'UI, donc
    observables, donc testables sans tricher. C'était le point de
    conception à respecter pour tenir le 100%.


----------------------------------------------------------------
11. RÉSUMÉ DES DÉCISIONS
----------------------------------------------------------------

  1. Whitelist de champs cherchables/filtrables AVANT tout le
     reste. `?filter=` est aujourd'hui un oracle sur les champs
     sensibles. Non négociable.
  2. Format `?q=` + `?f.champ[__op]=valeur`. Un param par filtre,
     parsing natif par URLSearchParams, compatible form GET.
  3. `?filter=` legacy conservé et redirigé vers le même pipeline.
     Dépréciation en 0.6, suppression en 0.7.
  4. Composition en `AND: [scope, ...filtres, {OR: recherche}]`.
     Jamais de spread. Le scoping est toujours en tête.
  5. La query string SÉLECTIONNE dans une whitelist finie
     d'opérateurs dérivée du type. Elle ne décrit jamais une
     clause Prisma.
  6. Recherche : `contains`, OR multi-champs, heuristique =
     `labelFields` ∩ String non sensibles, `searchFields` gagne.
     Terme unique en v1.
  7. Casse : `mode:'insensitive'` uniquement sur
     postgres/cockroach/mongo, provider détecté dans le schéma,
     override `search.mode`.
  8. Filtres rendus en LIENS (Django), pas en select auto-submit.
     `<select>` + bouton "Appliquer" au-delà de 20 valeurs. Zéro
     JS requis.
  9. Détection auto des filtres limitée à Boolean et enum
     (cardinalité statique, zéro requête). DateTime et FK sur
     config explicite.
 10. Relations : filtre par la FK scalaire uniquement, labels
     résolus, scoping appliqué aux options ET au label de la
     valeur active.
 11. Tout critère réinitialise `page`. Tri hors scope, `o` réservé.
 12. URL forgée → dégradation silencieuse + message UI. Config
     développeur invalide → throw au boot.
 13. 3 PR (+1 confort) : socle+recherche → Boolean/enum →
     DateTime/range/FK.
```

Trois points où j'ai challengé la demande, à valider :
