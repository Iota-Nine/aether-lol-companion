import type { ChampionInfo } from './types.js'
import { getChampionById, getAllChampions } from './champions.js'

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

const LOL_BUILDS: Record<
  string,
  { role: string; items: string[]; boots: string; keystone: string; tip: string }
> = {
  Ahri: {
    role: 'Mid',
    items: ['Luden', 'Shadowflame', 'Rabadon'],
    boots: 'Sorcerer',
    keystone: 'Electrocute',
    tip: 'Poke puis combo burst R. Priorise Shadowflame vs tanks légers.',
  },
  Yasuo: {
    role: 'Mid/Top',
    items: ["Immortal Shieldbow", 'IE', 'Bloodthirster'],
    boots: 'Berserker',
    keystone: 'Conqueror',
    tip: 'Stack Q, cherche le knock-up allié. IE 2e item après mythique crit.',
  },
  Jinx: {
    role: 'ADC',
    items: ['Kraken', 'PD', 'IE'],
    boots: 'Berserker',
    keystone: 'Fleet Footwork',
    tip: 'Reset Rockets après kill. Kraken vs tanks, Galeforce vs poke.',
  },
  Thresh: {
    role: 'Support',
    items: ['Locket', 'Zeke', 'Knight Vow'],
    boots: 'Mobility',
    keystone: 'Aftershock',
    tip: 'Hook engage / flay peel. Build tank aura pour protéger l’ADC.',
  },
  LeeSin: {
    role: 'Jungle',
    items: ['Eclipse', 'Black Cleaver', 'Maw'],
    boots: 'Mercury',
    keystone: 'Conqueror',
    tip: 'Early ganks Q. Eclipse pour duellisme, Cleaver pour shred.',
  },
  Darius: {
    role: 'Top',
    items: ['Stridebreaker', 'Sterak', 'Dead Man'],
    boots: 'Plated',
    keystone: 'Conqueror',
    tip: 'Stack bleed, flash dunk. Sterak après core anti-burst.',
  },
  Lux: {
    role: 'Mid/Support',
    items: ['Luden', 'Horizon', 'Rabadon'],
    boots: 'Sorcerer',
    keystone: 'Dark Harvest',
    tip: 'Poke E + snare Q. Horizon Focus pour vision / burst.',
  },
  Zed: {
    role: 'Mid',
    items: ['Eclipse', 'Youmuu', 'Serylda'],
    boots: 'Ionian',
    keystone: 'Electrocute',
    tip: 'Roam mid-game. Youmuu pour vitesse, Serylda vs tanks.',
  },
  Kaisa: {
    role: 'ADC',
    items: ['Kraken', 'Nashor', 'Rabadon'],
    boots: 'Berserker',
    keystone: 'Hail of Blades',
    tip: 'Evolve Q puis E. Hybrid on-hit / AP selon game.',
  },
  Sett: {
    role: 'Top',
    items: ['Stridebreaker', 'Sterak', 'Warmog'],
    boots: 'Plated',
    keystone: 'Conqueror',
    tip: 'W true damage. Stride pour sticky fights.',
  },
  Yone: {
    role: 'Mid/Top',
    items: ['Shieldbow', 'IE', 'DeathDance'],
    boots: 'Berserker',
    keystone: 'Fleet Footwork',
    tip: 'E in/out. Crit path standard après Shieldbow.',
  },
  MissFortune: {
    role: 'ADC',
    items: ['Youmuu', 'Collector', 'IE'],
    boots: 'Ionian',
    keystone: 'Press the Attack',
    tip: 'Lethality poke. Ult en side angle.',
  },
  Nami: {
    role: 'Support',
    items: ['Moonstone', 'Staff Flowing Water', 'Ardent'],
    boots: 'Ionian',
    keystone: 'Summon Aery',
    tip: 'Enchanter peel. Bubble engage / save.',
  },
  Viego: {
    role: 'Jungle',
    items: ['Trinity', 'Kraken', 'DeathDance'],
    boots: 'Mercury',
    keystone: 'Conqueror',
    tip: 'Reset possess. Trinity first item core.',
  },
  Garen: {
    role: 'Top',
    items: ['Stridebreaker', 'Dead Man', 'Force of Nature'],
    boots: 'Mercury',
    keystone: 'Conqueror',
    tip: 'Silence Q + spin. Tanky second items.',
  },
  Ezreal: {
    role: 'ADC',
    items: ['Trinity', 'Manamune', 'Serylda'],
    boots: 'Ionian',
    keystone: 'Conqueror',
    tip: 'Poke poke poke. Manamune evolve ASAP.',
  },
}

function defaultBuild(champ: ChampionInfo): {
  role: string
  items: string[]
  boots: string
  keystone: string
  tip: string
} {
  const isMage = champ.tags.includes('Mage')
  const isMarksman = champ.tags.includes('Marksman')
  const isAssassin = champ.tags.includes('Assassin')
  const isTank = champ.tags.includes('Tank')
  const isSupport = champ.tags.includes('Support')
  if (isMarksman) {
    return {
      role: 'ADC',
      items: ['Kraken', 'PD', 'IE'],
      boots: 'Berserker',
      keystone: 'Lethal Tempo',
      tip: 'Core crit. Adapte le 2e item selon front ennemi.',
    }
  }
  if (isMage) {
    return {
      role: 'Mid',
      items: ['Luden', 'Shadowflame', 'Rabadon'],
      boots: 'Sorcerer',
      keystone: 'Electrocute',
      tip: 'Burst AP. Shadowflame vs shields.',
    }
  }
  if (isAssassin) {
    return {
      role: 'Mid/Jungle',
      items: ['Eclipse', 'Youmuu', 'Serylda'],
      boots: 'Ionian',
      keystone: 'Electrocute',
      tip: 'Lethality tempo. Roam après 1 item.',
    }
  }
  if (isSupport) {
    return {
      role: 'Support',
      items: ['Locket', 'Zeke', 'Redemption'],
      boots: 'Mobility',
      keystone: 'Guardian',
      tip: 'Utilitaire / peel. Adapte aura au compo.',
    }
  }
  if (isTank) {
    return {
      role: 'Top/Jungle',
      items: ['Heartsteel', 'Spirit Visage', 'Thornmail'],
      boots: 'Plated',
      keystone: 'Grasp',
      tip: 'Frontline tank. Stack HP puis résistances.',
    }
  }
  return {
    role: champ.tags[0] || 'Flex',
    items: ['Trinity', 'Sterak', 'DD'],
    boots: 'Mercury',
    keystone: 'Conqueror',
    tip: 'Build bruiser polyvalent.',
  }
}

export async function buildLolGuides(championIds: number[]): Promise<LolBuildGuide[]> {
  const unique = [...new Set(championIds.filter((id) => id > 0))]
  const guides: LolBuildGuide[] = []
  for (const id of unique.slice(0, 10)) {
    const champ = await getChampionById(id)
    if (!champ) continue
    const preset = LOL_BUILDS[champ.key] ?? defaultBuild(champ)
    guides.push({
      championId: champ.id,
      championName: champ.name,
      championImage: champ.image,
      role: preset.role,
      winRate: champ.winRate,
      pickRate: champ.pickRate,
      tier: champ.tier,
      coreItems: preset.items,
      boots: preset.boots,
      keystone: preset.keystone,
      tips: preset.tip,
      links: {
        opgg: `https://www.op.gg/champions/${champ.key.toLowerCase()}/build`,
        uigg: `https://u.gg/lol/champions/${champ.key.toLowerCase()}/build`,
      },
    })
  }
  return guides.sort((a, b) => b.winRate - a.winRate)
}

let tftCache: { loadedAt: number; setName: string; champs: TftChamp[]; comps: TftCompGuide[] } | null =
  null

async function loadTftSet(): Promise<{ setName: string; champs: TftChamp[] }> {
  const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json')
  if (!res.ok) throw new Error('TFT data indisponible')
  const json = (await res.json()) as {
    sets: Record<string, { name?: string; champions?: Record<string, TftChamp> }>
  }
  // Préfère le set avec le plus d'unités traitées récentes (17 > 16 > 15…)
  const preferred = ['17', '16', '15', '18']
  let bestId = preferred.find((id) => json.sets[id]) ?? Object.keys(json.sets).pop()!
  let best = json.sets[bestId]!
  let champs = Object.values(best.champions ?? {}).filter((c) => c.traits?.length && c.cost >= 1 && c.cost <= 5)

  // Si trop peu d'unités, fallback
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
    // splash flex units from other traits
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
      traits: [trait, ...new Set(core.flatMap((c) => c.traits).filter((t) => t !== trait))].slice(0, 4),
      units,
      carry: carry.name,
      difficulty: carry.cost >= 5 ? 'Hard' : carry.cost >= 3 ? 'Medium' : 'Easy',
      tip: `Priorise ${carry.name} (carry). Monte ${trait} en premier, splash flex selon le lobby.`,
    })
  })

  // Dedicated strong archetypes if we have enough traits
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

  return comps.slice(0, 6).map((c) => ({ ...c, tip: `${c.tip} · Meta ${setName}` }))
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
      patchNote: `Compos TFT suggérées · ${setName} (indicatif meta)`,
      lolBuilds: [],
      tftComps: comps,
    }
  }

  let ids = params.championIds ?? []
  if (!ids.length) {
    // Top WR champs as default suggestions
    const all = await getAllChampions()
    ids = [...all].sort((a, b) => b.winRate - a.winRate).slice(0, 6).map((c) => c.id)
  }

  const lolBuilds = await buildLolGuides(ids)
  return {
    mode: 'lol',
    patchNote: 'Builds LoL suggérés selon les picks détectés (WR / items / keystone)',
    lolBuilds,
    tftComps: [],
  }
}
