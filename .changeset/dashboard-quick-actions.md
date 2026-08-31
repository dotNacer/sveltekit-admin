---
"sveltekit-admin": minor
---

**Le dashboard offre une action de création par modèle.** Chaque carte porte un lien « + New » vers le formulaire de création, à côté du lien « Manage → » qui reste étendu à toute la surface de la carte. Créer un enregistrement ne demande plus de passer par la liste.

La carte n'est plus un `<a>` : deux liens ne peuvent pas être imbriqués l'un dans l'autre sans casser la navigation au clavier et l'annonce des lecteurs d'écran. C'est maintenant un `<article>` dont le lien « Manage → » est étendu par un overlay, avec un nom accessible distinct pour chaque lien (« New Users » plutôt qu'un second « + New » anonyme).

La page gagne au passage un en-tête et des sections délimitées, préparation du dashboard configurable. Aucune requête supplémentaire n'est émise.
