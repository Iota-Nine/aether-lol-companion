import type { LiveSession, PlayerCard, TeamSide } from './types.js'
// LiveSession used for ban mapping return types
import { getChampionById, estimateTeamWinChance } from './champions.js'
import { buildProfileLinks, normalizeRegion } from './profiles.js'

interface LcuChampSelectSession {
  localPlayerCellId: number
  timer?: { phase: string; adjustedTimeLeftInPhase: number }
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] }
  myTeam?: LcuPlayer[]
  theirTeam?: LcuPlayer[]
  actions?: LcuAction[][]
}

interface LcuPlayer {
  cellId: number
  championId: number
  championPickIntent?: number
  assignedPosition?: string
  spell1Id?: number
  spell2Id?: number
  summonerId?: number
  puuid?: string
  riotId?: string
  gameName?: string
  tagLine?: string
  summonerName?: string
}

interface LcuAction {
  actorCellId: number
  championId: number
  completed: boolean
  type: string
  isAllyAction?: boolean
}

interface LcuSummoner {
  displayName?: string
  gameName?: string
  tagLine?: string
  summonerId?: number
  puuid?: string
}

function parseRiotId(player: LcuPlayer): { gameName: string; tagLine: string; display: string } {
  if (player.riotId && player.riotId.includes('#')) {
    const [gameName, tagLine] = player.riotId.split('#')
    return { gameName: gameName || 'Invocateur', tagLine: tagLine || '???', display: player.riotId }
  }
  if (player.gameName) {
    return {
      gameName: player.gameName,
      tagLine: player.tagLine || '???',
      display: `${player.gameName}#${player.tagLine || '???'}`,
    }
  }
  if (player.summonerName) {
    return { gameName: player.summonerName, tagLine: '???', display: player.summonerName }
  }
  return { gameName: `Joueur ${player.cellId}`, tagLine: '???', display: `Joueur ${player.cellId}` }
}

function positionLabel(pos?: string): string {
  const map: Record<string, string> = {
    top: 'Top',
    jungle: 'Jungle',
    middle: 'Mid',
    mid: 'Mid',
    bottom: 'ADC',
    bot: 'ADC',
    utility: 'Support',
    support: 'Support',
    '': '—',
  }
  if (!pos) return '—'
  return map[pos.toLowerCase()] ?? pos
}

async function toPlayerCard(
  player: LcuPlayer,
  team: TeamSide,
  region: string,
  actions: LcuAction[],
): Promise<PlayerCard> {
  const identity = parseRiotId(player)
  const pickAction = actions.find((a) => a.actorCellId === player.cellId && a.type === 'pick')
  const championId =
    player.championId && player.championId > 0
      ? player.championId
      : player.championPickIntent && player.championPickIntent > 0
        ? player.championPickIntent
        : pickAction?.championId && pickAction.championId > 0
          ? pickAction.championId
          : null

  const locked = Boolean(pickAction?.completed && championId)
  const isPickIntent = Boolean(
    !locked && ((player.championPickIntent && player.championPickIntent > 0) || championId),
  )

  const champ = championId ? await getChampionById(championId) : null

  return {
    cellId: player.cellId,
    team,
    summonerName: identity.display,
    gameName: identity.gameName,
    tagLine: identity.tagLine,
    assignedPosition: positionLabel(player.assignedPosition),
    championId,
    championName: champ?.name ?? null,
    championKey: champ?.key ?? null,
    championImage: champ?.image ?? null,
    isPickIntent: isPickIntent && !locked,
    locked,
    championWinRate: champ?.winRate ?? null,
    championTier: champ?.tier ?? null,
    spell1Id: player.spell1Id ?? null,
    spell2Id: player.spell2Id ?? null,
    puuid: player.puuid ?? null,
    links: buildProfileLinks(identity.gameName, identity.tagLine, region),
  }
}

export async function buildLiveSession(params: {
  connected: boolean
  demo: boolean
  phase: string
  region: string
  message: string
  session: LcuChampSelectSession | null
  currentSummoner?: LcuSummoner | null
}): Promise<LiveSession> {
  const region = normalizeRegion(params.region)
  const session = params.session

  if (!session) {
    return {
      connected: params.connected,
      phase: params.phase,
      demo: params.demo,
      mode: 'lol',
      queueName: 'LoL',
      region,
      localPlayerCellId: null,
      timer: null,
      bans: { ally: [], enemy: [] } as LiveSession['bans'],
      allies: [],
      enemies: [],
      players: [],
      teamWinChance: { ally: 50, enemy: 50 },
      message: params.message,
    }
  }

  const flatActions = (session.actions ?? []).flat()
  const allies = await Promise.all(
    (session.myTeam ?? []).map((p) => toPlayerCard(p, 'ally', region, flatActions)),
  )
  const enemies = await Promise.all(
    (session.theirTeam ?? []).map((p) => toPlayerCard(p, 'enemy', region, flatActions)),
  )

  // Enrich local player name if missing
  if (params.currentSummoner && session.localPlayerCellId != null) {
    const me = allies.find((a) => a.cellId === session.localPlayerCellId)
    if (me && (me.gameName.startsWith('Joueur') || me.tagLine === '???')) {
      const gameName = params.currentSummoner.gameName || params.currentSummoner.displayName || me.gameName
      const tagLine = params.currentSummoner.tagLine || me.tagLine
      me.gameName = gameName
      me.tagLine = tagLine
      me.summonerName = `${gameName}#${tagLine}`
      me.links = buildProfileLinks(gameName, tagLine, region)
    }
  }

  const allyRates = allies.map((p) => p.championWinRate).filter((v): v is number => v != null)
  const enemyRates = enemies.map((p) => p.championWinRate).filter((v): v is number => v != null)
  let allyChance = estimateTeamWinChance(allyRates)
  let enemyChance = estimateTeamWinChance(enemyRates)

  // Normalize so ally + enemy ~= 100 when both have picks
  if (allyRates.length && enemyRates.length) {
    const total = allyChance + enemyChance
    allyChance = Number(((allyChance / total) * 100).toFixed(1))
    enemyChance = Number((100 - allyChance).toFixed(1))
  }

  async function mapBans(ids: number[]) {
    const out: LiveSession['bans']['ally'] = []
    for (const id of ids) {
      const champ = await getChampionById(id)
      out.push({
        id,
        name: champ?.name ?? `#${id}`,
        image: champ?.image ?? '',
      })
    }
    return out
  }

  return {
    connected: params.connected,
    phase: params.phase,
    demo: params.demo,
    mode: 'lol',
    queueName: 'LoL Draft',
    region,
    localPlayerCellId: session.localPlayerCellId,
    timer: session.timer
      ? {
          phase: session.timer.phase,
          adjustedTimeLeftInPhase: session.timer.adjustedTimeLeftInPhase,
        }
      : null,
    bans: {
      ally: await mapBans(session.bans?.myTeamBans ?? []),
      enemy: await mapBans(session.bans?.theirTeamBans ?? []),
    },
    allies,
    enemies,
    players: [...allies, ...enemies],
    teamWinChance: { ally: allyChance, enemy: enemyChance },
    message: params.message,
  }
}

export type { LcuChampSelectSession, LcuSummoner }
