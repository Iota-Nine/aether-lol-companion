import { liveClientGet, lcuGet } from './lcu.js'
import { getAllChampions, getChampionById } from './champions.js'
import type { LiveSession, PlayerCard, TeamSide, LockfileData } from './types.js'
import { buildProfileLinks, normalizeRegion, queueLabel } from './profiles.js'
import type { GameflowSession } from './tft.js'

export interface InGameItem {
  itemID: number
  displayName: string
  count: number
  price: number
}

export interface GameEvent {
  id: number
  name: string
  time: number
  label: string
  kind: 'kill' | 'objective' | 'ace' | 'structure' | 'system' | 'other'
}

export interface InGamePlayerLive {
  cellId: number
  team: TeamSide
  riotId: string
  gameName: string
  tagLine: string
  championName: string
  championId: number | null
  championKey: string | null
  championImage: string | null
  championWinRate: number | null
  championTier: string | null
  level: number
  kills: number
  deaths: number
  assists: number
  cs: number
  wardScore: number
  isDead: boolean
  respawnTimer: number
  position: string
  items: InGameItem[]
  /** Score de combat dérivé (K/D/A + CS + level) - proxy dégâts tant que Riot n'expose pas les DMG */
  combatScore: number
  /** Part des dégâts/combat de l'équipe (0-100) */
  damageShare: number
  goldEstimate: number
  kdaRatio: number
  keystone: string | null
  spell1: string | null
  spell2: string | null
  spell1Key: string | null
  spell2Key: string | null
}

export interface InGameState {
  active: boolean
  gameMode: string
  gameTime: number
  mapName: string
  allies: InGamePlayerLive[]
  enemies: InGamePlayerLive[]
  events: GameEvent[]
  teamTotals: {
    ally: { kills: number; deaths: number; assists: number; cs: number; combat: number; gold: number }
    enemy: { kills: number; deaths: number; assists: number; cs: number; combat: number; gold: number }
  }
  myTeam: TeamSide
}

interface RawLivePlayer {
  championName?: string
  isBot?: boolean
  isDead?: boolean
  level?: number
  position?: string
  respawnTimer?: number
  summonerName?: string
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  team?: string
  scores?: {
    assists?: number
    creepScore?: number
    deaths?: number
    kills?: number
    wardScore?: number
  }
  items?: Array<{
    itemID?: number
    displayName?: string
    count?: number
    price?: number
  }>
  runes?: { keystone?: { displayName?: string } }
  summonerSpells?: {
    summonerSpellOne?: { displayName?: string; rawDisplayName?: string }
    summonerSpellTwo?: { displayName?: string; rawDisplayName?: string }
  }
}

interface AllGameData {
  activePlayer?: {
    currentGold?: number
    level?: number
    summonerName?: string
    riotId?: string
    riotIdGameName?: string
    riotIdTagLine?: string
    fullRunes?: {
      keystone?: { displayName?: string; id?: number }
    }
  }
  allPlayers?: RawLivePlayer[]
  events?: { Events?: Array<{ EventID?: number; EventName?: string; EventTime?: number; KillerName?: string; VictimName?: string; Assisters?: string[]; DragonType?: string }> }
  gameData?: {
    gameMode?: string
    gameTime?: number
    mapName?: string
    mapNumber?: number
  }
}

/** Anciennes masteries / perks obsolètes parfois renvoyées à tort par le Live Client */
const DEPRECATED_KEYSTONES = new Set([
  'toucher de feu mortel',
  'deathfire touch',
  'tonnerre',
  'thunderlord',
  "tonnerre d'orage",
  'thunderlord\'s decree',
  'ferveur de la guerre',
  'fervor of battle',
  'esprit sagace',
  'stormraider\'s surge',
  'tempête du voyageur',
])

function sanitizeKeystone(name: string | null | undefined): string | null {
  if (!name) return null
  const n = name.trim()
  if (!n) return null
  if (DEPRECATED_KEYSTONES.has(n.toLowerCase())) return null
  return n
}

function parseRiot(p: RawLivePlayer) {
  if (p.riotIdGameName) {
    return {
      gameName: p.riotIdGameName,
      tagLine: p.riotIdTagLine || '???',
      riotId: `${p.riotIdGameName}#${p.riotIdTagLine || '???'}`,
    }
  }
  if (p.riotId?.includes('#')) {
    const [gameName, tagLine] = p.riotId.split('#')
    return { gameName: gameName || p.summonerName || 'Joueur', tagLine: tagLine || '???', riotId: p.riotId }
  }
  const name = p.summonerName || 'Joueur'
  return { gameName: name, tagLine: '???', riotId: name }
}

function resolveSpellKey(spell?: { displayName?: string; rawDisplayName?: string } | null): string | null {
  if (!spell) return null
  const raw = spell.rawDisplayName || ''
  const fromRaw = raw.match(/SummonerSpell_(Summoner[A-Za-z0-9]+)_/i)
  if (fromRaw?.[1]) return fromRaw[1]
  const n = (spell.displayName || '').trim().toLowerCase()
  const map: Record<string, string> = {
    flash: 'SummonerFlash',
    éclair: 'SummonerFlash',
    eclair: 'SummonerFlash',
    ignite: 'SummonerDot',
    brûlure: 'SummonerDot',
    brulure: 'SummonerDot',
    teleport: 'SummonerTeleport',
    téléportation: 'SummonerTeleport',
    teleportation: 'SummonerTeleport',
    heal: 'SummonerHeal',
    soin: 'SummonerHeal',
    barrier: 'SummonerBarrier',
    barrière: 'SummonerBarrier',
    barriere: 'SummonerBarrier',
    exhaust: 'SummonerExhaust',
    épuisement: 'SummonerExhaust',
    epuisement: 'SummonerExhaust',
    ghost: 'SummonerHaste',
    fantôme: 'SummonerHaste',
    fantome: 'SummonerHaste',
    smite: 'SummonerSmite',
    châtiment: 'SummonerSmite',
    chatiment: 'SummonerSmite',
    cleanse: 'SummonerBoost',
    purification: 'SummonerBoost',
    clarity: 'SummonerMana',
    clarté: 'SummonerMana',
    clarte: 'SummonerMana',
    mark: 'SummonerSnowball',
    marque: 'SummonerSnowball',
  }
  return map[n] ?? null
}

function eventKind(name?: string): GameEvent['kind'] {
  switch (name) {
    case 'ChampionKill':
    case 'FirstBlood':
      return 'kill'
    case 'DragonKill':
    case 'BaronKill':
    case 'HeraldKill':
      return 'objective'
    case 'TurretKilled':
    case 'InhibKilled':
      return 'structure'
    case 'Ace':
      return 'ace'
    case 'GameStart':
    case 'MinionsSpawning':
      return 'system'
    default:
      return 'other'
  }
}

function eventLabel(ev: {
  EventName?: string
  KillerName?: string
  VictimName?: string
  DragonType?: string
}): string {
  switch (ev.EventName) {
    case 'ChampionKill':
      return `${ev.KillerName ?? '?'} ✕ ${ev.VictimName ?? '?'}`
    case 'DragonKill':
      return `DRAGON ${ev.DragonType ?? ''} · ${ev.KillerName ?? '?'}`
    case 'BaronKill':
      return `BARON · ${ev.KillerName ?? '?'}`
    case 'HeraldKill':
      return `HÉRAUT · ${ev.KillerName ?? '?'}`
    case 'TurretKilled':
      return `TOUR · ${ev.KillerName ?? 'équipe'}`
    case 'InhibKilled':
      return `INHIB · détruit`
    case 'Ace':
      return `ACE`
    case 'FirstBlood':
      return `FIRST BLOOD · ${ev.KillerName ?? ''}`
    case 'GameStart':
      return `START`
    case 'MinionsSpawning':
      return `SBIRES`
    default:
      return ev.EventName ?? 'Event'
  }
}

async function champInfo(name: string): Promise<{
  image: string | null
  id: number | null
  key: string | null
  winRate: number | null
  tier: string | null
}> {
  const all = await getAllChampions()
  const found = all.find(
    (c) => c.name.toLowerCase() === name.toLowerCase() || c.key.toLowerCase() === name.toLowerCase(),
  )
  if (!found) return { image: null, id: null, key: null, winRate: null, tier: null }
  return {
    image: found.image,
    id: found.id,
    key: found.key,
    winRate: found.winRate,
    tier: found.tier,
  }
}

function combatScore(p: {
  kills: number
  deaths: number
  assists: number
  cs: number
  level: number
  goldEstimate: number
}): number {
  const kda = p.kills * 3 + p.assists * 1.5 - p.deaths * 1.2
  return Math.max(0, Math.round(kda * 100 + p.cs * 8 + p.level * 40 + p.goldEstimate * 0.15))
}

export async function fetchInGameState(localRiotId?: string | null): Promise<InGameState | null> {
  const data = await liveClientGet<AllGameData>('/liveclientdata/allgamedata')
  if (!data?.allPlayers?.length) {
    // fallback playerlist only
    const list = await liveClientGet<RawLivePlayer[]>('/liveclientdata/playerlist')
    if (!list?.length) return null
    return fetchInGameStateFromPlayers(list, null, localRiotId)
  }

  const meName =
    data.activePlayer?.riotIdGameName ||
    data.activePlayer?.summonerName ||
    (localRiotId?.includes('#') ? localRiotId.split('#')[0] : localRiotId) ||
    ''

  const myRaw =
    data.allPlayers.find((p) => {
      const id = parseRiot(p)
      return (
        id.gameName.toLowerCase() === meName.toLowerCase() ||
        p.summonerName?.toLowerCase() === meName.toLowerCase() ||
        (localRiotId && id.riotId.toLowerCase() === localRiotId.toLowerCase())
      )
    }) || data.allPlayers[0]

  const myTeamRaw = (myRaw?.team || 'ORDER').toUpperCase()
  const myTeam: TeamSide = myTeamRaw.includes('ORDER') || myTeamRaw.includes('BLUE') ? 'ally' : 'ally'

  const mapped: InGamePlayerLive[] = []
  for (let i = 0; i < data.allPlayers.length; i++) {
    const p = data.allPlayers[i]!
    const id = parseRiot(p)
    const teamRaw = (p.team || '').toUpperCase()
    const isAlly = teamRaw === myTeamRaw || (!myTeamRaw && i < 5)
    const items = (p.items || [])
      .filter((it) => (it.itemID ?? 0) > 0)
      .map((it) => ({
        itemID: it.itemID || 0,
        displayName: it.displayName || `#${it.itemID}`,
        count: it.count || 1,
        price: it.price || 0,
      }))
    const goldEstimate =
      items.reduce((s, it) => s + it.price * it.count, 0) +
      (id.gameName.toLowerCase() === meName.toLowerCase() ? data.activePlayer?.currentGold || 0 : 0)
    const kills = p.scores?.kills ?? 0
    const deaths = p.scores?.deaths ?? 0
    const assists = p.scores?.assists ?? 0
    const cs = p.scores?.creepScore ?? 0
    const level = p.level ?? 1
    const kdaRatio = deaths === 0 ? kills + assists : Number(((kills + assists) / deaths).toFixed(2))
    const champ = await champInfo(p.championName || '')
    const isMe =
      id.gameName.toLowerCase() === meName.toLowerCase() ||
      p.summonerName?.toLowerCase() === meName.toLowerCase()
    const keystoneRaw =
      (isMe ? data.activePlayer?.fullRunes?.keystone?.displayName : null) ||
      p.runes?.keystone?.displayName ||
      null

    mapped.push({
      cellId: i,
      team: isAlly ? 'ally' : 'enemy',
      riotId: id.riotId,
      gameName: id.gameName,
      tagLine: id.tagLine,
      championName: p.championName || '?',
      championId: champ.id,
      championKey: champ.key,
      championImage: champ.image,
      championWinRate: champ.winRate,
      championTier: champ.tier,
      level,
      kills,
      deaths,
      assists,
      cs,
      wardScore: Number((p.scores?.wardScore ?? 0).toFixed(1)),
      isDead: Boolean(p.isDead),
      respawnTimer: Math.round(p.respawnTimer || 0),
      position: p.position || '-',
      items,
      combatScore: 0,
      damageShare: 0,
      goldEstimate: Math.round(goldEstimate),
      kdaRatio,
      keystone: sanitizeKeystone(keystoneRaw),
      spell1: p.summonerSpells?.summonerSpellOne?.displayName ?? null,
      spell2: p.summonerSpells?.summonerSpellTwo?.displayName ?? null,
      spell1Key: resolveSpellKey(p.summonerSpells?.summonerSpellOne),
      spell2Key: resolveSpellKey(p.summonerSpells?.summonerSpellTwo),
    })
  }

  for (const p of mapped) {
    p.combatScore = combatScore(p)
  }

  const allies = mapped.filter((p) => p.team === 'ally')
  const enemies = mapped.filter((p) => p.team === 'enemy')
  const solo = enemies.length === 0
  const allyCombat = allies.reduce((s, p) => s + p.combatScore, 0) || 1
  const enemyCombat = enemies.reduce((s, p) => s + p.combatScore, 0) || 1
  for (const p of allies) {
    p.damageShare = solo ? 0 : Number(((p.combatScore / allyCombat) * 100).toFixed(1))
  }
  for (const p of enemies) {
    p.damageShare = Number(((p.combatScore / enemyCombat) * 100).toFixed(1))
  }

  const sum = (list: InGamePlayerLive[]) => ({
    kills: list.reduce((s, p) => s + p.kills, 0),
    deaths: list.reduce((s, p) => s + p.deaths, 0),
    assists: list.reduce((s, p) => s + p.assists, 0),
    cs: list.reduce((s, p) => s + p.cs, 0),
    combat: list.reduce((s, p) => s + p.combatScore, 0),
    gold: list.reduce((s, p) => s + p.goldEstimate, 0),
  })

  const events = (data.events?.Events || [])
    .slice(-12)
    .reverse()
    .map((ev) => ({
      id: ev.EventID ?? 0,
      name: ev.EventName || '',
      time: Math.floor(ev.EventTime || 0),
      label: eventLabel(ev as { EventName?: string; KillerName?: string; VictimName?: string; DragonType?: string; Recipient?: string }),
      kind: eventKind(ev.EventName),
    }))

  return {
    active: true,
    gameMode: data.gameData?.gameMode || 'CLASSIC',
    gameTime: Math.floor(data.gameData?.gameTime || 0),
    mapName: data.gameData?.mapName || '',
    allies,
    enemies,
    events,
    teamTotals: { ally: sum(allies), enemy: sum(enemies) },
    myTeam: 'ally',
  }
}

async function fetchInGameStateFromPlayers(
  list: RawLivePlayer[],
  activeGold: number | null,
  localRiotId?: string | null,
): Promise<InGameState> {
  const fake: AllGameData = {
    allPlayers: list,
    activePlayer: { currentGold: activeGold ?? 0, riotId: localRiotId || undefined },
    events: { Events: [] },
    gameData: { gameMode: 'CLASSIC', gameTime: 0, mapName: '' },
  }
  // Re-use by temporarily calling logic - simplest: recursive with patched object
  // Instead inline minimal
  const data = fake
  const meName = localRiotId?.split('#')[0] || list[0]?.riotIdGameName || list[0]?.summonerName || ''
  const myRaw = list.find((p) => parseRiot(p).gameName.toLowerCase() === meName.toLowerCase()) || list[0]
  const myTeamRaw = (myRaw?.team || 'ORDER').toUpperCase()

  const mapped: InGamePlayerLive[] = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!
    const id = parseRiot(p)
    const isAlly = (p.team || '').toUpperCase() === myTeamRaw
    const items = (p.items || [])
      .filter((it) => (it.itemID ?? 0) > 0)
      .map((it) => ({
        itemID: it.itemID || 0,
        displayName: it.displayName || `#${it.itemID}`,
        count: it.count || 1,
        price: it.price || 0,
      }))
    const kills = p.scores?.kills ?? 0
    const deaths = p.scores?.deaths ?? 0
    const assists = p.scores?.assists ?? 0
    const cs = p.scores?.creepScore ?? 0
    const level = p.level ?? 1
    const goldEstimate = items.reduce((s, it) => s + it.price * it.count, 0)
    const champ = await champInfo(p.championName || '')
    mapped.push({
      cellId: i,
      team: isAlly ? 'ally' : 'enemy',
      riotId: id.riotId,
      gameName: id.gameName,
      tagLine: id.tagLine,
      championName: p.championName || '?',
      championId: champ.id,
      championKey: champ.key,
      championImage: champ.image,
      championWinRate: champ.winRate,
      championTier: champ.tier,
      level,
      kills,
      deaths,
      assists,
      cs,
      wardScore: Number((p.scores?.wardScore ?? 0).toFixed(1)),
      isDead: Boolean(p.isDead),
      respawnTimer: Math.round(p.respawnTimer || 0),
      position: p.position || '-',
      items,
      combatScore: 0,
      damageShare: 0,
      goldEstimate,
      kdaRatio: deaths === 0 ? kills + assists : Number(((kills + assists) / deaths).toFixed(2)),
      keystone: sanitizeKeystone(p.runes?.keystone?.displayName),
      spell1: p.summonerSpells?.summonerSpellOne?.displayName ?? null,
      spell2: p.summonerSpells?.summonerSpellTwo?.displayName ?? null,
      spell1Key: resolveSpellKey(p.summonerSpells?.summonerSpellOne),
      spell2Key: resolveSpellKey(p.summonerSpells?.summonerSpellTwo),
    })
  }
  for (const p of mapped) p.combatScore = combatScore(p)
  const allies = mapped.filter((p) => p.team === 'ally')
  const enemies = mapped.filter((p) => p.team === 'enemy')
  const solo = enemies.length === 0
  const allyCombat = allies.reduce((s, p) => s + p.combatScore, 0) || 1
  const enemyCombat = enemies.reduce((s, p) => s + p.combatScore, 0) || 1
  for (const p of allies) p.damageShare = solo ? 0 : Number(((p.combatScore / allyCombat) * 100).toFixed(1))
  for (const p of enemies) p.damageShare = Number(((p.combatScore / enemyCombat) * 100).toFixed(1))
  const sum = (list: InGamePlayerLive[]) => ({
    kills: list.reduce((s, p) => s + p.kills, 0),
    deaths: list.reduce((s, p) => s + p.deaths, 0),
    assists: list.reduce((s, p) => s + p.assists, 0),
    cs: list.reduce((s, p) => s + p.cs, 0),
    combat: list.reduce((s, p) => s + p.combatScore, 0),
    gold: list.reduce((s, p) => s + p.goldEstimate, 0),
  })
  return {
    active: true,
    gameMode: 'CLASSIC',
    gameTime: 0,
    mapName: '',
    allies,
    enemies,
    events: [],
    teamTotals: { ally: sum(allies), enemy: sum(enemies) },
    myTeam: 'ally',
  }
}

/** Fusionne live in-game dans une LiveSession Porofessor-like */
export async function buildLolInGameSession(params: {
  connected: boolean
  phase: string
  region: string
  queueName?: string
  currentSummoner?: { gameName?: string; tagLine?: string } | null
  prePlayers?: PlayerCard[]
}): Promise<LiveSession | null> {
  const riotId = params.currentSummoner?.gameName
    ? `${params.currentSummoner.gameName}#${params.currentSummoner.tagLine || ''}`
    : null
  const ingame = await fetchInGameState(riotId)
  if (!ingame) return null

  const region = normalizeRegion(params.region)
  const toCard = (p: InGamePlayerLive): PlayerCard => {
    const pre = params.prePlayers?.find(
      (x) => x.gameName.toLowerCase() === p.gameName.toLowerCase(),
    )
    return {
      cellId: p.cellId,
      team: p.team,
      summonerName: p.riotId,
      gameName: p.gameName,
      tagLine: p.tagLine,
      assignedPosition: p.position || pre?.assignedPosition || '-',
      championId: p.championId ?? pre?.championId ?? null,
      championName: p.championName,
      championKey: p.championKey ?? pre?.championKey ?? null,
      championImage: p.championImage,
      isPickIntent: false,
      locked: true,
      championWinRate: p.championWinRate ?? pre?.championWinRate ?? null,
      championTier: p.championTier ?? pre?.championTier ?? null,
      spell1Id: null,
      spell2Id: null,
      puuid: pre?.puuid ?? null,
      playerStats: pre?.playerStats ?? null,
      live: {
        level: p.level,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs,
        wardScore: p.wardScore,
        isDead: p.isDead,
        respawnTimer: p.respawnTimer,
        combatScore: p.combatScore,
        damageShare: p.damageShare,
        goldEstimate: p.goldEstimate,
        kdaRatio: p.kdaRatio,
        keystone: p.keystone,
        spell1: p.spell1,
        spell2: p.spell2,
        spell1Key: p.spell1Key,
        spell2Key: p.spell2Key,
        items: p.items,
      },
      links: buildProfileLinks(p.gameName, p.tagLine, region, 'lol'),
    }
  }

  const allies = ingame.allies.map(toCard)
  const enemies = ingame.enemies.map(toCard)

  // Win% live basé sur combat score + ranked form
  const form = (list: PlayerCard[]) => {
    const vals = list
      .map((p) => {
        const ranked = p.playerStats?.formScore ?? p.playerStats?.rankedWR
        const livePower = p.live ? 40 + p.live.damageShare * 0.4 + p.live.kdaRatio * 3 : null
        if (ranked != null && livePower != null) return ranked * 0.45 + livePower * 0.55
        return ranked ?? livePower
      })
      .filter((v): v is number => v != null)
    if (!vals.length) return 50
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const a = form(allies)
  const e = form(enemies)
  const solo = enemies.length === 0
  const practice = /PRACTICE/i.test(ingame.gameMode || '')
  let allyChance: number
  if (solo) {
    allyChance = 100
  } else {
    const allyPower = Math.pow(Math.max(a, 1) / 50, 1.25)
    const enemyPower = Math.pow(Math.max(e, 1) / 50, 1.25)
    allyChance = Number(((allyPower / (allyPower + enemyPower)) * 100).toFixed(1))
  }

  const mm = Math.floor(ingame.gameTime / 60)
  const ss = String(ingame.gameTime % 60).padStart(2, '0')

  return {
    connected: params.connected,
    phase: params.phase,
    demo: false,
    mode: 'lol',
    queueName: params.queueName || queueLabel(null, ingame.gameMode),
    region,
    localPlayerCellId:
      allies.find(
        (p) =>
          p.gameName.toLowerCase() === (params.currentSummoner?.gameName || '').toLowerCase(),
      )?.cellId ?? null,
    timer: null,
    bans: { ally: [], enemy: [] },
    allies,
    enemies,
    players: [...allies, ...enemies],
    teamWinChance: {
      ally: allyChance,
      enemy: solo ? 0 : Number((100 - allyChance).toFixed(1)),
    },
    message: solo
      ? `EN PARTIE · ${mm}:${ss} · ${practice ? 'OUTIL D’ENTRAÎNEMENT (solo)' : 'SOLO / CUSTOM'}, pas d'ennemis`
      : `EN PARTIE · ${mm}:${ss} · KDA ${ingame.teamTotals.ally.kills}/${ingame.teamTotals.ally.deaths}/${ingame.teamTotals.ally.assists} vs ${ingame.teamTotals.enemy.kills}/${ingame.teamTotals.enemy.deaths}/${ingame.teamTotals.enemy.assists}`,
    inGame: {
      active: true,
      gameMode: ingame.gameMode,
      gameTime: ingame.gameTime,
      mapName: ingame.mapName,
      events: ingame.events,
      teamTotals: ingame.teamTotals,
    },
  }
}

/** Fallback LoL in-game via gameflow LCU (quand Live Client 2999 est down) */
export async function buildLolFromGameflow(params: {
  lockfile: LockfileData
  connected: boolean
  phase: string
  region: string
  queueName?: string
  session: GameflowSession
  currentSummoner?: { gameName?: string; tagLine?: string; puuid?: string } | null
}): Promise<LiveSession | null> {
  const teamOne = params.session.gameData?.teamOne ?? []
  const teamTwo = params.session.gameData?.teamTwo ?? []
  if (!teamOne.length && !teamTwo.length) return null

  const region = normalizeRegion(params.region)
  const mePuuid = params.currentSummoner?.puuid
  const meName = params.currentSummoner?.gameName?.toLowerCase()

  // Déterminer mon côté
  let mySide: 'one' | 'two' = 'one'
  if (mePuuid) {
    if (teamTwo.some((p) => p.puuid === mePuuid)) mySide = 'two'
  } else if (meName) {
    for (const raw of teamTwo) {
      if (!raw.puuid) continue
      const resolved =
        (await lcuGet<{ gameName?: string }>(params.lockfile, `/lol-summoner/v1/summoners/puuid/${raw.puuid}`)) ||
        (await lcuGet<{ gameName?: string }>(params.lockfile, `/lol-summoner/v2/summoners/puuid/${raw.puuid}`))
      if (resolved?.gameName?.toLowerCase() === meName) {
        mySide = 'two'
        break
      }
    }
  }

  const allyRaw = mySide === 'one' ? teamOne : teamTwo
  const enemyRaw = mySide === 'one' ? teamTwo : teamOne

  const toCard = async (
    raw: { championId?: number; puuid?: string; summonerName?: string },
    team: TeamSide,
    index: number,
  ): Promise<PlayerCard> => {
    let gameName = raw.summonerName || 'Joueur'
    let tagLine = '???'
    if (raw.puuid) {
      const resolved =
        (await lcuGet<{ gameName?: string; tagLine?: string }>(
          params.lockfile,
          `/lol-summoner/v1/summoners/puuid/${raw.puuid}`,
        )) ||
        (await lcuGet<{ gameName?: string; tagLine?: string }>(
          params.lockfile,
          `/lol-summoner/v2/summoners/puuid/${raw.puuid}`,
        ))
      if (resolved?.gameName) {
        gameName = resolved.gameName
        tagLine = resolved.tagLine || '???'
      }
    }
    const champ = raw.championId ? await getChampionById(raw.championId) : null
    return {
      cellId: index,
      team,
      summonerName: `${gameName}#${tagLine}`,
      gameName,
      tagLine,
      assignedPosition: '-',
      championId: raw.championId ?? champ?.id ?? null,
      championName: champ?.name ?? null,
      championKey: champ?.key ?? null,
      championImage: champ?.image ?? null,
      isPickIntent: false,
      locked: true,
      championWinRate: champ?.winRate ?? null,
      championTier: champ?.tier ?? null,
      spell1Id: null,
      spell2Id: null,
      puuid: raw.puuid ?? null,
      playerStats: null,
      live: null,
      links: buildProfileLinks(gameName, tagLine, region, 'lol'),
    }
  }

  const allies = await Promise.all(allyRaw.map((p, i) => toCard(p, 'ally', i)))
  const enemies = await Promise.all(enemyRaw.map((p, i) => toCard(p, 'enemy', i + 5)))

  // Enrichir avec Live Client si dispo (KDA / items)
  const liveState = await fetchInGameState(
    params.currentSummoner?.gameName
      ? `${params.currentSummoner.gameName}#${params.currentSummoner.tagLine || ''}`
      : null,
  )
  if (liveState) {
    const merge = (card: PlayerCard) => {
      const live =
        liveState.allies.find((x) => x.gameName.toLowerCase() === card.gameName.toLowerCase()) ||
        liveState.enemies.find((x) => x.gameName.toLowerCase() === card.gameName.toLowerCase())
      if (!live) return card
      return {
        ...card,
        championName: live.championName || card.championName,
        championImage: live.championImage || card.championImage,
        championId: live.championId ?? card.championId,
        championKey: live.championKey ?? card.championKey,
        assignedPosition: live.position || card.assignedPosition,
        live: {
          level: live.level,
          kills: live.kills,
          deaths: live.deaths,
          assists: live.assists,
          cs: live.cs,
          wardScore: live.wardScore,
          isDead: live.isDead,
          respawnTimer: live.respawnTimer,
          combatScore: live.combatScore,
          damageShare: live.damageShare,
          goldEstimate: live.goldEstimate,
          kdaRatio: live.kdaRatio,
          keystone: live.keystone,
          spell1: live.spell1,
          spell2: live.spell2,
          spell1Key: live.spell1Key,
          spell2Key: live.spell2Key,
          items: live.items,
        },
      }
    }
    for (let i = 0; i < allies.length; i++) allies[i] = merge(allies[i]!)
    for (let i = 0; i < enemies.length; i++) enemies[i] = merge(enemies[i]!)
  }

  const localPlayerCellId =
    allies.find((p) => p.gameName.toLowerCase() === (meName || ''))?.cellId ?? null

  return {
    connected: params.connected,
    phase: params.phase,
    demo: false,
    mode: 'lol',
    queueName: params.queueName || queueLabel(params.session.gameData?.queue?.id, params.session.gameData?.queue?.gameMode),
    region,
    localPlayerCellId,
    timer: null,
    bans: { ally: [], enemy: [] },
    allies,
    enemies,
    players: [...allies, ...enemies],
    teamWinChance: { ally: 50, enemy: 50 },
    message: liveState
      ? `EN PARTIE · Live Client OK · ${allies.length + enemies.length} joueurs`
      : `EN PARTIE · scoreboard LCU (${allies.length + enemies.length} joueurs), Live Client 2999 indisponible`,
    inGame: {
      active: true,
      gameMode: liveState?.gameMode || params.session.gameData?.queue?.gameMode || 'CLASSIC',
      gameTime: liveState?.gameTime ?? 0,
      mapName: liveState?.mapName || params.session.map?.name || '',
      events: liveState?.events ?? [],
      teamTotals: liveState?.teamTotals ?? {
        ally: { kills: 0, deaths: 0, assists: 0, cs: 0, combat: 0, gold: 0 },
        enemy: { kills: 0, deaths: 0, assists: 0, cs: 0, combat: 0, gold: 0 },
      },
    },
  }
}
