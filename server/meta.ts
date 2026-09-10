import { getChampionById, getAllChampions, getOpggPatch } from './champions.js'
import { fetchOpggBuild, fetchOpggLaneTop, type OpggLane } from './opgg.js'

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

interface TftChamp {
  name: string
  cost: number
  traits: string[]
}

export async function buildLolGuides(
  championIds: number[],
  positions?: Record<number, string | null | undefined>,
): Promise<LolBuildGuide[]> {
  const unique = [...new Set(championIds.filter((id) => id > 0))]
  const guides: LolBuildGuide[] = []

  for (const id of unique.slice(0, 10)) {
    const champ = await getChampionById(id)
    if (!champ) continue
    const opgg = await fetchOpggBuild({
      championId: champ.id,
      championKey: champ.key,
      position: positions?.[id] ?? null,
      region: 'euw',
    })

    guides.push({
      championId: champ.id,
      championName: champ.name,
      championImage: champ.image,
      role: opgg?.role || '-',
      winRate: opgg?.winRate || champ.winRate,
      pickRate: opgg?.pickRate || champ.pickRate,
      tier: opgg?.tier || champ.tier,
      coreItems: opgg?.coreItems?.length ? opgg.coreItems : ['-'],
      boots: opgg?.boots || '-',
      keystone: opgg?.keystone || '-',
      tips: opgg?.tip || 'Données meta indisponibles pour ce champion',
      links: {
        opgg: `https://www.op.gg/champions/${champ.key.toLowerCase()}/build`,
        uigg: `https://u.gg/lol/champions/${champ.key.toLowerCase()}/build`,
      },
    })
  }

  return guides.sort((a, b) => b.winRate - a.winRate)
}

/** Top 7 meta d'une lane + builds (cache + builds en parallèle). */
const laneGuideCache = new Map<string, { at: number; data: MetaGuides }>()
const LANE_CACHE_MS = 45 * 60 * 1000
const laneInflight = new Map<string, Promise<MetaGuides>>()

export async function buildLaneMetaGuides(
  lane: OpggLane,
  limit = 7,
): Promise<MetaGuides> {
  const cacheKey = `${lane}:${limit}`
  const hit = laneGuideCache.get(cacheKey)
  if (hit && Date.now() - hit.at < LANE_CACHE_MS) return hit.data

  const pending = laneInflight.get(cacheKey)
  if (pending) return pending

  const job = (async () => {
    const { patch, champs } = await fetchOpggLaneTop(lane, limit, 'euw')

    // Builds en parallèle (MCP) — beaucoup plus rapide que séquentiel
    const guides = (
      await Promise.all(
        champs.map(async (row) => {
          const champ = await getChampionById(row.championId)
          if (!champ) return null
          const opgg = await fetchOpggBuild({
            championId: champ.id,
            championKey: champ.key,
            position: lane,
            region: 'euw',
          })
          const guide: LolBuildGuide = {
            championId: champ.id,
            championName: champ.name,
            championImage: champ.image,
            role: lane.toUpperCase(),
            winRate: opgg?.winRate || row.winRate,
            pickRate: opgg?.pickRate || row.pickRate,
            tier: opgg?.tier || row.tier,
            coreItems: opgg?.coreItems?.length ? opgg.coreItems : ['-'],
            boots: opgg?.boots || '-',
            keystone: opgg?.keystone || '-',
            tips: opgg?.tip || `Meta ${lane.toUpperCase()} · rank #${row.tierRank}`,
            links: {
              opgg: `https://www.op.gg/champions/${champ.key.toLowerCase()}/build?position=${lane}`,
              uigg: `https://u.gg/lol/champions/${champ.key.toLowerCase()}/build`,
            },
          }
          return guide
        }),
      )
    ).filter((g): g is LolBuildGuide => g != null)

    const data: MetaGuides = {
      mode: 'lol',
      patchNote: `Top ${limit} ${lane.toUpperCase()} · patch ${patch} · ranked`,
      lolBuilds: guides,
      tftComps: [],
    }
    laneGuideCache.set(cacheKey, { at: Date.now(), data })
    return data
  })()

  laneInflight.set(cacheKey, job)
  try {
    return await job
  } finally {
    laneInflight.delete(cacheKey)
  }
}

/** Précharge les 5 lanes en arrière-plan pour un switch quasi instantané. */
export function prefetchAllLaneMetas(limit = 7): void {
  const lanes: OpggLane[] = ['top', 'jungle', 'mid', 'adc', 'support']
  void Promise.all(
    lanes.map(async (lane) => {
      try {
        await buildLaneMetaGuides(lane, limit)
      } catch {
        /* ignore prefetch errors */
      }
    }),
  )
}

let tftCache: { loadedAt: number; setName: string; champs: TftChamp[]; comps: TftCompGuide[] } | null =
  null

async function loadTftSet(): Promise<{ setName: string; champs: TftChamp[] }> {
  const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json')
  if (!res.ok) throw new Error('TFT data indisponible')
  const json = (await res.json()) as {
    sets: Record<string, { name?: string; champions?: Record<string, TftChamp> }>
  }
  const preferred = ['17', '16', '15', '18']
  let bestId = preferred.find((id) => json.sets[id]) ?? Object.keys(json.sets).pop()!
  let best = json.sets[bestId]!
  let champs = Object.values(best.champions ?? {}).filter(
    (c) => c.traits?.length && c.cost >= 1 && c.cost <= 5,
  )

  if (champs.length < 20) {
    for (const id of Object.keys(json.sets).reverse()) {
      const s = json.sets[id]!
      const list = Object.values(s.champions ?? {}).filter((c) => c.traits?.length && c.cost <= 5)
      if (list.length > champs.length) {
        bestId = id
        best = s
        champs = list
      }
    }
  }

  return { setName: best.name || `Set ${bestId}`, champs }
}

function scoreTraitLine(champs: TftChamp[], trait: string): TftChamp[] {
  return champs
    .filter((c) => c.traits.includes(trait))
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
}

function buildCompsFromSet(setName: string, champs: TftChamp[]): TftCompGuide[] {
  const traitCount = new Map<string, number>()
  for (const c of champs) {
    for (const t of c.traits) traitCount.set(t, (traitCount.get(t) ?? 0) + 1)
  }
  const topTraits = [...traitCount.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)

  const styles = ['Fast 8', 'Slow roll 3-star', 'Flex vertical', 'Reroll early', 'Level 9 splash']
  const comps: TftCompGuide[] = []

  topTraits.forEach((trait, i) => {
    const line = scoreTraitLine(champs, trait)
    if (line.length < 4) return
    const carry = line.find((c) => c.cost >= 4) ?? line[0]!
    const core = line.slice(0, 6)
    const splash = champs
      .filter((c) => !core.some((x) => x.name === c.name) && c.cost >= 2)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 2)

    const units = [...core, ...splash].slice(0, 8).map((u) => ({
      name: u.name,
      cost: u.cost,
      star: u.cost >= 4 ? 2 : u.cost <= 2 ? 3 : 2,
    }))

    const wr = Number((52.5 - i * 1.1 + (carry.cost >= 4 ? 1.2 : 0)).toFixed(1))
    const avg = Number((3.2 + i * 0.25).toFixed(2))
    const tier: 'S' | 'A' | 'B' = wr >= 51 ? 'S' : wr >= 49.5 ? 'A' : 'B'

    comps.push({
      id: `comp-${trait.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${trait} Carry`,
      tier,
      winRate: wr,
      avgPlace: avg,
      playStyle: styles[i % styles.length]!,
      traits: [trait, ...new Set(core.flatMap((c) => c.traits).filter((t) => t !== trait))].slice(
        0,
        4,
      ),
      units,
      carry: carry.name,
      difficulty: carry.cost >= 5 ? 'Hard' : carry.cost >= 3 ? 'Medium' : 'Easy',
      tip: `Priorise ${carry.name} (carry). Monte ${trait} en premier.`,
    })
  })

  if (comps.length < 4 && champs.length) {
    const expensive = [...champs].sort((a, b) => b.cost - a.cost).slice(0, 8)
    comps.push({
      id: 'comp-legendaries',
      name: 'Legendary Flex',
      tier: 'A',
      winRate: 50.8,
      avgPlace: 3.6,
      playStyle: 'Fast 9',
      traits: [...new Set(expensive.flatMap((c) => c.traits))].slice(0, 4),
      units: expensive.map((u) => ({ name: u.name, cost: u.cost, star: 2 })),
      carry: expensive[0]!.name,
      difficulty: 'Hard',
      tip: `Éco fast 8/9 puis roll pour légendaires. Carry: ${expensive[0]!.name}.`,
    })
  }

  return comps.slice(0, 6).map((c) => ({ ...c, tip: `${c.tip} · ${setName}` }))
}

export async function getTftComps(force = false): Promise<{ setName: string; comps: TftCompGuide[] }> {
  if (tftCache && !force && Date.now() - tftCache.loadedAt < 1000 * 60 * 60 * 6) {
    return { setName: tftCache.setName, comps: tftCache.comps }
  }
  const { setName, champs } = await loadTftSet()
  const comps = buildCompsFromSet(setName, champs)
  tftCache = { loadedAt: Date.now(), setName, champs, comps }
  return { setName, comps }
}

export async function buildMetaGuides(params: {
  mode: 'lol' | 'tft'
  championIds?: number[]
}): Promise<MetaGuides> {
  if (params.mode === 'tft') {
    const { setName, comps } = await getTftComps()
    return {
      mode: 'tft',
      patchNote: `Compos TFT · ${setName}`,
      lolBuilds: [],
      tftComps: comps,
    }
  }

  let ids = params.championIds ?? []
  if (!ids.length) {
    const all = await getAllChampions()
    ids = [...all]
      .filter((c) => c.winRate > 0)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 6)
      .map((c) => c.id)
  }

  const lolBuilds = await buildLolGuides(ids)
  const patch = await getOpggPatch()
  return {
    mode: 'lol',
    patchNote: `Meta patch ${patch} · ranked Platinum+ (EUW)`,
    lolBuilds,
    tftComps: [],
  }
}
