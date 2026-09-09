import type { ChampionInfo } from './types.js'

interface DDragonChampion {
  key: string
  id: string
  name: string
  title: string
  tags: string[]
  image: { full: string }
}

let cache: {
  version: string
  byId: Map<number, ChampionInfo>
  byKey: Map<string, ChampionInfo>
  list: ChampionInfo[]
  loadedAt: number
} | null = null

const FALLBACK_WINRATES: Record<string, { wr: number; pr: number; br: number; tier: string }> = {
  Ahri: { wr: 51.2, pr: 8.4, br: 2.1, tier: 'A' },
  Yasuo: { wr: 49.1, pr: 12.3, br: 18.5, tier: 'B' },
  Jinx: { wr: 50.8, pr: 14.1, br: 6.2, tier: 'A' },
  Thresh: { wr: 50.1, pr: 9.7, br: 11.4, tier: 'A' },
  LeeSin: { wr: 47.9, pr: 10.2, br: 7.8, tier: 'B' },
  Darius: { wr: 50.4, pr: 7.5, br: 9.1, tier: 'A' },
  Lux: { wr: 49.6, pr: 11.8, br: 4.3, tier: 'B' },
  Zed: { wr: 48.7, pr: 8.9, br: 14.2, tier: 'B' },
  Kaisa: { wr: 51.5, pr: 16.2, br: 8.9, tier: 'S' },
  Sett: { wr: 50.9, pr: 6.8, br: 5.4, tier: 'A' },
  Yone: { wr: 49.3, pr: 9.4, br: 10.1, tier: 'B' },
  MissFortune: { wr: 51.8, pr: 13.5, br: 3.2, tier: 'S' },
  Nami: { wr: 51.1, pr: 7.2, br: 1.8, tier: 'A' },
  Viego: { wr: 50.2, pr: 8.1, br: 6.7, tier: 'A' },
  Garen: { wr: 51.0, pr: 6.1, br: 2.4, tier: 'A' },
  Syndra: { wr: 49.8, pr: 5.4, br: 4.9, tier: 'B' },
  Ezreal: { wr: 48.9, pr: 15.7, br: 2.8, tier: 'B' },
  Lillia: { wr: 51.4, pr: 5.9, br: 3.6, tier: 'A' },
  Ornn: { wr: 50.6, pr: 4.2, br: 1.5, tier: 'A' },
  Pyke: { wr: 49.0, pr: 6.5, br: 12.8, tier: 'B' },
}

/** Stats champ de secours (pas de meta live officielle sans API Riot). */
function hashWinRate(key: string): { wr: number; pr: number; br: number; tier: string } {
  if (FALLBACK_WINRATES[key]) return FALLBACK_WINRATES[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  const wr = 47 + (hash % 80) / 10
  const pr = 2 + (hash % 150) / 10
  const br = 1 + ((hash >> 3) % 120) / 10
  const tier = wr >= 51.5 ? 'S' : wr >= 50.5 ? 'A' : wr >= 49 ? 'B' : 'C'
  return { wr: Number(wr.toFixed(1)), pr: Number(pr.toFixed(1)), br: Number(br.toFixed(1)), tier }
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  if (!res.ok) throw new Error('Impossible de récupérer la version Data Dragon')
  const versions = (await res.json()) as string[]
  return versions[0] ?? '14.18.1'
}

export async function loadChampions(force = false): Promise<typeof cache> {
  if (cache && !force && Date.now() - cache.loadedAt < 1000 * 60 * 60 * 6) {
    return cache
  }

  const version = await fetchLatestVersion()
  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`,
  )
  if (!res.ok) throw new Error('Impossible de charger les champions')
  const json = (await res.json()) as { data: Record<string, DDragonChampion> }

  const byId = new Map<number, ChampionInfo>()
  const byKey = new Map<string, ChampionInfo>()
  const list: ChampionInfo[] = []

  for (const champ of Object.values(json.data)) {
    const stats = hashWinRate(champ.id)
    const info: ChampionInfo = {
      id: Number(champ.key),
      key: champ.id,
      name: champ.name,
      title: champ.title,
      image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.image.full}`,
      tags: champ.tags,
      winRate: stats.wr,
      pickRate: stats.pr,
      banRate: stats.br,
      tier: stats.tier,
    }
    byId.set(info.id, info)
    byKey.set(info.key.toLowerCase(), info)
    list.push(info)
  }

  list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  cache = { version, byId, byKey, list, loadedAt: Date.now() }
  return cache
}

export async function getChampionById(id: number): Promise<ChampionInfo | null> {
  const data = await loadChampions()
  return data?.byId.get(id) ?? null
}

export async function getAllChampions(): Promise<ChampionInfo[]> {
  const data = await loadChampions()
  return data?.list ?? []
}

export function estimateTeamWinChance(winRates: number[]): number {
  if (winRates.length === 0) return 50
  const avg = winRates.reduce((a, b) => a + b, 0) / winRates.length
  // compress around 50 so teams stay readable
  return Number((50 + (avg - 50) * 1.6).toFixed(1))
}
