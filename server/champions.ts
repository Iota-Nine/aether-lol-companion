import type { ChampionInfo } from './types.js'
import { fetchOpggRankedMeta } from './opgg.js'

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
  patchOpgg: string
  byId: Map<number, ChampionInfo>
  byKey: Map<string, ChampionInfo>
  list: ChampionInfo[]
  loadedAt: number
} | null = null

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

  let opggById = new Map<
    number,
    { winRate: number; pickRate: number; banRate: number; tier: string }
  >()
  let patchOpgg = '-'
  try {
    const opgg = await fetchOpggRankedMeta('euw')
    opggById = opgg.byId
    patchOpgg = opgg.patch
  } catch (e) {
    console.warn('[aether] meta indisponible:', e)
  }

  const byId = new Map<number, ChampionInfo>()
  const byKey = new Map<string, ChampionInfo>()
  const list: ChampionInfo[] = []

  for (const champ of Object.values(json.data)) {
    const id = Number(champ.key)
    const op = opggById.get(id)
    const info: ChampionInfo = {
      id,
      key: champ.id,
      name: champ.name,
      title: champ.title,
      image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.image.full}`,
      tags: champ.tags,
      winRate: op?.winRate && op.winRate > 0 ? op.winRate : 0,
      pickRate: op?.pickRate ?? 0,
      banRate: op?.banRate ?? 0,
      tier: op?.tier ?? '-',
    }
    byId.set(info.id, info)
    byKey.set(info.key.toLowerCase(), info)
    list.push(info)
  }

  list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  cache = { version, patchOpgg, byId, byKey, list, loadedAt: Date.now() }
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

export async function getOpggPatch(): Promise<string> {
  const data = await loadChampions()
  return data?.patchOpgg || '-'
}

export function estimateTeamWinChance(winRates: number[]): number {
  if (winRates.length === 0) return 50
  const avg = winRates.reduce((a, b) => a + b, 0) / winRates.length
  return Number((50 + (avg - 50) * 1.6).toFixed(1))
}
