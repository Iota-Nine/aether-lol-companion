# AETHER — LoL Companion Desktop

Application **PC Windows** (Electron) pour League of Legends :

- fenêtre native (pas besoin du navigateur)
- détection automatique du client via **LCU**
- alliés / ennemis / picks / bans / win%
- liens **OP.GG**, **Porofessor**, **U.GG**
- mode **LIVE** uniquement (pas de démo)

## Lancer l'app PC

```bash
cd c:\Users\33651\Tout\Desktop\lolcodeexam
npm install
npm run app
```

Une fenêtre **AETHER** s'ouvre automatiquement.

## Créer un .exe installable

```bash
npm run build:app
```

Les fichiers sortent dans `release/` (installeur NSIS + version portable).

## Mises à jour automatiques

Repo releases : [Iota-Nine/aether-lol-companion](https://github.com/Iota-Nine/aether-lol-companion)

Les gens qui ont installé **AETHER-Setup** se mettent à jour tout seuls quand tu publies une nouvelle version.

1. Incrémente `version` dans `package.json` (ex. `1.0.0` → `1.0.1`)
2. Publie : `npm run publish:app` (utilise ton login `gh` / `GH_TOKEN`)

Au prochain lancement, AETHER télécharge la maj et propose de redémarrer.

> L’auto-update marche avec l’installeur **Setup**, pas la version Portable.

## Utilisation

1. Lance League of Legends et connecte-toi
2. Lance **AETHER** avec `npm run app`
3. Entre en champion select → alliés, ennemis et picks apparaissent
4. Scout via OP.GG / Porofessor / U.GG

> Lecture seule · fair-play · non affilié à Riot Games
