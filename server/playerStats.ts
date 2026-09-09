import { lcuGet } from './lcu.js'
import type { LockfileData, PlayerCard, PlayerStats } from './types.js'

interface RankedQueue {
  wins?: number
  losses?: number
  tier?: string
  division?: string
  leaguePoints?: number
  queueType?: string
}

interface RankedPayload {
  queueMap?: Record<string, RankedQueue>
  queues?: RankedQueue[]
}

interface TftHistoryGame {
  json?: {
    participants?: Array<{ puuid?: string; placement?: number }>
  }
}

interface LolHistoryGame {
  participants?: Array<{ stats?: { win?: boolean }; participantId?: number }>
  participantIdentities?: Array<{
    participantId?: number
    player?: { puuid?: string; summonerName?: string }
  }>
  // newer shape sometimes nested
}

const cache = new Map<string, { at: number; stats: PlayerStats }>()
const CACHE_MS = 60_000

function wr(wins: number, losses: number): number | null {
  const total = wins + losses
  if (total <= 0) return null
  return Number(((wins / total) * 100).toFixed(1))
}

function pickQueue(map: Record<string, RankedQueue> | undefined, mode: 'lol' | 'tft', queueName?: string) {
  if (!map) return null
  if (mode === 'tft') {
    if (queueName?.toLowerCase().includes('double')) {
      return map.RANKED_TFT_DOUBLE_UP || map.RANKED_TFT || null
    }
    if (queueName?.toLowerCase().includes('hyper') || queueName?.toLowerCase().includes('turbo')) {
      return map.RANKED_TFT_TURBO || map.RANKED_TFT || null
    }
    return map.RANKED_TFT || map.RANKED_TFT_DOUBLE_UP || null
  }
  return map.RANKED_SOLO_5x5 || map.RANKED_FLEX_SR || null
}

async function tftRecentForm(
  lockfile: LockfileData,
  puuid: string,
): Promise<{ recentWR: number | null; recentGames: number; top4Rate: number | null }> {
  const hist = await lcuGet<{ games?: TftHistoryGame[] }>(
    lockfile,
    `/lol-match-history/v1/products/tft/${puuid}/matches`,
  )
  const games = hist?.games ?? []
  let top4 = 0
  let first = 0
  let n = 0
  for (const g of games.slice(0, 20)) {
    const part = g.json?.participants?.find((p) => p.puuid === puuid)
    if (!part?.placement) continue
    n++
    if (part.placement <= 4) top4++
    if (part.placement === 1) first++
  }
  if (!n) return { recentWR: null, recentGames: 0, top4Rate: null }
  return {
    recentWR: Number(((first / n) * 100).toFixed(1)),
    top4Rate: Number(((top4 / n) * 100).toFixed(1)),
    recentGames: n,
  }
}

async function lolRecentForm(
  lockfile: LockfileData,
  puuid: string,
): Promise<{ recentWR: number | null; recentGames: number }> {
  const hist = await lcuGet<{
    games?: {
      games?: Array<{
        gameMode?: string
        participants?: Array<{ stats?: { win?: boolean }; participantId?: number }>
        participantIdentities?: Array<{
          participantId?: number
          player?: { puuid?: string }
        }>
      }>
    }
  }>(lockfile, `/lol-match-history/v1/products/lol/${puuid}/matches`)

  const games = hist?.games?.games ?? []
  let wins = 0
  let n = 0
  for (const g of games.slice(0, 20)) {
    // skip weird modes if needed
    const identity = g.participantIdentities?.find((i) => i.player?.puuid === puuid)
    const pid = identity?.participantId
    const part =
      (pid != null ? g.participants?.find((p) => p.participantId === pid) : null) ??
      g.participants?.[0]
    if (!part?.stats || typeof part.stats.win !== 'boolean') continue
    n++
    if (part.stats.win) wins++
  }
  if (!n) return { recentWR: null, recentGames: 0 }
  return { recentWR: Number(((wins / n) * 100).toFixed(1)), recentGames: n }
}

export async function fetchPlayerStats(
  lockfile: LockfileData,
  puuid: string,
  mode: 'lol' | 'tft',
  queueName?: string,
): Promise<PlayerStats | null> {
  const cacheKey = `${mode}:${queueName ?? ''}:${puuid}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats

  try {
    const ranked = await lcuGet<RankedPayload>(lockfile, `/lol-ranked/v1/ranked-stats/${puuid}`)
    const q = pickQueue(ranked?.queueMap, mode, queueName)
    const rankedWins = q?.wins ?? 0
    const rankedLosses = q?.losses ?? 0
    const rankedWR = wr(rankedWins, rankedLosses)

    const form =
      mode === 'tft'
        ? await tftRecentForm(lockfile, puuid)
        : await lolRecentForm(lockfile, puuid)

    const top4 = 'top4Rate' in form ? form.top4Rate : null
    // Form score: ranked season WR + recent form
    const primaryRecent = mode === 'tft' ? top4 ?? form.recentWR : form.recentWR
    const pieces = [rankedWR, primaryRecent].filter((v): v is number => v != null)
    const formScore =
      pieces.length > 0
        ? Number((pieces.reduce((a, b) => a + b, 0) / pieces.length).toFixed(1))
        : null

    const tier = q?.tier && q.tier !== 'NA' ? q.tier : null
    const division = q?.division && q.division !== 'NA' ? q.division : null

    const stats: PlayerStats = {
      rankedWR,
      recentWR: form.recentWR,
      top4Rate: top4,
      wins: rankedWins,
      losses: rankedLosses,
      tier,
      division,
      lp: q?.leaguePoints ?? null,
      recentGames: form.recentGames,
      formScore,
      source: 'lcu-history',
    }
    cache.set(cacheKey, { at: Date.now(), stats })
    return stats
  } catch {
    return null
  }
}

export async function enrichPlayersWithStats(
  lockfile: LockfileData,
  players: PlayerCard[],
  mode: 'lol' | 'tft',
  queueName?: string,
): Promise<PlayerCard[]> {
  const results: PlayerCard[] = new Array(players.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= players.length) return
      const p = players[i]!
      if (!p.puuid || p.tagLine === '???' || p.gameName === 'Joueur') {
        results[i] = p
        continue
      }
      const stats = await fetchPlayerStats(lockfile, p.puuid, mode, queueName)
      results[i] = { ...p, playerStats: stats }
    }
  }

  await Promise.all([worker(), worker(), worker()])
  return results.map((p, i) => p ?? players[i]!)
}

/** Convertit les form scores joueurs en % de win d’équipe */
export function computeTeamWinChance(
  allies: PlayerCard[],
  enemies: PlayerCard[],
): { ally: number; enemy: number } {
  const score = (list: PlayerCard[]) => {
    const vals = list
      .map((p) => p.playerStats?.formScore ?? p.playerStats?.rankedWR ?? p.playerStats?.top4Rate)
      .filter((v): v is number => typeof v === 'number')
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const a = score(allies)
  const e = score(enemies)

  if (a == null && e == null) return { ally: 50, enemy: 50 }
  if (a != null && e == null) {
    // compress around 50
    const ally = Number((50 + (a - 50) * 0.7).toFixed(1))
    return { ally, enemy: Number((100 - ally).toFixed(1)) }
  }
  if (a == null && e != null) {
    const enemy = Number((50 + (e - 50) * 0.7).toFixed(1))
    return { ally: Number((100 - enemy).toFixed(1)), enemy }
  }

  // Softmax-ish from two averages
  const allyPower = Math.pow(Math.max(a!, 1) / 50, 1.35)
  const enemyPower = Math.pow(Math.max(e!, 1) / 50, 1.35)
  const ally = Number(((allyPower / (allyPower + enemyPower)) * 100).toFixed(1))
  return { ally, enemy: Number((100 - ally).toFixed(1)) }
}
