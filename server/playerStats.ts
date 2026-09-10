import { lcuGet } from './lcu.js'
import type { LockfileData, PlayerCard, PlayerStats } from './types.js'

interface RankedQueue {
  wins?: number
  losses?: number
  /** Présent sur certaines payloads type chat (losses = games - wins) */
  games?: number
  tier?: string
  division?: string
  rank?: string
  leaguePoints?: number
  queueType?: string
}

interface RankedPayload {
  queueMap?: Record<string, RankedQueue>
  queues?: RankedQueue[]
  highestRankedEntry?: RankedQueue
  highestRankedEntrySR?: RankedQueue
}

interface TftHistoryGame {
  json?: {
    participants?: Array<{ puuid?: string; placement?: number }>
  }
}

const cache = new Map<string, { at: number; stats: PlayerStats }>()
const CACHE_MS = 45_000

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    const n = Number(v)
    if (n >= 0) return Math.floor(n)
  }
  return null
}

function wr(wins: number, losses: number): number | null {
  const total = wins + losses
  if (total <= 0) return null
  return Number(((wins / total) * 100).toFixed(1))
}

/** Ne calcule un WR que si wins ET losses sont fiables (évite 48W 0L → 100% fantôme). */
function wrFromQueue(q: RankedQueue | null | undefined): {
  rankedWR: number | null
  wins: number
  losses: number
} {
  if (!q) return { rankedWR: null, wins: 0, losses: 0 }
  const wins = asInt(q.wins)
  let losses = asInt(q.losses)
  const games = asInt(q.games)
  if (wins == null) return { rankedWR: null, wins: 0, losses: 0 }
  if (losses == null && games != null) losses = Math.max(0, games - wins)
  if (losses == null) return { rankedWR: null, wins, losses: 0 }
  // LCU renvoie parfois losses:0 avec beaucoup de wins pour les autres joueurs
  if (losses === 0 && wins >= 8) {
    return { rankedWR: null, wins, losses }
  }
  return { rankedWR: wr(wins, losses), wins, losses }
}

function pickQueue(
  ranked: RankedPayload | null | undefined,
  mode: 'lol' | 'tft',
  queueName?: string,
): RankedQueue | null {
  if (!ranked) return null
  const map = ranked.queueMap
  const fromMap = (key: string) => map?.[key] || null

  let q: RankedQueue | null = null
  if (mode === 'tft') {
    if (queueName?.toLowerCase().includes('double')) {
      q = fromMap('RANKED_TFT_DOUBLE_UP') || fromMap('RANKED_TFT')
    } else if (queueName?.toLowerCase().includes('hyper') || queueName?.toLowerCase().includes('turbo')) {
      q = fromMap('RANKED_TFT_TURBO') || fromMap('RANKED_TFT')
    } else {
      q = fromMap('RANKED_TFT') || fromMap('RANKED_TFT_DOUBLE_UP')
    }
  } else {
    q = fromMap('RANKED_SOLO_5x5') || fromMap('RANKED_FLEX_SR')
  }

  if (q) return q

  const queues = ranked.queues || []
  const prefer =
    mode === 'tft'
      ? ['RANKED_TFT', 'RANKED_TFT_DOUBLE_UP', 'RANKED_TFT_TURBO']
      : ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']
  for (const key of prefer) {
    const hit = queues.find((x) => x.queueType === key)
    if (hit) return hit
  }

  return ranked.highestRankedEntrySR || ranked.highestRankedEntry || queues[0] || null
}

async function tftRecentForm(
  lockfile: LockfileData,
  puuid: string,
): Promise<{ recentWR: number | null; recentGames: number; top4Rate: number | null }> {
  const hist = await lcuGet<{ games?: TftHistoryGame[] }>(
    lockfile,
    `/lol-match-history/v1/products/tft/${puuid}/matches`,
    5000,
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

function readWinFlag(part: Record<string, unknown> | null | undefined): boolean | null {
  if (!part) return null
  const stats =
    part.stats && typeof part.stats === 'object' ? (part.stats as Record<string, unknown>) : null
  const raw = stats && 'win' in stats ? stats.win : part.win
  if (typeof raw === 'boolean') return raw
  return null
}

function findParticipantForPuuid(
  g: Record<string, unknown>,
  puuid: string,
): Record<string, unknown> | null {
  const identities =
    (g.participantIdentities as Array<{
      participantId?: number
      player?: { puuid?: string }
    }>) || []
  const participants = (g.participants as Array<Record<string, unknown>>) || []

  const identity = identities.find((i) => i.player?.puuid === puuid)
  if (identity?.participantId != null) {
    const byId = participants.find((p) => Number(p.participantId) === identity.participantId)
    if (byId) return byId
  }

  const byPuuid = participants.find((p) => p.puuid === puuid)
  if (byPuuid) return byPuuid

  // Historique tronqué: 1 seul participant ET puuid match (ou pas de puuid sur la fiche)
  if (participants.length === 1) {
    const only = participants[0]!
    const onlyPuuid = typeof only.puuid === 'string' ? only.puuid : null
    if (!onlyPuuid || onlyPuuid === puuid) return only
  }

  return null
}

async function lolRecentForm(
  lockfile: LockfileData,
  puuid: string,
): Promise<{ recentWR: number | null; recentGames: number }> {
  const hist = await lcuGet<unknown>(
    lockfile,
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`,
    5000,
  )

  const root = hist as {
    games?: { games?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
  } | null
  const games = Array.isArray(root?.games)
    ? root.games
    : Array.isArray((root?.games as { games?: unknown })?.games)
      ? (root?.games as { games: Array<Record<string, unknown>> }).games
      : []

  let wins = 0
  let n = 0
  for (const g of games.slice(0, 20)) {
    const part = findParticipantForPuuid(g, puuid)
    const win = readWinFlag(part)
    if (win == null) continue
    n++
    if (win) wins++
  }
  if (!n) return { recentWR: null, recentGames: 0 }
  return { recentWR: Number(((wins / n) * 100).toFixed(1)), recentGames: n }
}

async function fetchRankedPayload(
  lockfile: LockfileData,
  puuid: string,
): Promise<RankedPayload | null> {
  const endpoints = [
    `/lol-ranked/v1/ranked-stats/${puuid}`,
    `/lol-ranked/v1/cached-ranked-stats/${puuid}`,
  ]
  for (const ep of endpoints) {
    const ranked = await lcuGet<RankedPayload>(lockfile, ep, 4000)
    if (ranked && (ranked.queueMap || ranked.queues?.length || ranked.highestRankedEntry)) {
      return ranked
    }
  }
  return null
}

export async function fetchPlayerStats(
  lockfile: LockfileData,
  puuid: string,
  mode: 'lol' | 'tft',
  queueName?: string,
): Promise<PlayerStats | null> {
  if (!puuid || puuid.length < 10) return null

  const cacheKey = `${mode}:${queueName ?? ''}:${puuid}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats

  try {
    const ranked = await fetchRankedPayload(lockfile, puuid)
    const q = pickQueue(ranked, mode, queueName)
    const { rankedWR, wins: rankedWins, losses: rankedLosses } = wrFromQueue(q)

    const form =
      mode === 'tft'
        ? await tftRecentForm(lockfile, puuid)
        : await lolRecentForm(lockfile, puuid)

    const top4 = 'top4Rate' in form ? form.top4Rate : null
    // Ignore recent WR trop peu fiable (< 5 games) pour le form score
    const recentReliable =
      form.recentGames >= 5 ? (mode === 'tft' ? top4 ?? form.recentWR : form.recentWR) : null
    // Si ranked est absurde/absent, le recent porte le form score
    const pieces = [rankedWR, recentReliable].filter((v): v is number => v != null)
    const formScore =
      pieces.length > 0
        ? Number((pieces.reduce((a, b) => a + b, 0) / pieces.length).toFixed(1))
        : null

    const tierRaw = q?.tier || null
    const tier = tierRaw && tierRaw !== 'NA' ? tierRaw : null
    const divisionRaw = q?.division || q?.rank || null
    const division = divisionRaw && divisionRaw !== 'NA' ? divisionRaw : null

    // Aucune donnée exploitable
    if (rankedWR == null && form.recentWR == null && top4 == null && !tier) {
      return null
    }

    const stats: PlayerStats = {
      rankedWR,
      recentWR: form.recentWR,
      top4Rate: top4,
      // Ne pas afficher un palmarès 48W 0L trompeur
      wins: rankedWR != null ? rankedWins : 0,
      losses: rankedWR != null ? rankedLosses : 0,
      tier,
      division,
      lp: asInt(q?.leaguePoints),
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
      if (!p.puuid) {
        results[i] = { ...p, playerStats: null }
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
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const a = score(allies)
  const e = score(enemies)

  if (a == null && e == null) return { ally: 50, enemy: 50 }
  if (a != null && e == null) {
    const ally = Number((50 + (a - 50) * 0.7).toFixed(1))
    return { ally, enemy: Number((100 - ally).toFixed(1)) }
  }
  if (a == null && e != null) {
    const enemy = Number((50 + (e - 50) * 0.7).toFixed(1))
    return { ally: Number((100 - enemy).toFixed(1)), enemy }
  }

  const allyPower = Math.pow(Math.max(a!, 1) / 50, 1.35)
  const enemyPower = Math.pow(Math.max(e!, 1) / 50, 1.35)
  const ally = Number(((allyPower / (allyPower + enemyPower)) * 100).toFixed(1))
  return { ally, enemy: Number((100 - ally).toFixed(1)) }
}
