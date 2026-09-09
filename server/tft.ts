import type { LiveSession, PlayerCard, LockfileData } from './types.js'
import { buildProfileLinks, normalizeRegion, queueLabel, isTftQueue } from './profiles.js'
import { lcuGet } from './lcu.js'

export interface LobbyMember {
  summonerId?: number
  summonerName?: string
  gameName?: string
  tagLine?: string
  puuid?: string
  isLeader?: boolean
  isBot?: boolean
}

export interface LobbyPayload {
  gameConfig?: {
    queueId?: number
    gameMode?: string
    mapId?: number
  }
  members?: LobbyMember[]
  localMember?: LobbyMember
  partyType?: string
}

export interface LiveClientPlayer {
  championName?: string
  isBot?: boolean
  level?: number
  summonerName?: string
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  team?: string
}

export interface GameflowSession {
  phase?: string
  map?: { id?: number; gameMode?: string; name?: string }
  gameData?: {
    queue?: { id?: number; name?: string; gameMode?: string; shortName?: string; type?: string }
    teamOne?: GameflowPlayer[]
    teamTwo?: GameflowPlayer[]
    playerChampionSelections?: Array<{ championId?: number; puuid?: string }>
  }
}

export interface GameflowPlayer {
  championId?: number
  profileIconId?: number
  puuid?: string
  summonerId?: number
  summonerName?: string
  teamParticipantId?: number
}

interface ResolvedSummoner {
  gameName?: string
  tagLine?: string
  displayName?: string
  puuid?: string
}

function parseName(member: {
  gameName?: string
  tagLine?: string
  summonerName?: string
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
}): { gameName: string; tagLine: string; display: string } {
  if (member.riotIdGameName) {
    return {
      gameName: member.riotIdGameName,
      tagLine: member.riotIdTagLine || '???',
      display: `${member.riotIdGameName}#${member.riotIdTagLine || '???'}`,
    }
  }
  if (member.riotId?.includes('#')) {
    const [gameName, tagLine] = member.riotId.split('#')
    return { gameName: gameName || 'Joueur', tagLine: tagLine || '???', display: member.riotId }
  }
  if (member.gameName) {
    return {
      gameName: member.gameName,
      tagLine: member.tagLine || '???',
      display: `${member.gameName}#${member.tagLine || '???'}`,
    }
  }
  if (member.summonerName?.includes('#')) {
    const [gameName, tagLine] = member.summonerName.split('#')
    return { gameName: gameName || member.summonerName, tagLine: tagLine || '???', display: member.summonerName }
  }
  if (member.summonerName) {
    return { gameName: member.summonerName, tagLine: '???', display: member.summonerName }
  }
  return { gameName: 'Joueur', tagLine: '???', display: 'Joueur' }
}

export function detectTftFromSession(session: GameflowSession | null, lobby?: LobbyPayload | null): boolean {
  if (isTftQueue(lobby?.gameConfig?.queueId, lobby?.gameConfig?.gameMode)) return true
  if (session?.map?.gameMode?.toUpperCase() === 'TFT') return true
  if (session?.map?.id === 22) return true
  if (isTftQueue(session?.gameData?.queue?.id, session?.gameData?.queue?.gameMode)) return true
  return false
}

export async function resolveSummoner(
  lockfile: LockfileData,
  player: { summonerId?: number; puuid?: string },
): Promise<ResolvedSummoner | null> {
  if (player.summonerId) {
    const byId = await lcuGet<ResolvedSummoner>(lockfile, `/lol-summoner/v1/summoners/${player.summonerId}`)
    if (byId?.gameName) return byId
  }
  if (player.puuid) {
    const byPuuid =
      (await lcuGet<ResolvedSummoner>(lockfile, `/lol-summoner/v1/summoners/puuid/${player.puuid}`)) ||
      (await lcuGet<ResolvedSummoner>(lockfile, `/lol-summoner/v2/summoners/puuid/${player.puuid}`))
    if (byPuuid?.gameName) return byPuuid
  }
  return null
}

export async function buildTftFromGameflow(params: {
  lockfile: LockfileData
  connected: boolean
  phase: string
  region: string
  session: GameflowSession
  currentSummoner?: ResolvedSummoner | null
}): Promise<LiveSession> {
  const region = normalizeRegion(params.region)
  const queue = params.session.gameData?.queue
  const qLabel = queueLabel(queue?.id, queue?.gameMode) || queue?.shortName || queue?.name || 'TFT'
  const roster = [
    ...(params.session.gameData?.teamOne ?? []),
    ...(params.session.gameData?.teamTwo ?? []),
  ]

  const players: PlayerCard[] = []
  for (let index = 0; index < roster.length; index++) {
    const raw = roster[index]!
    const resolved = await resolveSummoner(params.lockfile, raw)
    const id = parseName({
      gameName: resolved?.gameName,
      tagLine: resolved?.tagLine,
      summonerName: raw.summonerName,
    })
    players.push({
      cellId: index,
      team: 'ally',
      summonerName: id.display,
      gameName: id.gameName,
      tagLine: id.tagLine,
      assignedPosition: raw.teamParticipantId != null ? `T${raw.teamParticipantId}` : `P${index + 1}`,
      championId: raw.championId ?? null,
      championName: null,
      championKey: null,
      championImage: raw.profileIconId
        ? `https://ddragon.leagueoflegends.com/cdn/14.18.1/img/profileicon/${raw.profileIconId}.png`
        : null,
      isPickIntent: false,
      locked: true,
      championWinRate: null,
      championTier: null,
      spell1Id: null,
      spell2Id: null,
      puuid: raw.puuid || resolved?.puuid || null,
      links: buildProfileLinks(id.gameName, id.tagLine, region, 'tft'),
    })
  }

  let localPlayerCellId: number | null = null
  if (params.currentSummoner?.gameName) {
    const me = players.find(
      (p) => p.gameName.toLowerCase() === params.currentSummoner!.gameName!.toLowerCase(),
    )
    if (me) localPlayerCellId = me.cellId
  }

  return {
    connected: params.connected,
    phase: params.phase,
    demo: false,
    mode: 'tft',
    queueName: qLabel,
    region,
    localPlayerCellId,
    timer: null,
    bans: { ally: [], enemy: [] },
    allies: players,
    enemies: [],
    players,
    teamWinChance: { ally: 50, enemy: 50 },
    message: `TFT en cours — ${players.length} joueurs · ${qLabel}`,
  }
}

export function buildTftLobbySession(params: {
  connected: boolean
  phase: string
  region: string
  lobby: LobbyPayload
  currentSummoner?: ResolvedSummoner | null
  inGamePlayers?: LiveClientPlayer[] | null
}): LiveSession {
  const region = normalizeRegion(params.region)
  const queueId = params.lobby.gameConfig?.queueId
  const gameMode = params.lobby.gameConfig?.gameMode
  const qLabel = queueLabel(queueId, gameMode)

  const players: PlayerCard[] = []

  if (params.inGamePlayers?.length) {
    params.inGamePlayers.forEach((p, index) => {
      const id = parseName(p)
      players.push({
        cellId: index,
        team: 'ally',
        summonerName: id.display,
        gameName: id.gameName,
        tagLine: id.tagLine,
        assignedPosition: `P${index + 1}`,
        championId: null,
        championName: p.championName || null,
        championKey: null,
        championImage: null,
        isPickIntent: false,
        locked: true,
        championWinRate: null,
        championTier: null,
        spell1Id: null,
        spell2Id: null,
        puuid: p.puuid || null,
        links: buildProfileLinks(id.gameName, id.tagLine, region, 'tft'),
      })
    })
  } else {
    const members = params.lobby.members ?? []
    members.forEach((m, index) => {
      const id = parseName(m)
      players.push({
        cellId: index,
        team: 'ally',
        summonerName: id.display,
        gameName: id.gameName,
        tagLine: id.tagLine,
        assignedPosition: m.isLeader ? 'HOST' : `P${index + 1}`,
        championId: null,
        championName: null,
        championKey: null,
        championImage: null,
        isPickIntent: false,
        locked: false,
        championWinRate: null,
        championTier: null,
        spell1Id: null,
        spell2Id: null,
        puuid: m.puuid || null,
        links: buildProfileLinks(id.gameName, id.tagLine, region, 'tft'),
      })
    })
  }

  let localPlayerCellId: number | null = null
  if (params.currentSummoner?.gameName) {
    const me = players.find(
      (p) => p.gameName.toLowerCase() === params.currentSummoner!.gameName!.toLowerCase(),
    )
    if (me) localPlayerCellId = me.cellId
  }

  const inGame = Boolean(params.inGamePlayers?.length)
  const message = inGame
    ? `TFT en cours — ${players.length} joueurs détectés (${qLabel}).`
    : players.length
      ? `Lobby TFT détecté — ${players.length} joueur(s) · ${qLabel}.`
      : `Mode TFT actif (${qLabel}). En attente des joueurs…`

  return {
    connected: params.connected,
    phase: params.phase,
    demo: false,
    mode: 'tft',
    queueName: qLabel,
    region,
    localPlayerCellId,
    timer: null,
    bans: { ally: [], enemy: [] },
    allies: players,
    enemies: [],
    players,
    teamWinChance: { ally: 50, enemy: 50 },
    message,
  }
}

export function emptySession(params: {
  connected: boolean
  phase: string
  region: string
  message: string
  mode?: LiveSession['mode']
  queueName?: string
}): LiveSession {
  return {
    connected: params.connected,
    phase: params.phase,
    demo: false,
    mode: params.mode ?? 'idle',
    queueName: params.queueName,
    region: normalizeRegion(params.region),
    localPlayerCellId: null,
    timer: null,
    bans: { ally: [], enemy: [] },
    allies: [],
    enemies: [],
    players: [],
    teamWinChance: { ally: 50, enemy: 50 },
    message: params.message,
  }
}
