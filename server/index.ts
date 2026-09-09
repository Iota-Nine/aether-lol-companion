import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { findLockfile, lcuGet, liveClientGet } from './lcu.js'
import { loadChampions, getAllChampions, getChampionById } from './champions.js'
import { buildLiveSession, type LcuChampSelectSession, type LcuSummoner } from './session.js'
import { createDemoChampSelect } from './demo.js'
import { normalizeRegion, isTftQueue, queueLabel } from './profiles.js'
import {
  buildTftLobbySession,
  buildTftFromGameflow,
  emptySession,
  detectTftFromSession,
  type LobbyPayload,
  type LiveClientPlayer,
  type GameflowSession,
} from './tft.js'
import { buildMetaGuides } from './meta.js'
import type { LiveSession } from './types.js'
import { enrichPlayersWithStats, computeTeamWinChance } from './playerStats.js'
import type { LockfileData } from './types.js'
import { buildLolInGameSession } from './ingame.js'

async function withGuides(live: LiveSession, lockfile?: LockfileData | null): Promise<LiveSession> {
  try {
    if (lockfile && (live.mode === 'lol' || live.mode === 'tft')) {
      if (live.mode === 'tft') {
        const enriched = await enrichPlayersWithStats(
          lockfile,
          live.players.length ? live.players : live.allies,
          'tft',
          live.queueName,
        )
        live.players = enriched
        live.allies = enriched
        const team = computeTeamWinChance(enriched, [])
        live.teamWinChance = team
        const avgVals = enriched
          .map((p) => p.playerStats?.formScore)
          .filter((v): v is number => v != null)
        const avg = avgVals.length
          ? avgVals.reduce((a, b) => a + b, 0) / avgVals.length
          : null
        if (avg != null) {
          live.message = `${live.message} · Forme lobby ~${avg.toFixed(1)}%`
        }
      } else {
        const enrichSide = async (side: typeof live.allies) => {
          const ranked = await enrichPlayersWithStats(lockfile, side, 'lol', live.queueName)
          return ranked.map((p) => {
            const prev = side.find((x) => x.cellId === p.cellId || x.gameName === p.gameName)
            return {
              ...p,
              live: prev?.live ?? p.live ?? null,
              championImage: p.championImage || prev?.championImage || null,
            }
          })
        }
        live.allies = await enrichSide(live.allies)
        live.enemies = await enrichSide(live.enemies)
        live.players = [...live.allies, ...live.enemies]
        if (!live.inGame?.active) {
          live.teamWinChance = computeTeamWinChance(live.allies, live.enemies)
          live.message = `${live.message} · WR équipes basé sur ranked + historique récent`
        } else {
          live.teamWinChance = computeTeamWinChance(live.allies, live.enemies)
        }
      }
    }

    if (live.inGame?.active && live.mode === 'lol') {
      const ids = live.players
        .map((p) => p.championId)
        .filter((id): id is number => typeof id === 'number' && id > 0)
      if (ids.length) {
        live.guides = await buildMetaGuides({ mode: 'lol', championIds: ids })
      }
    } else if (live.mode === 'tft') {
      live.guides = await buildMetaGuides({ mode: 'tft' })
    } else if (live.mode === 'lol') {
      const ids = [...live.allies, ...live.enemies, ...(live.players ?? [])]
        .map((p) => p.championId)
        .filter((id): id is number => typeof id === 'number' && id > 0)
      live.guides = await buildMetaGuides({ mode: 'lol', championIds: ids })
    } else {
      const tft = await buildMetaGuides({ mode: 'tft' })
      const lol = await buildMetaGuides({ mode: 'lol', championIds: [] })
      live.guides = {
        mode: 'tft',
        patchNote: 'Suggestions meta (en attente de lobby)',
        lolBuilds: lol.lolBuilds.slice(0, 4),
        tftComps: tft.tftComps,
      }
    }
  } catch (e) {
    console.warn('[aether] guides/stats:', e)
  }
  return live
}

export function createApp() {
  const app = express()
  let forceDemo = process.env.FORCE_DEMO === '1'

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, forceDemo })
  })

  app.post('/api/demo', (req, res) => {
    forceDemo = Boolean(req.body?.enabled)
    res.json({ forceDemo })
  })

  app.get('/api/champions', async (_req, res) => {
    try {
      const list = await getAllChampions()
      res.json({ champions: list })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.get('/api/champions/:id', async (req, res) => {
    const id = Number(req.params.id)
    const champ = await getChampionById(id)
    if (!champ) {
      res.status(404).json({ error: 'Champion introuvable' })
      return
    }
    res.json(champ)
  })

  app.get('/api/live', async (req, res) => {
    try {
      await loadChampions()

      if (forceDemo || req.query.demo === '1') {
        const session = createDemoChampSelect()
        const live = await buildLiveSession({
          connected: true,
          demo: true,
          phase: 'ChampSelect',
          region: 'euw',
          message: 'Mode démo — données fictives.',
          session,
          currentSummoner: {
            gameName: 'NissaMain',
            tagLine: 'EUW',
            displayName: 'NissaMain#EUW',
          },
        })
        res.json(await withGuides(live))
        return
      }

      const lockfile = findLockfile()
      if (!lockfile) {
        res.json(
          await withGuides(
            emptySession({
              connected: false,
              phase: 'Idle',
              region: 'euw',
              mode: 'idle',
              message: 'Client League introuvable. Lance League of Legends / TFT.',
            }),
          ),
        )
        return
      }

      const gameflow = await lcuGet<GameflowSession>(lockfile, '/lol-gameflow/v1/session')
      const phaseRaw =
        gameflow?.phase ??
        (await lcuGet<string>(lockfile, '/lol-gameflow/v1/gameflow-phase')) ??
        'Unknown'
      const phase = String(phaseRaw)

      const regionData = await lcuGet<{ region?: string; webRegion?: string }>(
        lockfile,
        '/riotclient/region-locale',
      )
      const region = normalizeRegion(regionData?.webRegion || regionData?.region || 'euw')

      const currentSummoner = await lcuGet<LcuSummoner>(
        lockfile,
        '/lol-summoner/v1/current-summoner',
      )

      const lobby = await lcuGet<LobbyPayload>(lockfile, '/lol-lobby/v2/lobby')
      const queueId = lobby?.gameConfig?.queueId ?? gameflow?.gameData?.queue?.id
      const gameMode = lobby?.gameConfig?.gameMode ?? gameflow?.gameData?.queue?.gameMode
      const tft = detectTftFromSession(gameflow, lobby) || isTftQueue(queueId, gameMode)

      const inGame = ['InProgress', 'GameStart', 'Reconnect'].includes(phase)
      const livePlayers = inGame
        ? await liveClientGet<LiveClientPlayer[]>('/liveclientdata/playerlist')
        : null

      // ── LoL EN PARTIE (Live Client 2999) — priorité Porofessor-like ──
      if (inGame && !tft) {
        const flowPlayers = [
          ...(gameflow?.gameData?.teamOne ?? []),
          ...(gameflow?.gameData?.teamTwo ?? []),
        ]
        const prePlayers = []
        for (const raw of flowPlayers) {
          if (!raw.puuid) continue
          const resolved =
            (await lcuGet<{ gameName?: string; tagLine?: string; displayName?: string; puuid?: string }>(
              lockfile,
              `/lol-summoner/v1/summoners/puuid/${raw.puuid}`,
            )) ||
            (await lcuGet<{ gameName?: string; tagLine?: string; displayName?: string; puuid?: string }>(
              lockfile,
              `/lol-summoner/v2/summoners/puuid/${raw.puuid}`,
            ))
          const gameName = resolved?.gameName || raw.summonerName || ''
          const tagLine = resolved?.tagLine || '???'
          if (!gameName) continue
          prePlayers.push({
            cellId: prePlayers.length,
            team: 'ally' as const,
            summonerName: `${gameName}#${tagLine}`,
            gameName,
            tagLine,
            assignedPosition: '—',
            championId: raw.championId ?? null,
            championName: null,
            championKey: null,
            championImage: null,
            isPickIntent: false,
            locked: true,
            championWinRate: null,
            championTier: null,
            spell1Id: null,
            spell2Id: null,
            puuid: raw.puuid,
            playerStats: null,
            live: null,
            links: {
              opgg: '',
              porofessor: '',
              uigg: '',
              lolchess: '',
            },
          })
        }

        const liveGame = await buildLolInGameSession({
          connected: true,
          phase,
          region,
          queueName: queueLabel(queueId, gameMode),
          currentSummoner,
          prePlayers,
        })
        if (liveGame) {
          res.json(await withGuides(liveGame, lockfile))
          return
        }
      }

      // ── TFT in-game via gameflow (le plus fiable) ──
      if (tft && inGame && gameflow?.gameData) {
        const live = await buildTftFromGameflow({
          lockfile,
          connected: true,
          phase,
          region,
          session: gameflow,
          currentSummoner,
        })
        res.json(await withGuides(live, lockfile))
        return
      }

      // ── TFT lobby / queue ──
      if (tft) {
        res.json(
          await withGuides(
            buildTftLobbySession({
              connected: true,
              phase,
              region,
              lobby: lobby ?? {
                gameConfig: { queueId, gameMode: gameMode || 'TFT' },
                members: [],
              },
              currentSummoner,
              inGamePlayers: livePlayers,
            }),
            lockfile,
          ),
        )
        return
      }

      // ── LoL classic draft ──
      const champSelect = await lcuGet<LcuChampSelectSession>(
        lockfile,
        '/lol-champ-select/v1/session',
      )

      if (champSelect?.myTeam?.length || champSelect?.theirTeam?.length) {
        const live = await buildLiveSession({
          connected: true,
          demo: false,
          phase,
          region,
          message: 'Champion select LoL détecté — alliés, ennemis et picks synchronisés.',
          session: champSelect,
          currentSummoner,
        })
        res.json(await withGuides(live, lockfile))
        return
      }

      // Fallback live client si la 1re passe a raté
      if (inGame && livePlayers?.length) {
        const liveGame = await buildLolInGameSession({
          connected: true,
          phase,
          region,
          queueName: queueLabel(queueId, gameMode),
          currentSummoner,
        })
        if (liveGame) {
          res.json(await withGuides(liveGame, lockfile))
          return
        }
      }

      // LoL in-game via gameflow teams if liveclient unavailable
      if (inGame && gameflow?.gameData?.teamOne?.length) {
        const live = await buildTftFromGameflow({
          lockfile,
          connected: true,
          phase,
          region,
          session: gameflow,
          currentSummoner,
        })
        // Force lol mode if not TFT
        if (!tft) {
          live.mode = 'lol'
          live.queueName = queueLabel(queueId, gameMode)
          live.message = `Partie LoL en cours — ${live.players.length} joueurs.`
        }
        res.json(await withGuides(live, lockfile))
        return
      }

      const you = currentSummoner?.gameName
        ? `${currentSummoner.gameName}#${currentSummoner.tagLine ?? ''}`
        : null

      res.json(
        await withGuides(
          emptySession({
            connected: true,
            phase,
            region,
            mode: lobby ? 'lol' : 'idle',
            queueName: queueLabel(queueId, gameMode),
            message: you
              ? `Connecté (${you}). ${lobby ? `Lobby ${queueLabel(queueId, gameMode)} — ` : ''}En attente du draft / de la partie…`
              : 'Client League détecté. En attente du lobby / draft…',
          }),
          lockfile,
        ),
      )
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  const candidates = [
    process.env.AETHER_UI_PATH,
    path.resolve(process.cwd(), 'ui'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), '..', 'ui'),
  ].filter(Boolean) as string[]
  const distPath = candidates.find((p) => fs.existsSync(p))
  if (distPath) {
    app.use(express.static(distPath))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }

  return app
}

export async function startServer(port = Number(process.env.PORT) || 8787) {
  const app = createApp()

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  try {
    await loadChampions()
    console.log(`[aether] Champions chargés`)
  } catch (e) {
    console.warn('[aether] Chargement champions différé:', e)
  }

  console.log(`[aether] API sur http://127.0.0.1:${port}`)
  return port
}

startServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
