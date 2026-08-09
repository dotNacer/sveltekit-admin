# Changelog

Toutes les évolutions notables de ce projet sont documentées ici.

Le format s'appuie sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [0.4.0] - 2026-08-09

### Added
- **Relations éditables dans les formulaires**, façon Django admin :
  - Foreign keys (`to-one`) rendues en `<select>` avec labels lisibles au lieu
    d'un champ ID brut ; repli automatique en input texte au-delà d'un seuil
    configurable ou pour les FK composites (non représentables dans un
    `<option>`)
  - Relations many-to-many implicites (tables pivot Prisma) rendues en
    checkboxes, avec écriture `connect`/`set` correcte et protection contre
    la perte de données quand un formulaire est soumis avec le champ
    décoché/absent
  - Bloc « Liaisons » en lecture seule sur les pages d'édition, listant les
    relations inverses (1-N, 1-1) avec liens directs vers la liste filtrée
    et la création pré-remplie
  - Filtre de liste via `?filter=champ:valeur`
  - Endpoint `GET {basePath}/_search` pour interroger les options d'une
    relation en JSON (pagination, recherche par texte, respect du scoping) —
    base pour un futur widget de recherche côté client
- Nouvelle option de config par modèle : `relations` (widget, label, tri,
  scoping via `where`, seuil de bascule en champ texte)
- Validation serveur systématique des relations avant écriture : cohérence
  des IDs, existence en base, respect du scoping — empêche la modification
  d'une relation vers un enregistrement non autorisé (IDOR)

### Changed
- Le parser de schéma Prisma reconnaît maintenant correctement les relations
  nommées explicitement et les relations inverses, y compris quand plusieurs
  relations existent entre les deux mêmes modèles (évite les faux
  appariements silencieux)

### Fixed
- Un schéma Prisma avec plusieurs FK sur un même modèle (ex. `author` et
  `reviewer` pointant tous deux vers `User`) pouvait auparavant produire un
  appariement de relation incorrect

## [0.3.0] - 2026-08-06

### Added
- Détection et masquage automatique des tables pivot (many-to-many
  implicites) dans la liste des modèles administrables
- Migration des vues internes vers des composants Svelte
- Suite de tests avec couverture à 100 % et intégration continue

### Changed
- API unifiée autour de `createAdminHandler` (hook SvelteKit unique)

### Fixed
- Échappement systématique des valeurs issues de l'URL et de la base dans le
  HTML rendu (faille XSS potentielle)
- La coercion de l'identifiant consulte désormais le type réel de la clé
  primaire (une PK `String` entièrement numérique n'était plus envoyée à
  Prisma comme un `Int`)
- `?page=` invalide (`abc`, `0`, négatif, hors entiers sûrs) retombe sur la
  première page au lieu d'envoyer un `skip` `NaN` ou négatif
- Une URL de trois segments ou plus rend une page « not found » au lieu du
  dashboard
- Heuristique de détection des champs `textarea` insensible à la casse
- Une couleur de branding invalide retombe sur la couleur par défaut au lieu
  de rendre du noir

### Removed
- **Breaking** : suppression de l'ancienne API à base de loaders
  (`createAdmin`, `createLayoutLoad`, `createModelListLoad`, etc.) — utiliser
  `createAdminHandler`
- **Breaking** : suppression des composants Svelte exportés
  (`sveltekit-admin/components`) et de l'export `sveltekit-admin/admin`
- **Breaking** : suppression des utilitaires CRUD exportés
  (`createListOperation`, `buildSearchWhere`, `createAuthGuard`, …)
- Retrait des options de configuration jamais implémentées
  (`branding.logo`, `models[].icon`)

## [0.2.1] - 2026-08-05

### Fixed
- Correctifs mineurs sur le handler autonome introduit en 0.2.0

## [0.2.0] - 2026-08-05

### Added
- Handler d'administration autonome : plus besoin de créer des routes
  manuellement, tout passe par un seul hook

## [0.1.0] - 2026-08-05

### Added
- Première version publique de `sveltekit-admin`
