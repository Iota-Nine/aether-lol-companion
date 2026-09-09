export type TeamSide = 'ally' | 'enemy'
export type GameMode = 'lol' | 'tft' | 'idle'

export interface ChampionInfo {
  id: number
  key: string
  name: string
  title: string
  image: string
  tags: string[]
  winRate: number
  pickRate: number
  banRate: number
  tier: string
}

export interface PlayerCard {
  cellId: number
  team: TeamSide
  summonerName: string
  gameName: string
  tagLine: string
  assignedPosition: string
  championId: number | null
  championName: string | null
  championKey: string | null
  championImage: string | null
  isPickIntent: boolean
  locked: boolean
  championWinRate: number | null
  championTier: string | null
  spell1Id: number | null
  spell2Id: number | null
  puuid?: string | null
  playerStats?: PlayerStats | null
  live?: PlayerLiveStats | null
  links: {
    opgg: string
    porofessor: string
    uigg: string
    lolchess: string
  }
}

export interface PlayerLiveStats {
  level: number
  kills: number
  deaths: number
  assists: number
  cs: number
  wardScore: number
  isDead: boolean
  respawnTimer: number
  combatScore: number
  damageShare: number
  goldEstimate: number
  kdaRatio: number
  keystone: string | null
  spell1: string | null
  spell2: string | null
  spell1Key?: string | null
  spell2Key?: string | null
  items: { itemID: number; displayName: string; count: number; price: number }[]
}

export interface PlayerStats {
  rankedWR: number | null
  recentWR: number | null
  top4Rate: number | null
  wins: number
  losses: number
  tier: string | null
  division: string | null
  lp: number | null
  recentGames: number
  formScore: number | null
  source: string
}

export interface InGameSnapshot {
  active: boolean
  gameMode: string
  gameTime: number
  mapName: string
  events: {
    id: number
    name: string
    time: number
    label: string
    kind?: 'kill' | 'objective' | 'ace' | 'structure' | 'system' | 'other'
  }[]
  teamTotals: {
    ally: { kills: number; deaths: number; assists: number; cs: number; combat: number; gold: number }
    enemy: { kills: number; deaths: number; assists: number; cs: number; combat: number; gold: number }
  }
}

export interface LiveSession {
  connected: boolean
  phase: string
  demo: boolean
  mode: GameMode
  queueName?: string
  region: string
  localPlayerCellId: number | null
  timer: {
    phase: string
    adjustedTimeLeftInPhase: number
  } | null
  bans: {
    ally: { id: number; name: string; image: string }[]
    enemy: { id: number; name: string; image: string }[]
  }
  allies: PlayerCard[]
  enemies: PlayerCard[]
  /** Tous les joueurs (surtout TFT) */
  players: PlayerCard[]
  teamWinChance: {
    ally: number
    enemy: number
  }
  message: string
  guides?: MetaGuides
  inGame?: InGameSnapshot | null
}

export interface LolBuildGuide {
  championId: number
  championName: string
  championImage: string | null
  role: string
  winRate: number
  pickRate: number
  tier: string
  coreItems: string[]
  boots: string
  keystone: string
  tips: string
  links: { opgg: string; uigg: string }
}

export interface TftCompGuide {
  id: string
  name: string
  tier: 'S' | 'A' | 'B'
  winRate: number
  avgPlace: number
  playStyle: string
  traits: string[]
  units: { name: string; cost: number; star: number }[]
  carry: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  tip: string
}

export interface MetaGuides {
  mode: 'lol' | 'tft'
  patchNote: string
  lolBuilds: LolBuildGuide[]
  tftComps: TftCompGuide[]
}

export interface LockfileData {
  name: string
  pid: number
  port: number
  password: string
  protocol: string
}
