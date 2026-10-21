# Mini-jeux multijoueurs (archivé)

Trois jeux de société en ligne, à faire entre amis sur téléphone ou ordi, sans compte : un pseudo, un code de partie, et c'est parti.

- **Nom de code** (`nomdecode/`) : deux équipes, deux maîtres-espions, 25 mots. Un mot et un nombre pour faire deviner ses agents.
- **Plus4** (`plus4/`) : même couleur ou même valeur, des +2, des +4 et des inversions. Le premier qui vide sa main gagne.
- **Douze** (`douze/`) : douze cartes cachées, on pioche, on échange, trois cartes identiques en colonne disparaissent. Le plus petit score gagne.

Ils étaient en ligne sur yasder5.fr d'octobre 2026 jusqu'à leur archivage. Le code reste ici tel quel.

## Fonctionnement

- Serveur Python sans dépendance (bibliothèque standard), parties en mémoire.
- Mises à jour en direct par SSE (`/api/events`), actions en `POST /api/act`.
- Socle commun dans `common/` : salons à code, hôte, reprise de place, parties publiques, client `core.js` + effets `fx.js`.
- Chaque jeu lance un autotest au démarrage.

## Lancer en local

```sh
docker compose up -d
```

Nom de code sur le port 1429, Plus4 sur 1430, Douze sur 1431. Sans Docker : `cd plus4 && python3 server.py` (port 8000).

Polices : Archivo et JetBrains Mono (SIL Open Font License).
