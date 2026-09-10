import { lcuGet } from './lcu.js'
import { getChampionById, loadChampions } from './champions.js'
import type { LockfileData } from './types.js'
import { fetchPlayerStats } from './playerStats.js'
import { resolveCurrentSummoner } from './summoner.js'

const DDRAGON_FALLBACK = '15.6.1'

export interface ProfileHome {
  connected: boolean
  gameName: string
  tagLine: string
  puuid: string
  profileIconId: number
  profileIconUrl: string
  summonerLevel: number
  stats: {
    rankedWR: number | null
    recentWR: number | null
    wins: number
    losses: number
    tier: string | null
    division: string | null
    lp: number | null
    recentGames: number
    formScore: number | null
  } | null
  matches: MatchSummary[]
}

export interface MatchSummary {
  gameId: number
  gameCreation: number
  gameDuration: number
  queueId: number
  queueLabel: string
  win: boolean
  championId: number
  championName: string
  championImage: string | null
  kills: number
  deaths: number
  assists: number
  cs: number
  gold: number
  role: string
  items: number[]
  spell1Id: number | null
  spell2Id: number | null
  /** Mini-verdict auto (toi) pour la liste historique */
  autoGrade: DebriefPlayer['grade'] | null
  autoVerdict: string | null
}

export interface DebriefPlayer {
  gameName: string
  tagLine: string
  team: 'ally' | 'enemy'
  championId: number
  championName: string
  championImage: string | null
  kills: number
  deaths: number
  assists: number
  cs: number
  gold: number
  /** Dégâts aux champions */
  damage: number
  damageTurrets: number
  damageObjectives: number
  damageTaken: number
  mitigated: number
  heal: number
  shield: number
  cc: number
  vision: number
  items: number[]
  win: boolean
  isYou: boolean
  grade: 'CARRY' | 'SOLID' | 'MEH' | 'INT' | 'FEED' | 'GHOST'
  verdict: string
  score: number
}

export interface MatchDebrief {
  gameId: number
  win: boolean
  gameDuration: number
  queueLabel: string
  headline: string
  why: string[]
  players: DebriefPlayer[]
  mvp: string | null
  intFeed: string | null
}

function queueLabel(id?: number): string {
  switch (id) {
    case 420:
      return 'Ranked Solo/Duo'
    case 440:
      return 'Ranked Flex'
    case 400:
      return 'Normal Draft'
    case 430:
      return 'Normal Blind'
    case 450:
      return 'ARAM'
    case 1700:
      return 'Arena'
    case 490:
      return 'Quickplay'
    default:
      return id != null ? `Queue ${id}` : 'LoL'
  }
}

function roleLabel(lane?: string, role?: string, position?: string): string {
  const raw = `${lane || ''} ${role || ''} ${position || ''}`.toUpperCase()
  if (raw.includes('TOP')) return 'TOP'
  if (raw.includes('JUNG')) return 'JGL'
  if (raw.includes('MID') || raw.includes('MIDDLE')) return 'MID'
  if (raw.includes('SUPPORT') || raw.includes('UTILITY')) return 'SUP'
  if (raw.includes('ADC') || raw.includes('BOTTOM') || raw.includes('BOT')) return 'ADC'
  return '-'
}

/** Participant normalisé (ancien LCU stats{} OU format plat type Match-v5) */
interface NormPart {
  participantId: number | null
  puuid: string | null
  championId: number
  spell1Id: number | null
  spell2Id: number | null
  teamId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  cs: number
  gold: number
  damage: number
  damageTurrets: number
  damageObjectives: number
  damageTaken: number
  mitigated: number
  heal: number
  shield: number
  cc: number
  vision: number
  items: number[]
  lane: string
  role: string
  position: string
  gameName: string
  tagLine: string
}

function pickStat(stats: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const n = asNum(stats[k])
    if (n != null && n >= 0) return n
  }
  return 0
}

interface RawGame {
  gameId?: number | string
  gameCreation?: number
  gameDuration?: number
  queueId?: number
  gameMode?: string
  participants?: Record<string, unknown>[]
  participantIdentities?: Array<{
    participantId?: number
    player?: {
      puuid?: string
      gameName?: string
      tagLine?: string
      summonerName?: string
      riotIdGameName?: string
      riotIdTagLine?: string
    }
  }>
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function itemsFrom(obj: Record<string, unknown> | null | undefined): number[] {
  if (!obj) return []
  return [0, 1, 2, 3, 4, 5, 6]
    .map((i) => asNum(obj[`item${i}`]))
    .filter((id): id is number => id != null && id > 0)
}

function nameFromPlayer(p?: {
  gameName?: string
  tagLine?: string
  summonerName?: string
  riotIdGameName?: string
  riotIdTagLine?: string
}): { gameName: string; tagLine: string } {
  if (!p) return { gameName: 'Joueur', tagLine: '???' }
  if (p.riotIdGameName) return { gameName: p.riotIdGameName, tagLine: p.riotIdTagLine || '???' }
  if (p.gameName) return { gameName: p.gameName, tagLine: p.tagLine || '???' }
  if (p.summonerName?.includes('#')) {
    const [g, t] = p.summonerName.split('#')
    return { gameName: g || 'Joueur', tagLine: t || '???' }
  }
  return { gameName: p.summonerName || 'Joueur', tagLine: '???' }
}

function normalizeParticipant(
  raw: Record<string, unknown>,
  identity?: RawGame['participantIdentities'] extends (infer I)[] | undefined ? I : never,
): NormPart {
  const stats =
    raw.stats && typeof raw.stats === 'object' ? (raw.stats as Record<string, unknown>) : raw
  const timeline =
    raw.timeline && typeof raw.timeline === 'object'
      ? (raw.timeline as Record<string, unknown>)
      : {}
  const fromId = nameFromPlayer(identity?.player)
  const riotName =
    typeof raw.riotIdGameName === 'string'
      ? {
          gameName: raw.riotIdGameName as string,
          tagLine: String(raw.riotIdTagLine || raw.tagLine || '???'),
        }
      : typeof raw.gameName === 'string'
        ? { gameName: raw.gameName as string, tagLine: String(raw.tagLine || '???') }
        : fromId

  const puuid =
    (typeof raw.puuid === 'string' && raw.puuid) ||
    identity?.player?.puuid ||
    (raw.player && typeof (raw.player as { puuid?: string }).puuid === 'string'
      ? (raw.player as { puuid: string }).puuid
      : null)

  return {
    participantId: asNum(raw.participantId),
    puuid,
    championId: asNum(raw.championId) || 0,
    spell1Id: asNum(raw.spell1Id) ?? asNum(raw.summoner1Id),
    spell2Id: asNum(raw.spell2Id) ?? asNum(raw.summoner2Id),
    teamId: asNum(raw.teamId) || 100,
    win: Boolean(stats.win),
    kills: asNum(stats.kills) || 0,
    deaths: asNum(stats.deaths) || 0,
    assists: asNum(stats.assists) || 0,
    cs:
      (asNum(stats.totalMinionsKilled) || 0) +
      (asNum(stats.neutralMinionsKilled) || 0) +
      (asNum(stats.totalAllyJungleMinionsKilled) || 0) +
      (asNum(stats.totalEnemyJungleMinionsKilled) || 0),
    gold: asNum(stats.goldEarned) || 0,
    damage: pickStat(stats, 'totalDamageDealtToChampions'),
    damageTurrets: pickStat(
      stats,
      'damageDealtToTurrets',
      'damageDealtToBuildings',
      'totalDamageDealtToTurrets',
    ),
    damageObjectives: (() => {
      const obj = pickStat(stats, 'damageDealtToObjectives')
      const tur = pickStat(
        stats,
        'damageDealtToTurrets',
        'damageDealtToBuildings',
        'totalDamageDealtToTurrets',
      )
      // damageDealtToObjectives inclut souvent les tours → on isole le reste (drakes, baron, etc.)
      return obj > tur ? obj - tur : obj
    })(),
    damageTaken: pickStat(stats, 'totalDamageTaken'),
    mitigated: pickStat(stats, 'damageSelfMitigated'),
    heal: Math.max(
      pickStat(stats, 'totalHealsOnTeammates'),
      pickStat(stats, 'totalHeal'),
    ),
    shield: pickStat(stats, 'totalDamageShieldedOnTeammates'),
    cc: pickStat(stats, 'timeCCingOthers'),
    vision: asNum(stats.visionScore) || 0,
    items: itemsFrom(stats),
    lane: String(timeline.lane || raw.lane || raw.individualPosition || ''),
    role: String(timeline.role || raw.role || ''),
    position: String(raw.teamPosition || raw.individualPosition || ''),
    gameName: riotName.gameName,
    tagLine: riotName.tagLine,
  }
}

function durationSeconds(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return 0
  // LCU parfois en ms
  if (raw > 20_000) return Math.round(raw / 1000)
  return Math.round(raw)
}

function extractGames(hist: unknown): RawGame[] {
  if (!hist || typeof hist !== 'object') return []
  const h = hist as Record<string, unknown>
  const gamesNode = h.games
  if (Array.isArray(gamesNode)) return gamesNode as RawGame[]
  if (gamesNode && typeof gamesNode === 'object') {
    const inner = (gamesNode as { games?: unknown }).games
    if (Array.isArray(inner)) return inner as RawGame[]
  }
  if (Array.isArray(h.gameList)) return h.gameList as RawGame[]
  return []
}

function findYouPart(
  game: RawGame,
  puuid: string | null,
  gameName?: string | null,
  tagLine?: string | null,
): NormPart | null {
  const parts = allNormParts(game)
  if (!parts.length) return null

  if (puuid) {
    const byPuuid = parts.find((p) => p.puuid && p.puuid === puuid)
    if (byPuuid) return byPuuid

    const identity = game.participantIdentities?.find((i) => i.player?.puuid === puuid)
    if (identity?.participantId != null) {
      const hit = parts.find((p) => p.participantId === identity.participantId)
      if (hit) return hit
    }
  }

  if (gameName) {
    const name = gameName.toLowerCase()
    const tag = (tagLine || '').toLowerCase()
    const byName =
      parts.find(
        (p) =>
          p.gameName.toLowerCase() === name &&
          (!tag || p.tagLine.toLowerCase() === tag || p.tagLine === '???'),
      ) || parts.find((p) => p.gameName.toLowerCase() === name)
    if (byName) return byName
  }

  // Historique parfois tronqué : un seul participant = toi
  if (parts.length === 1) return parts[0]!
  return null
}

function allNormParts(game: RawGame): NormPart[] {
  return (game.participants || []).map((p) => {
    const pid = asNum(p.participantId)
    const identity = game.participantIdentities?.find((i) => i.participantId === pid)
    return normalizeParticipant(p, identity)
  })
}

async function ddragonVersion(): Promise<string> {
  try {
    const c = await loadChampions()
    return c?.version || DDRAGON_FALLBACK
  } catch {
    return DDRAGON_FALLBACK
  }
}

async function fetchRawMatchList(
  lockfile: LockfileData,
  puuid: string | null,
  limit: number,
): Promise<RawGame[]> {
  const end = Math.max(limit - 1, 0)
  const endpoints = [
    // Sans puuid (souvent plus fiable en lobby)
    `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${end}`,
    `/lol-match-history/v1/products/lol/current-summoner/matches`,
  ]
  if (puuid) {
    endpoints.push(
      `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${end}`,
      `/lol-match-history/v1/products/lol/${puuid}/matches`,
    )
  }
  for (const ep of endpoints) {
    const hist = await lcuGet<unknown>(lockfile, ep, 6000)
    const games = extractGames(hist)
    if (games.length) return games
  }
  return []
}

export async function buildProfileHome(lockfile: LockfileData): Promise<ProfileHome | null> {
  const me = await resolveCurrentSummoner(lockfile)
  if (!me?.gameName) return null

  const version = await ddragonVersion()
  const iconId = me.profileIconId || 29
  const stats = me.puuid ? await fetchPlayerStats(lockfile, me.puuid, 'lol') : null
  const matches = await fetchMatchSummaries(lockfile, me.puuid, 20, {
    gameName: me.gameName,
    tagLine: me.tagLine,
  })

  return {
    connected: true,
    gameName: me.gameName,
    tagLine: me.tagLine || 'EUW',
    puuid: me.puuid || '',
    profileIconId: iconId,
    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`,
    summonerLevel: me.summonerLevel || 0,
    stats: stats
      ? {
          rankedWR: stats.rankedWR,
          recentWR: stats.recentWR,
          wins: stats.wins,
          losses: stats.losses,
          tier: stats.tier,
          division: stats.division,
          lp: stats.lp,
          recentGames: stats.recentGames,
          formScore: stats.formScore,
        }
      : null,
    matches,
  }
}

function soloGrade(p: {
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  cs: number
}): { grade: DebriefPlayer['grade']; verdict: string } {
  const kda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths
  if (p.deaths >= 9 && kda < 1) {
    return { grade: 'FEED', verdict: `Tu as feed (${p.kills}/${p.deaths}/${p.assists}).` }
  }
  if (p.deaths >= 6 && kda < 1.3) {
    return { grade: 'INT', verdict: `Trop de morts (${p.deaths}) pour trop peu d’impact.` }
  }
  if (kda >= 3 && (p.kills >= 6 || p.assists >= 10)) {
    return { grade: 'CARRY', verdict: `Tu as carry (KDA ${kda.toFixed(1)}).` }
  }
  if (kda >= 2) {
    return { grade: 'SOLID', verdict: `Presta propre (KDA ${kda.toFixed(1)}).` }
  }
  if (p.cs < 50 && p.gold < 8000) {
    return { grade: 'GHOST', verdict: `Peu de présence (farm / or bas).` }
  }
  return { grade: 'MEH', verdict: `Impact moyen (KDA ${kda.toFixed(1)}).` }
}

export async function fetchMatchSummaries(
  lockfile: LockfileData,
  puuid: string | null,
  limit = 20,
  identity?: { gameName?: string; tagLine?: string } | null,
): Promise<MatchSummary[]> {
  const games = await fetchRawMatchList(lockfile, puuid, limit)
  const out: MatchSummary[] = []

  for (const g of games.slice(0, limit)) {
    const gameId = asNum(g.gameId)
    if (gameId == null) continue
    const you = findYouPart(g, puuid, identity?.gameName, identity?.tagLine)
    if (!you) continue

    const champ = you.championId ? await getChampionById(you.championId) : null
    const mini = soloGrade(you)

    out.push({
      gameId,
      gameCreation: g.gameCreation || 0,
      gameDuration: durationSeconds(g.gameDuration),
      queueId: g.queueId || 0,
      queueLabel: queueLabel(g.queueId),
      win: you.win,
      championId: you.championId,
      championName: champ?.name || `Champ ${you.championId}`,
      championImage: champ?.image || null,
      kills: you.kills,
      deaths: you.deaths,
      assists: you.assists,
      cs: you.cs,
      gold: you.gold,
      role: roleLabel(you.lane, you.role, you.position),
      items: you.items,
      spell1Id: you.spell1Id,
      spell2Id: you.spell2Id,
      autoGrade: mini.grade,
      autoVerdict: mini.verdict,
    })
  }

  return out
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

function computePlayerScore(p: {
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  damageTurrets: number
  damageObjectives: number
  damageTaken: number
  mitigated: number
  heal: number
  shield: number
  cc: number
  vision: number
  cs: number
  role: string
  teamAvgGold: number
  teamAvgDmg: number
  teamAvgTurret: number
  teamAvgObj: number
  teamAvgTaken: number
  teamAvgUtility: number
  teamAvgDeaths: number
}): number {
  const kda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths
  const goldRatio = p.teamAvgGold > 0 ? p.gold / p.teamAvgGold : 1
  const dmgRatio = p.teamAvgDmg > 0 ? p.damage / p.teamAvgDmg : 1
  const turretRatio = p.teamAvgTurret > 0 ? p.damageTurrets / p.teamAvgTurret : 1
  const objRatio = p.teamAvgObj > 0 ? p.damageObjectives / p.teamAvgObj : 1
  const tankRatio = p.teamAvgTaken > 0 ? (p.damageTaken + p.mitigated * 0.35) / p.teamAvgTaken : 1
  const utility = p.heal + p.shield * 1.2 + p.cc * 80 + p.vision * 40
  const utilRatio = p.teamAvgUtility > 0 ? utility / p.teamAvgUtility : 1
  const deathRatio = p.teamAvgDeaths > 0 ? p.deaths / p.teamAvgDeaths : 1
  const role = p.role

  // Poids selon le rôle (supporte = utilité, adc = dmg, etc.)
  let wKda = 5.2
  let wDmg = 22
  let wTurret = 10
  let wObj = 8
  let wTank = 4
  let wUtil = 6
  let wGold = 14
  if (role === 'ADC' || role === 'MID') {
    wDmg = 28
    wTurret = 12
    wUtil = 3
    wTank = 2
  } else if (role === 'TOP') {
    wDmg = 18
    wTank = 14
    wTurret = 10
  } else if (role === 'JGL') {
    wObj = 16
    wDmg = 20
    wTurret = 6
  } else if (role === 'SUP') {
    wDmg = 10
    wUtil = 22
    wTank = 8
    wGold = 6
    wKda = 6
  }

  let score = 48
  score += Math.min(26, kda * wKda)
  score += (goldRatio - 1) * wGold
  score += (dmgRatio - 1) * wDmg
  score += (turretRatio - 1) * wTurret
  score += (objRatio - 1) * wObj
  score += (tankRatio - 1) * wTank
  score += (utilRatio - 1) * wUtil
  score -= (deathRatio - 1) * 13
  score -= Math.max(0, p.deaths - 4) * 2.2
  if (p.deaths >= 8 && kda < 1.2) score -= 12
  if (role !== 'SUP' && p.cs < 40 && p.gold < p.teamAvgGold * 0.55) score -= 10
  // Bonus kill participation légère via assists
  score += Math.min(6, p.assists * 0.35)
  return Math.max(0, Math.min(100, Math.round(score)))
}

function gradeFromScore(p: {
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  damageTurrets: number
  damageObjectives: number
  cs: number
  role: string
  teamAvgGold: number
  teamAvgDmg: number
  teamAvgTurret: number
  teamMaxDmg: number
  teamMaxTurret: number
  teamMaxObj: number
  score: number
  rankOnTeam: number
}): { grade: DebriefPlayer['grade']; verdict: string } {
  const kda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths
  const goldRatio = p.teamAvgGold > 0 ? p.gold / p.teamAvgGold : 1
  const dmgRatio = p.teamAvgDmg > 0 ? p.damage / p.teamAvgDmg : 1
  const ledDmg = p.teamMaxDmg > 0 && p.damage >= p.teamMaxDmg * 0.98
  const ledTurret = p.teamMaxTurret > 0 && p.damageTurrets >= p.teamMaxTurret * 0.98 && p.damageTurrets > 0
  const ledObj = p.teamMaxObj > 0 && p.damageObjectives >= p.teamMaxObj * 0.98 && p.damageObjectives > 0

  if (p.deaths >= 9 && kda < 1 && goldRatio < 0.9) {
    return {
      grade: 'FEED',
      verdict: `Feed dur (${p.kills}/${p.deaths}/${p.assists}). Gros trou d'XP/or pour l'équipe.`,
    }
  }
  if (p.deaths >= 7 && kda < 1.35 && dmgRatio < 0.8 && p.score < 52) {
    return {
      grade: 'INT',
      verdict: `Trop de morts (${p.deaths}) pour trop peu d’impact.`,
    }
  }
  if (
    p.role !== 'SUP' &&
    p.cs < 50 &&
    p.gold < p.teamAvgGold * 0.6 &&
    p.damage < p.teamAvgDmg * 0.55 &&
    p.score < 48
  ) {
    return {
      grade: 'GHOST',
      verdict: `Fantôme de la map, quasi aucun farm ni dégâts.`,
    }
  }

  const dmgBits: string[] = []
  if (ledDmg) dmgBits.push(`top dégâts champs (${formatK(p.damage)})`)
  if (ledTurret) dmgBits.push(`top tours (${formatK(p.damageTurrets)})`)
  if (ledObj) dmgBits.push(`top objectifs (${formatK(p.damageObjectives)})`)
  const dmgNote = dmgBits.length ? ` ${dmgBits.join(', ')}.` : ''

  if (p.rankOnTeam === 0 && p.score >= 65) {
    return {
      grade: 'CARRY',
      verdict: `Carry clair (KDA ${kda.toFixed(1)}).${dmgNote || ' A porté fights / économie.'}`,
    }
  }
  if (p.score >= 55) {
    return {
      grade: 'SOLID',
      verdict: `Presta propre (KDA ${kda.toFixed(1)}).${dmgNote || ' Rôle tenu.'}`,
    }
  }
  return {
    grade: 'MEH',
    verdict: `Impact moyen (KDA ${kda.toFixed(1)}). Dégâts ${formatK(p.damage)}.`,
  }
}

export async function buildMatchDebrief(
  lockfile: LockfileData,
  gameId: number,
  youPuuid?: string | null,
): Promise<MatchDebrief | null> {
  const me = youPuuid
    ? { puuid: youPuuid, gameName: null as string | null, tagLine: null as string | null }
    : await resolveCurrentSummoner(lockfile)
  const mePuuid = me?.puuid || null
  const meName = me && 'gameName' in me ? me.gameName : null
  const meTag = me && 'tagLine' in me ? me.tagLine : null
  if (!mePuuid && !meName) return null

  // Detail game : timeout plus long + plusieurs chemins LCU
  let game: RawGame | null = null
  const detailPaths = [
    `/lol-match-history/v1/games/${gameId}`,
    `/lol-match-history/v1/games/${gameId}/`,
  ]
  for (const path of detailPaths) {
    game = await lcuGet<RawGame>(lockfile, path, 8000)
    if (game?.participants?.length) break
    game = null
  }

  if (!game?.participants?.length) {
    const list = await fetchRawMatchList(lockfile, mePuuid, 30)
    game =
      list.find((g) => asNum(g.gameId) === gameId) ||
      list.find((g) => String(g.gameId) === String(gameId)) ||
      null
  }

  if (!game?.participants?.length) return null

  const parts = allNormParts(game)
  if (!parts.length) return null

  let you = findYouPart(game, mePuuid, meName, meTag)
  if (!you && parts.length === 1) you = parts[0]!
  if (!you) you = parts[0]!

  const yourTeamId = you.teamId
  const youWon = you.win
  const allyRows = parts.filter((p) => p.teamId === yourTeamId)
  const enemyRows = parts.filter((p) => p.teamId !== yourTeamId)
  const avg = (list: NormPart[], key: keyof NormPart) =>
    list.length ? list.reduce((s, r) => s + (Number(r[key]) || 0), 0) / list.length : 0
  const teamUtilityAvg = (list: NormPart[]) =>
    list.length
      ? list.reduce((s, r) => s + r.heal + r.shield * 1.2 + r.cc * 80 + r.vision * 40, 0) / list.length
      : 0
  const teamMax = (list: NormPart[], key: 'damage' | 'damageTurrets' | 'damageObjectives') =>
    list.reduce((m, r) => Math.max(m, r[key] || 0), 0)

  type Scored = {
    part: NormPart
    score: number
    teamAvgGold: number
    teamAvgDmg: number
    teamAvgTurret: number
    teamMaxDmg: number
    teamMaxTurret: number
    teamMaxObj: number
    role: string
  }
  const scored: Scored[] = parts.map((r) => {
    const teamRows = r.teamId === yourTeamId ? allyRows : enemyRows
    const role = roleLabel(r.lane, r.role, r.position)
    const teamAvgGold = avg(teamRows, 'gold')
    const teamAvgDmg = avg(teamRows, 'damage')
    const teamAvgTurret = avg(teamRows, 'damageTurrets')
    const teamAvgObj = avg(teamRows, 'damageObjectives')
    const teamAvgTaken = avg(teamRows, 'damageTaken')
    const teamAvgDeaths = avg(teamRows, 'deaths')
    return {
      part: r,
      role,
      score: computePlayerScore({
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists,
        gold: r.gold,
        damage: r.damage,
        damageTurrets: r.damageTurrets,
        damageObjectives: r.damageObjectives,
        damageTaken: r.damageTaken,
        mitigated: r.mitigated,
        heal: r.heal,
        shield: r.shield,
        cc: r.cc,
        vision: r.vision,
        cs: r.cs,
        role,
        teamAvgGold,
        teamAvgDmg,
        teamAvgTurret,
        teamAvgObj,
        teamAvgTaken,
        teamAvgUtility: teamUtilityAvg(teamRows),
        teamAvgDeaths,
      }),
      teamAvgGold,
      teamAvgDmg,
      teamAvgTurret,
      teamMaxDmg: teamMax(teamRows, 'damage'),
      teamMaxTurret: teamMax(teamRows, 'damageTurrets'),
      teamMaxObj: teamMax(teamRows, 'damageObjectives'),
    }
  })

  const rankOnTeam = (row: Scored) => {
    const same = scored
      .filter((x) => x.part.teamId === row.part.teamId)
      .sort((a, b) => b.score - a.score)
    return same.findIndex((x) => x.part === row.part)
  }

  const players: DebriefPlayer[] = []
  for (const row of scored) {
    const r = row.part
    const g = gradeFromScore({
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      gold: r.gold,
      damage: r.damage,
      damageTurrets: r.damageTurrets,
      damageObjectives: r.damageObjectives,
      cs: r.cs,
      role: row.role,
      teamAvgGold: row.teamAvgGold,
      teamAvgDmg: row.teamAvgDmg,
      teamAvgTurret: row.teamAvgTurret,
      teamMaxDmg: row.teamMaxDmg,
      teamMaxTurret: row.teamMaxTurret,
      teamMaxObj: row.teamMaxObj,
      score: row.score,
      rankOnTeam: rankOnTeam(row),
    })
    const champ = r.championId ? await getChampionById(r.championId) : null
    const isYou =
      r === you ||
      Boolean(r.puuid && r.puuid === mePuuid) ||
      (you.participantId != null && r.participantId === you.participantId)
    players.push({
      gameName: r.gameName,
      tagLine: r.tagLine,
      team: r.teamId === yourTeamId ? 'ally' : 'enemy',
      championId: r.championId,
      championName: champ?.name || '?',
      championImage: champ?.image || null,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      cs: r.cs,
      gold: r.gold,
      damage: r.damage,
      damageTurrets: r.damageTurrets,
      damageObjectives: r.damageObjectives,
      damageTaken: r.damageTaken,
      mitigated: r.mitigated,
      heal: r.heal,
      shield: r.shield,
      cc: r.cc,
      vision: r.vision,
      items: r.items,
      win: r.win,
      isYou,
      grade: g.grade,
      verdict: isYou
        ? g.verdict
            .replace(/^Trop de/, 'Tu as trop de')
            .replace(/^Fantôme/, 'Tu étais un fantôme')
            .replace(/^Feed/, 'Tu as feed')
            .replace(/^Carry/, 'Tu as carry')
        : g.verdict,
      score: row.score,
    })
  }

  players.sort((a, b) => {
    if (a.team !== b.team) return a.team === 'ally' ? -1 : 1
    return b.score - a.score
  })

  const ally = players.filter((p) => p.team === 'ally')
  const enemy = players.filter((p) => p.team === 'enemy')
  // MVP = meilleur score allié (plus le premier tag CARRY au hasard)
  const mvp = [...ally].sort((a, b) => b.score - a.score)[0] || null
  const intFeed =
    ally.find((p) => p.grade === 'FEED' || p.grade === 'INT') ||
    [...ally].sort((a, b) => a.score - b.score)[0] ||
    null
  const enemyCarry = [...enemy].sort((a, b) => b.score - a.score)[0] || null

  const why: string[] = []
  if (youWon) {
    why.push('Victoire: votre équipe a mieux converti fights / objectifs.')
    if (mvp) why.push(`MVP allié : ${mvp.gameName} (${mvp.championName}): ${mvp.verdict}`)
  } else {
    why.push('Défaite: trop peu d’avantage économique ou trop de morts inutiles.')
    if (intFeed && (intFeed.grade === 'FEED' || intFeed.grade === 'INT' || intFeed.score < 40)) {
      why.push(`Point faible : ${intFeed.gameName} (${intFeed.championName}): ${intFeed.verdict}`)
    }
    if (enemyCarry && enemyCarry.score >= 65) {
      why.push(`Ils ont été portés par ${enemyCarry.gameName} (${enemyCarry.championName}).`)
    }
  }

  const topDmg = [...ally].sort((a, b) => b.damage - a.damage)[0]
  const topTurret = [...ally].sort((a, b) => b.damageTurrets - a.damageTurrets)[0]
  if (topDmg && topDmg.damage > 0) {
    why.push(`Top dégâts champs alliés : ${topDmg.championName} (${formatK(topDmg.damage)}).`)
  }
  if (topTurret && topTurret.damageTurrets > 1500) {
    why.push(`Top dégâts tours : ${topTurret.championName} (${formatK(topTurret.damageTurrets)}).`)
  }

  const youCard = players.find((p) => p.isYou)
  if (youCard) why.push(`Toi (${youCard.championName}) : ${youCard.verdict}`)

  const headline = youWon
    ? mvp && (mvp.grade === 'CARRY' || mvp.score >= 70)
      ? `WIN: ${mvp.championName} a carry`
      : mvp
        ? `WIN: ${mvp.championName} en tête`
        : 'WIN: équipe propre'
    : `LOSS: ${intFeed && intFeed.score < 45 ? `${intFeed.championName} a plombé la game` : 'manque d’impact collectif'}`

  return {
    gameId,
    win: youWon,
    gameDuration: durationSeconds(game.gameDuration),
    queueLabel: queueLabel(game.queueId),
    headline,
    why,
    players,
    mvp: mvp ? `${mvp.gameName} · ${mvp.championName}` : null,
    intFeed: intFeed && intFeed.score < 45 ? `${intFeed.gameName} · ${intFeed.championName}` : null,
  }
}

function extractEogGameId(eog: unknown): number | null {
  if (!eog || typeof eog !== 'object') return null
  const o = eog as Record<string, unknown>
  const direct = asNum(o.gameId) ?? asNum((o as { muleGameId?: unknown }).muleGameId)
  if (direct != null) return direct
  if (o.game && typeof o.game === 'object') {
    const g = o.game as Record<string, unknown>
    const nested = asNum(g.id) ?? asNum(g.gameId)
    if (nested != null) return nested
  }
  return null
}

/** Essaie le bloc fin de game LCU, sinon dernière partie de l’historique */
export async function buildLatestDebrief(lockfile: LockfileData): Promise<MatchDebrief | null> {
  const me = await resolveCurrentSummoner(lockfile)
  if (!me?.gameName) return null

  const eog = await lcuGet<unknown>(lockfile, '/lol-end-of-game/v1/eog-stats-block', 5000)
  const eogId = extractEogGameId(eog)

  if (eogId != null) {
    const d = await buildMatchDebrief(lockfile, eogId, me.puuid || undefined)
    if (d) return d
  }

  const list = await fetchMatchSummaries(lockfile, me.puuid, 3, {
    gameName: me.gameName,
    tagLine: me.tagLine,
  })
  if (!list[0]) return null
  return buildMatchDebrief(lockfile, list[0].gameId, me.puuid || undefined)
}
