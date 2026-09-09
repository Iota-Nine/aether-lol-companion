# AETHER — LoL Companion Desktop

Application **PC Windows** (Electron) pour League of Legends :

- fenêtre native (pas besoin du navigateur)
- détection automatique du client via **LCU** (lecture seule)
- alliés / ennemis / picks / bans / win% joueur (ranked + historique LCU)
- liens scout **OP.GG**, **Porofessor**, **U.GG** (et lolchess en TFT)
- HUD **in-game** (KDA, CS, or, events)
- mode **TFT** (lobby / match + compos indicatives)
- auto-update via **GitHub Releases** (installeur Setup)

> Lecture seule · fair-play · non affilié à Riot Games

## Lancer en développement

```bash
npm install
npm run app
```

Une fenêtre **AETHER** s'ouvre (League doit tourner pour le live).

## Créer un .exe installable (local)

```bash
npm run build:app
```

Les fichiers sortent dans `release/` (installeur NSIS + version portable).

## Publier une mise à jour (pour tes potes en Setup)

L’auto-update lit les **releases GitHub**, pas les simples `git push`.

### Option A — CI GitHub Actions (recommandé)

1. Incrémente `version` dans `package.json` (ex. `1.0.1` → `1.0.2`)
2. Commit + push sur `main`
3. Crée un tag et pousse-le :

```bash
git tag v1.0.2
git push origin v1.0.2
```

Le workflow `.github/workflows/release-windows.yml` build Windows et publie la release.

Tu peux aussi lancer le workflow à la main : Actions → **Release Windows** → Run workflow.

### Option B — depuis un PC Windows

```bash
# token GitHub avec droit repo
setx GH_TOKEN "ghp_xxx"
npm run publish:app
```

Au prochain lancement, **AETHER-Setup** télécharge la maj et propose de redémarrer.

> L’auto-update marche avec l’installeur **Setup**, pas la version Portable.

## Utilisation

1. Lance League of Legends et connecte-toi
2. Lance **AETHER**
3. Entre en champion select → alliés, ennemis et picks apparaissent
4. Clique OP.GG / Porofessor / U.GG pour scouter un joueur

## Notes meta

- Les **WR joueurs** viennent du LCU (ranked / historique) → fiables
- Les **WR / tiers champions** et builds panel sont **indicatifs** ; les liens OP.GG / U.GG donnent la meta live
