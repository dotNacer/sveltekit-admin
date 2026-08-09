================================================================
DESIGN — Sélecteur de relations dans les formulaires
sveltekit-admin v0.4.0 (cible)
================================================================

----------------------------------------------------------------
0. CHALLENGE DE L'EXISTANT (à lire avant le reste)
----------------------------------------------------------------

Trois choses me semblent mal parties.

(a) L'heuristique pivot "2+ FK et ≤1 champ métier" sert un but
    cosmétique (masquer la sidebar) mais tu vas être tenté de la
    réutiliser pour un but sémantique (décider comment éditer une
    relation). C'est un piège. `LineItem { orderId, productId,
    quantity }` matche l'heuristique et n'est PAS un pivot à
    masquer : c'est un agrégat métier de premier ordre.
    → Séparer deux notions :
      - isImplicitJoinTable : fait objectif (table `_Foo` générée
        par Prisma, invisible du client Prisma). Masquage légitime.
      - looksLikeJoinTable : heuristique, cosmétique uniquement,
        surchargeable par modèle.
    → Réponse à ta question "le pivot explicite devrait-il être
      masqué ?" : NON. Un pivot explicite est un modèle Prisma
      normal, avec son propre CRUD. Le masquer par défaut est un
      bug. Passer `hidePivotTables` à "implicites uniquement" par
      défaut, et documenter le changement.

(b) [À VÉRIFIER] Si `form.ts` filtre les champs `relation` mais
    laisse passer les scalaires, alors `authorId` est aujourd'hui
    rendu comme un `<input type=number>`. L'utilisateur tape un ID
    à la main. C'est le vrai bug, et le fix n'est pas "ajouter un
    select en plus" : c'est REMPLACER le champ scalaire par le
    select. Sinon deux sources de vérité dans le même form, et un
    POST ambigu.

(c) Rendu HTML par concaténation de strings + labels issus de la
    DB = risque XSS structurel. Avant d'injecter des noms
    d'utilisateurs dans 200 `<option>`, il faut un helper
    d'échappement centralisé et testé. Si `escapeHtml` n'existe
    pas déjà et n'est pas appliqué systématiquement, c'est un
    bloquant pour la PR2, pas un "nice to have".

----------------------------------------------------------------
1. DÉTECTION — passe de post-traitement sur le parser
----------------------------------------------------------------

Oui, il faut une passe de link. Le parser actuel voit des champs
isolés ; les relations sont un graphe et ne se déduisent
correctement que globalement.

Architecture proposée :

  parser.ts        -> AST brut (models, fields, attributes)
  relations.ts     -> NOUVEAU : buildRelationGraph(models)
  (le reste)       -> consomme le graphe, jamais l'AST brut

1.1 Règle d'appariement (le point critique)

Ne JAMAIS apparier deux champs relation par "ils pointent vers le
même modèle". Apparier par la clé :

    (modelA, modelB, relationName)

où relationName vient de `@relation("Nom")`, sinon "" (défaut).
Prisma garantit qu'un nom de relation est unique pour un couple de
modèles. Sans ça, `Post { author User, reviewer User }` produit un
appariement aléatoire — et l'erreur est SILENCIEUSE.

Algorithme :
  1. Collecter tous les champs dont le type est un nom de modèle
     → candidats relation. Noter : isList, isRequired, relationName,
     fields[], references[].
  2. Grouper par clé normalisée (min/max des deux noms de modèle +
     relationName).
  3. Chaque groupe doit contenir 1 ou 2 champs.
     - 2 champs → relation bidirectionnelle, classifier (1.2)
     - 1 champ  → relation unidirectionnelle (légal en Prisma pour
       le to-one owning). Marquer `hasBackReference: false`.
     - 3+       → schéma invalide OU bug d'appariement. Ne pas
       deviner : émettre un diagnostic et désactiver l'édition de
       ces relations. Fail loud, pas silencieux.

1.2 Classification

    to-one-owning     : !isList && fields/references présents
                        → possède la/les FK scalaires
    to-one-inverse    : !isList && pas de fields  (côté 1-1 inverse)
    to-many-inverse   : isList && l'autre côté est to-one-owning
    m2m-implicit      : isList des DEUX côtés, aucun fields/references
    m2m-explicit      : n'existe PAS comme arête. C'est deux
                        relations 1-N vers un modèle pivot.
                        À dériver dans une seconde passe (1.4).

1.3 Lien FK scalaire ↔ relation

Pour chaque champ to-one-owning, `fields: ["authorId"]` donne les
noms des scalaires. Produire dans le graphe :

    scalarToRelation: Map<"authorId", "author">
    relationToScalars: Map<"author", ["authorId"]>

C'est ce qui permet à `form.ts` de masquer `authorId` et de rendre
le select `author` à la position de `authorId` dans le schéma
(garder l'ordre déclaré : moins surprenant).

Cas composite : `fields: ["a","b"]` → longueur > 1. Marquer
`unsupported: 'composite-fk'`. Voir §6.

1.4 Détection m2m-explicit (dérivée, pour la doc/UX seulement)

Un modèle P est un pivot explicite entre A et B si :
  - P a exactement 2 arêtes to-one-owning, vers A et vers B
  - `@@id([aId, bId])` ou `@@unique([aId, bId])`
Signal utile pour afficher un badge "table de liaison" et pour
proposer un lien "gérer les liaisons" depuis le form de A. Mais on
n'édite PAS un pivot explicite depuis A en v1 (§3.4).

1.5 Ce qu'on expose au reste du code

    type RelationEdge = {
      model, field, kind, target, relationName,
      isRequired, isList,
      scalarFields: string[],
      selfReferential: boolean,
      unsupported?: 'composite-fk' | 'mongo-m2m' | 'ambiguous'
    }

Coût : ~150 lignes. Sur une codebase de 1500, c'est 10%. C'est
justifié : tout le reste de la feature en dépend.

----------------------------------------------------------------
2. UI — widgets
----------------------------------------------------------------

2.1 Position de principe

Ne pas copier le double-listbox de Django. C'est un widget de 2005,
inaccessible (deux listbox + boutons, navigation clavier confuse,
inutilisable sur mobile, l'état "sélectionné" n'est pas dans le
DOM du champ soumis mais reconstruit au submit). Django lui-même le
regrette.

Le meilleur widget N-N par défaut est le plus bête : une liste de
checkboxes dans un `<fieldset>`.

2.2 Grille de décision (seuils configurables)

  to-one (FK)
    n ≤ selectThreshold (défaut 200)  → <select> simple
    n >  selectThreshold             → autocomplete (PR4),
                                        fallback input ID + lien
                                        de recherche

  to-many (N-N implicite)
    n ≤ checkboxThreshold (défaut 30) → fieldset de checkboxes
    30 < n ≤ 200                      → checkboxes + filtre client
                                        (JS progressif, 0 requête)
    n > 200                           → autocomplete + chips (PR4)

Les seuils s'évaluent sur un COUNT, pas sur le résultat chargé.
Un `count()` avant le `findMany()` : 1 requête de plus, mais ça
évite de charger 10k lignes pour découvrir qu'il y en a 10k.

2.3 Trade-offs par widget

  fieldset + checkboxes
    + zéro JS, a11y native parfaite, état visible, mobile OK
    + le diff est trivial (les cochées sont soumises)
    - illisible au-delà de ~40 items
    - poids HTML : ~120 octets/item

  <select multiple>
    + compact, zéro JS
    - UX catastrophique (ctrl+clic, un clic accidentel efface tout)
    - taille par défaut ridicule, mal supporté mobile
    → à garder UNIQUEMENT comme fallback no-JS d'un widget enrichi,
      jamais comme défaut visible

  dual listbox (Django)
    - complexité JS, a11y difficile, dégradation no-JS nulle
    → rejeté

  autocomplete + chips
    + seule option viable à grande échelle
    - nécessite JS + un endpoint + une combobox ARIA correcte
      (aria-expanded, aria-activedescendant, role=listbox, gestion
      clavier complète). C'est le morceau coûteux. D'où PR4.
    - fallback no-JS obligatoire : input texte "ID ou slug" +
      validation serveur

2.4 Progressive enhancement, concrètement

Le HTML de base est toujours complet et fonctionnel sans JS. Le JS
n'ajoute que :
  - un `<input type=search>` qui filtre les `<label>` déjà présents
    (pur DOM, aucune requête) — couvre 30..200 items
  - en PR4, la combobox distante

Le JS doit être un `<script>` inline de quelques centaines
d'octets, sans build ni dépendance. Attention CSP : si le handler
peut recevoir un nonce en config, l'exposer (`csp: { nonce }`).
Sinon documenter que `script-src 'unsafe-inline'` est requis, ce
qui est un mauvais message pour un panel d'admin.

2.5 Relations 1-N inverses (User.posts vu depuis User)

Affichage read-only : les N premiers enfants (5), un compteur, un
lien vers la liste filtrée, un bouton "ajouter" qui pré-remplit la
FK côté enfant. PAS d'édition inline.

Justification : éditer une liste d'enfants depuis le parent, c'est
les inline formsets de Django. C'est la partie la plus complexe et
la plus buggée de l'admin Django (indices, formulaire vide,
DELETE checkbox, management form). Hors scope. À documenter comme
non-objectif explicite, sinon ça reviendra à chaque issue.

----------------------------------------------------------------
3. DATA FLOW
----------------------------------------------------------------

3.1 Nommage des inputs

Préfixer pour éviter toute collision avec un scalaire homonyme :

    __rel__author        (valeur unique)
    __rel__tags          (valeurs multiples)
    __rel_present__tags  (hidden, toujours émis, valeur "1")

Le hidden sentinelle est indispensable : en HTML, zéro checkbox
cochée = clé absente du POST. Sans sentinelle, impossible de
distinguer "l'utilisateur a tout décoché" de "ce widget n'était
pas dans ce formulaire". Le premier cas doit vider la relation, le
second doit être un no-op. C'est LA source de bugs de perte de
données sur ce genre de feature.

3.2 to-one : écrire la FK scalaire, pas `connect`

Quand la relation possède une FK scalaire simple (cas 99%), écrire
directement `{ authorId: 12 }` plutôt que
`{ author: { connect: { id: 12 } } }`.

  + une seule sémantique, pas de nested write
  + `authorId: null` exprime naturellement le disconnect (si
    optionnelle)
  + `formDataToPrisma` reste plat, moins de code, coverage facile
  - ne marche pas si la FK n'est pas exposée (rare) → fallback
    connect/disconnect

Required : si valeur vide et `isRequired` → erreur de validation
côté serveur, re-render du form avec le message. Ne jamais laisser
Prisma lever P2011/P2003 et retourner un 500. Et NE PAS rendre
l'option vide dans le `<select>` si required (le HTML doit
exprimer la contrainte, pas seulement le serveur).

3.3 m2m implicite : `set` par défaut

Update :
    { tags: { set: [{id:1},{id:4}] } }

`set` vs diff (connect/disconnect) :

  set
    + idempotent, pas de lecture préalable, une requête
    + code trivial → coverage 100% facile
    - Prisma fait un DELETE + INSERT sur la table pivot :
      churn d'écriture, invalide les triggers/audit éventuels
    - last-write-wins : deux admins en parallèle, le second écrase
      les ajouts du premier

  diff
    + n'écrit que le delta, préserve l'ordre d'insertion
    + permet la détection de conflit optimiste
    - nécessite un read + comparaison de sets d'IDs typés
      (Int vs String : le piège classique du `includes`)
    - plus de branches à tester

Recommandation : `set` en v1, et poser dès maintenant l'accroche du
conflit optimiste — un hidden `__rel_initial__tags="1,4,7"`. En v1
il n'est pas relu ; en v2 il permet le diff et l'avertissement
"cette relation a été modifiée depuis le chargement". Le coût
aujourd'hui est de 20 octets d'HTML.

Create :
    { tags: { connect: [{id:1},{id:4}] } }
`set` n'a pas de sens au create.

3.4 m2m explicite : PAS d'édition depuis le parent en v1

Un pivot explicite porte des champs métier (role, quantity,
addedAt). Les éditer depuis le form du parent, c'est un inline
formset. On ne le fait pas.

À la place :
  - le pivot est un modèle visible avec son propre CRUD
  - le form du parent affiche un bloc read-only des liaisons + un
    lien "ajouter une liaison" pré-rempli

C'est cohérent, ça coûte presque rien, et ça évite d'écrire le
widget le plus complexe du projet pour la v1.

3.5 Validation et atomicité

Avant l'écriture :
  1. Coercer les IDs vers le type déclaré (Int/String/BigInt).
     Échec de coercion → erreur de champ.
  2. Vérifier l'existence : un `findMany({ where: { id: { in: ids },
     ...configWhere }, select: { id: true } })`. Si le compte diffère
     → erreur "valeur invalide". Ça bloque aussi l'IDOR : un ID hors
     du `where` de scoping est rejeté ici, pas seulement caché du
     select.
  3. Self-referential : exclure l'ID de la ligne courante des
     options ET du POST accepté.

Écriture : UNE SEULE `prisma.model.update()` avec scalaires +
nested writes. Prisma la rend atomique. Ne jamais faire N updates
séquentiels.

----------------------------------------------------------------
4. CONFIGURATION
----------------------------------------------------------------

Global (defaults) :

  relationDefaults: {
    checkboxThreshold: 30,
    selectThreshold: 200,
    optionsPageSize: 50,
    labelFields: ['name','title','label','email','username','slug']
  }

Par modèle :

  models: {
    Post: {
      relations: {
        author: {
          widget: 'select' | 'autocomplete' | 'raw-id' | 'hidden',
          labelTemplate: '{firstName} {lastName} <{email}>',
          orderBy: { name: 'asc' },
          where: (ctx) => ({ tenantId: ctx.locals.tenantId }),
          nullLabel: '— aucun —',
          readOnly: false
        },
        tags: {
          widget: 'checkboxes' | 'multiselect' | 'autocomplete',
          searchFields: ['name','slug']
        }
      }
    }
  }

Décisions :

- labelTemplate (string) plutôt qu'une fonction, par défaut. La
  string permet de dériver automatiquement le `select` Prisma
  (n'aller chercher que les champs cités). Une fonction
  `label: (row) => string` reste possible en échappatoire, mais
  impose de charger la ligne entière → documenter le coût.
- Résolution auto du label : premier champ String du modèle dans
  l'ordre de `labelFields`, sinon la clé primaire. Doit être
  déterministe et documenté, sinon les utilisateurs verront des
  "#42" sans comprendre pourquoi.
- `where` en fonction recevant le contexte de requête : c'est le
  mécanisme de scoping multi-tenant / permissions. Sans lui, un
  select expose la liste de tous les utilisateurs à tout admin.
  C'est un requis de sécurité, pas une option de confort.
- `widget: 'raw-id'` : échappatoire toujours disponible quand la
  détection échoue (composite, Mongo, relation ambiguë). Le panel
  reste utilisable même dans les cas non supportés.

----------------------------------------------------------------
5. DÉCOUPAGE EN PR
----------------------------------------------------------------

PR1 — Graphe de relations (introspection pure)
  Livrable : `relations.ts`, appariement par nom de relation,
  classification, map FK↔relation, détection self-ref, flags
  `unsupported`. Zéro changement d'UI.
  Tests : corpus de fixtures `.prisma` (un fichier par cas :
  1-N simple, 1-N optionnel, deux relations nommées vers le même
  modèle, self-ref 1-N, self-ref N-N, N-N implicite, pivot
  explicite, FK composite, 1-1, unidirectionnel, @map/@@map).
  Assertions sur le graphe sérialisé (snapshots). 100% atteignable
  facilement : c'est du pur fonctionnel sans I/O.
  Valeur seule : oui — corrige déjà le masquage des pivots.

PR2 — to-one éditable (FK)
  Le gros gain d'usage pour l'effort le plus faible.
  - form.ts : masquer les scalaires FK, rendre un `<select>` à leur
    place, dans l'ordre du schéma
  - chargement des options avec `count()` + seuil dur + `where` +
    labelTemplate
  - data.ts : mapping POST → FK scalaire, validation required,
    coercion des types d'ID, exclusion self-ref
  - escapeHtml centralisé et testé (bloquant)
  Tests : rendu HTML (required sans option vide, nullable avec,
  au-delà du seuil → raw-id), POST valide, POST avec ID inexistant,
  POST avec ID hors du `where`, POST vide sur required, coercion
  Int/String.

PR3 — N-N implicite
  - widget checkboxes + fallback multiselect selon seuil
  - hidden sentinelle + hidden `__rel_initial__`
  - create → connect, update → set
  - validation d'existence en batch
  Tests : tout décocher vide bien la relation ; widget absent =
  no-op ; ID invalide rejeté ; create et update ; self-ref N-N
  (followers/following) avec exclusion de soi.

PR4 — Échelle et confort
  - endpoint de recherche (`GET ...?__rel=tags&q=...`, paginé,
    respecte `where`)
  - combobox ARIA + chips, JS inline, fallback no-JS testé
  - filtre client pour la tranche 30..200
  - bloc read-only des 1-N inverses et des pivots explicites +
    liens "ajouter"
  - doc + migration note sur `hidePivotTables`
  Tests : l'endpoint est du serveur pur → coverage OK. Le JS
  inline est le point dur pour le 100% : soit l'extraire dans un
  module testable qui est ensuite inliné à la construction, soit
  l'exclure explicitement de la couverture avec justification. Ne
  pas se mentir sur ce point.

----------------------------------------------------------------
6. CE QUI VA MERDER
----------------------------------------------------------------

Sémantique / correction
  - Relations multiples nommées vers le même modèle. L'appariement
    naïf par type donne un résultat FAUX et SILENCIEUX. C'est le
    bug n°1 de cette feature. Test dédié en PR1.
  - Self-referential : le modèle est identique des deux côtés,
    l'appariement doit gérer (A,A). Et il faut exclure la ligne
    courante des options, sinon on crée des cycles (Category son
    propre parent).
  - Relations unidirectionnelles (pas de back-reference) : légales,
    le groupe d'appariement a 1 élément. Ne pas planter.
  - 1-1 déguisé : `@unique` sur la FK. Le select doit exister mais
    P2002 au submit → intercepter et transformer en message de
    champ, pas en 500.

Schéma / connecteur
  - FK composite (`fields: [a,b]`) : un `<option value>` ne peut
    pas porter un tuple. Détecter, dégrader en raw-id, documenter.
    Ne pas tenter de sérialiser un tuple dans la value.
  - MongoDB : pas de pivot implicite ; le N-N s'exprime par des
    tableaux de scalar IDs des deux côtés. Modèle totalement
    différent. Détecter le provider en PR1 et dégrader
    explicitement, sinon le parser produira des arêtes fausses.
  - `@map` / `@@map` : les noms DB ≠ noms Prisma. Toujours parler
    en noms Prisma au client. Facile à confondre dans un parser
    maison.
  - Schémas multi-fichiers (Prisma ≥ 5.15, `prismaSchemaFolder`) :
    le parser lit-il un fichier ou un dossier ? [À VÉRIFIER]
  - `@@schema` (multi-schema Postgres), `@ignore`,
    `Unsupported("...")` : ignorer proprement.

Types
  - BigInt en ID : casse `JSON.stringify`. Si les options
    transitent en JSON (autocomplete PR4), c'est un crash.
  - Int vs String dans les comparaisons de sets : `[1,2].includes("1")`
    est `false`. Normaliser en string pour le diff, coercer au
    dernier moment pour Prisma.
  - Bytes / Decimal en clé primaire : rare, mais dégrader.

Performance / volumétrie
  - Charger 10k options = page de plusieurs Mo et pic mémoire. Le
    seuil dur doit être en PR2, pas repoussé en PR4.
  - Un form avec 6 relations = 6 `count()` + 6 `findMany()`.
    Acceptable, mais à mesurer. Pas de N+1 par ligne, seulement par
    champ.

Sécurité
  - XSS : labels issus de la DB injectés dans du HTML par string.
    Escaping centralisé obligatoire.
  - Fuite d'information : un select expose la liste complète d'un
    modèle. `where` de scoping requis, et la validation serveur
    doit rejouer ce `where` (sinon IDOR par POST forgé).
  - CSRF : ces POST modifient des relations. Si le handler n'a pas
    de protection CSRF aujourd'hui, cette feature en augmente
    l'impact. [À VÉRIFIER]
  - CSP : le `<script>` inline. Prévoir un nonce configurable.

Concurrence / données
  - `set` en last-write-wins : deux admins simultanés, des tags
    disparaissent sans message. D'où le hidden `__rel_initial__`
    dès la PR3, même s'il n'est pas encore exploité.
  - Perte silencieuse : sentinelle manquante = relation vidée par
    accident. Test explicite.

Process
  - Le 100% coverage sur le JS inline est le seul vrai point de
    friction du plan. Décider en amont : module testable inliné,
    ou exclusion assumée et documentée.

----------------------------------------------------------------
7. RÉSUMÉ DES DÉCISIONS
----------------------------------------------------------------

  1. Passe de post-traitement `relations.ts`, appariement par
     (modelA, modelB, relationName). Non négociable.
  2. Checkboxes par défaut pour le N-N. Pas de dual listbox.
  3. to-one = écriture de la FK scalaire, pas `connect`.
  4. N-N implicite = `set` à l'update, `connect` au create,
     sentinelle hidden obligatoire.
  5. N-N explicite = pas d'édition depuis le parent ; le pivot
     devient un modèle visible de premier ordre.
  6. 1-N inverse = read-only. Pas d'inline formsets.
  7. Seuils configurables, `where` de scoping obligatoire,
     échappatoire `raw-id` toujours disponible.
  8. 4 PR : graphe → to-one → N-N implicite → échelle.

Si tu veux, je peux écrire ce document dans le repo (par exemple
/root/sveltekit-admin/docs/design/relations.md) et lire le parser
et form.ts pour lever les [À VÉRIFIER].
