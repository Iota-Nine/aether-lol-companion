import { lcuGet } from './lcu.js'
import { getChampionById, loadChampions } from './champions.js'
import type { LockfileData } from './types.js'
import { fetchPlayerStats } from './playerStats.js'

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
  damage: number
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
    default:
      return id != null ? `Queue ${id}` : 'LoL'
  }
}

function roleLabel(lane?: string, role?: string): string {
  const l = (lane || '').toUpperCase()
  const r = (role || '').toUpperCase()
  if (l.includes('TOP')) return 'TOP'
  if (l.includes('JUNG')) return 'JGL'
  if (l.includes('MID')) return 'MID'
  if (l.includes('BOT') || l.includes('BOTTOM')) {
    if (r.includes('SUPPORT') || r.includes('DUO_SUPPORT')) return 'SUP'
    return 'ADC'
  }
  if (r.includes('SUPPORT')) return 'SUP'
  return '—'
}

interface RawIdentity {
  participantId?: number
  player?: {
    puuid?: string
    gameName?: string
    tagLine?: string
    summonerName?: string
    riotIdGameName?: string
    riotIdTagLine?: string
  }
}

interface RawParticipant {
  participantId?: number
  championId?: number
  spell1Id?: number
  spell2Id?: number
  teamId?: number
  stats?: {
    win?: boolean
    kills?: number
    deaths?: number
    assists?: number
    totalMinionsKilled?: number
    neutralMinionsKilled?: number
    goldEarned?: number
    totalDamageDealtToChampions?: number
    visionScore?: number
    item0?: number
    item1?: number
    item2?: number
    item3?: number
    item4?: number
    item5?: number
    item6?: number
  }
  timeline?: { lane?: string; role?: string }
}

interface RawGame {
  gameId?: number
  gameCreation?: number
  gameDuration?: number
  queueId?: number
  gameMode?: string
  participants?: RawParticipant[]
  participantIdentities?: RawIdentity[]
}

function itemsOf(stats?: RawParticipant['stats']): number[] {
  if (!stats) return []
  return [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5, stats.item6]
    .filter((id): id is number => typeof id === 'number' && id > 0)
}

function nameOf(id: RawIdentity | undefined): { gameName: string; tagLine: string } {
  const p = id?.player
  if (p?.riotIdGameName) return { gameName: p.riotIdGameName, tagLine: p.riotIdTagLine || '???' }
  if (p?.gameName) return { gameName: p.gameName, tagLine: p.tagLine || '???' }
  if (p?.summonerName?.includes('#')) {
    const [g, t] = p.summonerName.split('#')
    return { gameName: g || 'Joueur', tagLine: t || '???' }
  }
  return { gameName: p?.summonerName || 'Joueur', tagLine: '???' }
}

async function ddragonVersion(): Promise<string> {
  try {
    const c = await loadChampions()
    return c?.version || DDRAGON_FALLBACK
  } catch {
    return DDRAGON_FALLBACK
  }
}

export async function buildProfileHome(lockfile: LockfileData): Promise<ProfileHome | null> {
  const me = await lcuGet<{
    gameName?: string
    tagLine?: string
    displayName?: string
    puuid?: string
    profileIconId?: number
    summonerLevel?: number
  }>(lockfile, '/lol-summoner/v1/current-summoner')

  if (!me?.puuid) return null

  const gameName = me.gameName || me.displayName || 'Invocateur'
  const tagLine = me.tagLine || 'EUW'
  const version = await ddragonVersion()
  const iconId = me.profileIconId || 29
  const stats = await fetchPlayerStats(lockfile, me.puuid, 'lol')
  const matches = await fetchMatchSummaries(lockfile, me.puuid, 15)

  return {
    connected: true,
    gameName,
    tagLine,
    puuid: me.puuid,
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

export async function fetchMatchSummaries(
  lockfile: LockfileData,
  puuid: string,
  limit = 15,
): Promise<MatchSummary[]> {
  const hist = await lcuGet<{ games?: { games?: RawGame[] } }>(
    lockfile,
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${Math.max(limit - 1, 0)}`,
  )
  const games = hist?.games?.games ?? []
  const out: MatchSummary[] = []

  for (const g of games.slice(0, limit)) {
    if (!g.gameId) continue
    const identity = g.participantIdentities?.find((i) => i.player?.puuid === puuid)
    const pid = identity?.participantId
    const part =
      (pid != null ? g.participants?.find((p) => p.participantId === pid) : null) ?? null
    if (!part?.stats) continue

    const champ = part.championId ? await getChampionById(part.championId) : null
    const cs =
      (part.stats.totalMinionsKilled || 0) + (part.stats.neutralMinionsKilled || 0)

    out.push({
      gameId: g.gameId,
      gameCreation: g.gameCreation || 0,
      gameDuration: g.gameDuration || 0,
      queueId: g.queueId || 0,
      queueLabel: queueLabel(g.queueId),
      win: Boolean(part.stats.win),
      championId: part.championId || 0,
      championName: champ?.name || `Champ ${part.championId}`,
      championImage: champ?.image || null,
      kills: part.stats.kills || 0,
      deaths: part.stats.deaths || 0,
      assists: part.stats.assists || 0,
      cs,
      gold: part.stats.goldEarned || 0,
      role: roleLabel(part.timeline?.lane, part.timeline?.role),
      items: itemsOf(part.stats),
      spell1Id: part.spell1Id ?? null,
      spell2Id: part.spell2Id ?? null,
    })
  }

  return out
}

function gradePlayer(p: {
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  cs: number
  teamAvgGold: number
  teamAvgDmg: number
  teamAvgDeaths: number
}): { grade: DebriefPlayer['grade']; score: number; verdict: string } {
  const kda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths
  const goldRatio = p.teamAvgGold > 0 ? p.gold / p.teamAvgGold : 1
  const dmgRatio = p.teamAvgDmg > 0 ? p.damage / p.teamAvgDmg : 1
  const deathRatio = p.teamAvgDeaths > 0 ? p.deaths / p.teamAvgDeaths : 1

  let score = 50
  score += Math.min(25, kda * 6)
  score += (goldRatio - 1) * 20
  score += (dmgRatio - 1) * 20
  score -= (deathRatio - 1) * 18
  if (p.deaths >= 8 && kda < 1.2) score -= 15
  if (p.cs < 40 && p.gold < p.teamAvgGold * 0.55) score -= 12
  score = Math.max(0, Math.min(100, Math.round(score)))

  if (p.deaths >= 9 && kda < 1 && goldRatio < 0.85) {
    return {
      grade: 'FEED',
      score,
      verdict: `A feed dur (${p.kills}/${p.deaths}/${p.assists}) — gros trou d’XP/or pour l’équipe.`,
    }
  }
  if (p.deaths >= 6 && kda < 1.3 && dmgRatio < 0.75) {
    return {
      grade: 'INT',
      score,
      verdict: `A merdé : trop de morts (${p.deaths}) pour trop peu d’impact.`,
    }
  }
  if (p.cs < 50 && p.gold < p.teamAvgGold * 0.6 && p.damage < p.teamAvgDmg * 0.55) {
    return {
      grade: 'GHOST',
      score,
      verdict: `Fantôme de la map — quasi aucun farm ni dégâts.`,
    }
  }
  if (kda >= 3 && (goldRatio >= 1.15 || dmgRatio >= 1.2)) {
    return {
      grade: 'CARRY',
      score,
      verdict: `Carry clair (KDA ${kda.toFixed(1)}) — a porté les fights / l’économie.`,
    }
  }
  if (score >= 55) {
    return {
      grade: 'SOLID',
      score,
      verdict: `Propre : rôle tenu, pas le problème principal.`,
    }
  }
  return {
    grade: 'MEH',
    score,
    verdict: `Moyen — ni carry ni int, impact limité.`,
  }
}

export async function buildMatchDebrief(
  lockfile: LockfileData,
  gameId: number,
  youPuuid?: string | null,
): Promise<MatchDebrief | null> {
  let game = await lcuGet<RawGame>(lockfile, `/lol-match-history/v1/games/${gameId}`)

  // fallback: pull from history list and find game
  if (!game?.participants?.length) {
    const me = youPuuid
      ? { puuid: youPuuid }
      : await lcuGet<{ puuid?: string }>(lockfile, '/lol-summoner/v1/current-summoner')
    if (!me?.puuid) return null
    const hist = await lcuGet<{ games?: { games?: RawGame[] } }>(
      lockfile,
      `/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=19`,
    )
    game = hist?.games?.games?.find((g) => g.gameId === gameId) || null
  }

  if (!game?.participants?.length) return null

  const me =
    youPuuid ||
    (await lcuGet<{ puuid?: string }>(lockfile, '/lol-summoner/v1/current-summoner'))?.puuid ||
    null

  const youIdentity = game.participantIdentities?.find((i) => i.player?.puuid === me)
  const youPart =
    (youIdentity?.participantId != null
      ? game.participants.find((p) => p.participantId === youIdentity.participantId)
      : null) || null
  const yourTeamId = youPart?.teamId ?? 100
  const youWon = Boolean(youPart?.stats?.win)

  type Row = {
    part: RawParticipant
    identity?: RawIdentity
    kills: number
    deaths: number
    assists: number
    gold: number
    damage: number
    cs: number
    vision: number
    team: 'ally' | 'enemy'
  }

  const rows: Row[] = []
  for (const part of game.participants) {
    const identity = game.participantIdentities?.find((i) => i.participantId === part.participantId)
    const team: 'ally' | 'enemy' = part.teamId === yourTeamId ? 'ally' : 'enemy'
    rows.push({
      part,
      identity,
      kills: part.stats?.kills || 0,
      deaths: part.stats?.deaths || 0,
      assists: part.stats?.assists || 0,
      gold: part.stats?.goldEarned || 0,
      damage: part.stats?.totalDamageDealtToChampions || 0,
      cs: (part.stats?.totalMinionsKilled || 0) + (part.stats?.neutralMinionsKilled || 0),
      vision: part.stats?.visionScore || 0,
      team,
    })
  }

  const allyRows = rows.filter((r) => r.team === 'ally')
  const avg = (list: Row[], key: keyof Row) =>
    list.length ? list.reduce((s, r) => s + (r[key] as number), 0) / list.length : 0

  const players: DebriefPlayer[] = []
  for (const r of rows) {
    const teamRows = r.team === 'ally' ? allyRows : rows.filter((x) => x.team === 'enemy')
    const g = gradePlayer({
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      gold: r.gold,
      damage: r.damage,
      cs: r.cs,
      teamAvgGold: avg(teamRows, 'gold'),
      teamAvgDmg: avg(teamRows, 'damage'),
      teamAvgDeaths: avg(teamRows, 'deaths'),
    })
    const nm = nameOf(r.identity)
    const champ = r.part.championId ? await getChampionById(r.part.championId) : null
    const isYou = r.identity?.player?.puuid === me
    players.push({
      gameName: nm.gameName,
      tagLine: nm.tagLine,
      team: r.team,
      championId: r.part.championId || 0,
      championName: champ?.name || '?',
      championImage: champ?.image || null,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      cs: r.cs,
      gold: r.gold,
      damage: r.damage,
      vision: r.vision,
      items: itemsOf(r.part.stats),
      win: Boolean(r.part.stats?.win),
      isYou,
      grade: g.grade,
      verdict: isYou ? g.verdict.replace(/^A /, 'Tu as ').replace(/^Fantôme/, 'Tu étais un fantôme') : g.verdict,
      score: g.score,
    })
  }

  players.sort((a, b) => {
    if (a.team !== b.team) return a.team === 'ally' ? -1 : 1
    return b.score - a.score
  })

  const ally = players.filter((p) => p.team === 'ally')
  const mvp = ally.find((p) => p.grade === 'CARRY') || [...ally].sort((a, b) => b.score - a.score)[0] || null
  const intFeed =
    ally.find((p) => p.grade === 'FEED' || p.grade === 'INT') ||
    [...ally].sort((a, b) => a.score - b.score)[0] ||
    null

  const why: string[] = []
  if (youWon) {
    why.push('Victoire — votre équipe a mieux converti fights / objectifs.')
    if (mvp) why.push(`MVP allié : ${mvp.gameName} (${mvp.championName}) — ${mvp.verdict}`)
  } else {
    why.push('Défaite — trop peu d’avantage économique ou trop de morts inutiles.')
    if (intFeed && (intFeed.grade === 'FEED' || intFeed.grade === 'INT' || intFeed.score < 40)) {
      why.push(`Point faible : ${intFeed.gameName} (${intFeed.championName}) — ${intFeed.verdict}`)
    }
    const enemyCarry = players.find((p) => p.team === 'enemy' && p.grade === 'CARRY')
    if (enemyCarry) {
      why.push(`Ils ont été portés par ${enemyCarry.gameName} (${enemyCarry.championName}).`)
    }
  }

  const you = players.find((p) => p.isYou)
  if (you) why.push(`Toi (${you.championName}) : ${you.verdict}`)

  const headline = youWon
    ? `WIN — ${mvp ? `${mvp.championName} a carry` : 'équipe propre'}`
    : `LOSS — ${intFeed && intFeed.score < 45 ? `${intFeed.championName} a plombé la game` : 'manque d’impact collectif'}`

  return {
    gameId,
    win: youWon,
    gameDuration: game.gameDuration || 0,
    queueLabel: queueLabel(game.queueId),
    headline,
    why,
    players,
    mvp: mvp ? `${mvp.gameName} · ${mvp.championName}` : null,
    intFeed: intFeed && intFeed.score < 45 ? `${intFeed.gameName} · ${intFeed.championName}` : null,
  }
}

/** Essaie le bloc fin de game LCU, sinon dernière partie de l’historique */
export async function buildLatestDebrief(lockfile: LockfileData): Promise<MatchDebrief | null> {
  const me = await lcuGet<{ puuid?: string }>(lockfile, '/lol-summoner/v1/current-summoner')
  if (!me?.puuid) return null

  const eog = await lcuGet<{ gameId?: number }>(lockfile, '/lol-end-of-game/v1/eog-stats-block')
  const eogId = typeof eog?.gameId === 'number' ? eog.gameId : null

  if (eogId) {
    const d = await buildMatchDebrief(lockfile, eogId, me.puuid)
    if (d) return d
  }

  const list = await fetchMatchSummaries(lockfile, me.puuid, 1)
  if (!list[0]) return null
  return buildMatchDebrief(lockfile, list[0].gameId, me.puuid)
}
