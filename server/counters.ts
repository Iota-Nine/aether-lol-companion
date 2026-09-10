import { getAllChampions, getChampionById } from './champions.js'
import type { ChampionInfo } from './types.js'

export type LaneKey = 'top' | 'jungle' | 'mid' | 'adc' | 'support' | 'unknown'

const LANE_ALIASES: Record<string, LaneKey> = {
  top: 'top',
  toplane: 'top',
  jungle: 'jungle',
  jng: 'jungle',
  mid: 'mid',
  middle: 'mid',
  midlane: 'mid',
  adc: 'adc',
  bottom: 'adc',
  bot: 'adc',
  utility: 'support',
  support: 'support',
  supp: 'support',
}

/** Counters connus (clés Data Dragon) : bons picks vs le champ ennemi. */
const HARD_COUNTERS: Record<string, string[]> = {
  darius: ['quinn', 'vayne', 'gnar', 'kennen', 'urgot'],
  garen: ['vayne', 'teemo', 'quinn', 'yorick'],
  illaoi: ['ornn', 'kennen', 'quinn', 'jayce'],
  aatrox: ['fiora', 'jax', 'renekton', 'gwen'],
  renekton: ['quinn', 'kennen', 'vayne', 'gnar'],
  camille: ['malphite', 'poppy', 'quinn', 'kennen'],
  fiora: ['malphite', 'poppy', 'kennen', 'quinn'],
  jax: ['malphite', 'kennen', 'quinn', 'singed'],
  riven: ['renekton', 'kennen', 'malphite', 'poppy'],
  irelia: ['renekton', 'volibear', 'poppy', 'malphite'],
  sett: ['vayne', 'quinn', 'kennen', 'ornn'],
  mordekaiser: ['vayne', 'fiora', 'gwen', 'urgot'],
  nasus: ['vayne', 'riven', 'renekton', 'gwen'],
  sion: ['fiora', 'vayne', 'gwen', 'yorick'],
  ornn: ['fiora', 'gwen', 'vayne', 'camille'],
  malphite: ['mordekaiser', 'sylas', 'vladimir', 'chogath'],
  kayn: ['leesin', 'kindred', 'reksai', 'jarvaniv'],
  leesin: ['reksai', 'nidalee', 'kindred', 'graves'],
  masteryi: ['rell', 'poppy', 'rammus', 'udyr'],
  belveth: ['kindred', 'nidalee', 'graves', 'ivern'],
  khazix: ['reksai', 'kindred', 'ivern', 'rammus'],
  evelynn: ['ivern', 'rell', 'kindred', 'nunu'],
  zed: ['malzahar', 'lissandra', 'sylas', 'vex'],
  yasuo: ['renekton', 'malzahar', 'annie', 'lissandra'],
  yone: ['malzahar', 'annie', 'lissandra', 'renekton'],
  akali: ['malzahar', 'galio', 'lissandra', 'vex'],
  katarina: ['malzahar', 'galio', 'vex', 'annie'],
  fizz: ['malzahar', 'lissandra', 'galio', 'vex'],
  leblanc: ['galio', 'malzahar', 'vex', 'sylas'],
  sylas: ['galio', 'malzahar', 'vex', 'annie'],
  ahri: ['fizz', 'yasuo', 'zed', 'galio'],
  syndra: ['fizz', 'zed', 'yasuo', 'talon'],
  orianna: ['zed', 'fizz', 'yasuo', 'talon'],
  viktor: ['zed', 'fizz', 'yasuo', 'talon'],
  lux: ['zed', 'fizz', 'yasuo', 'talon'],
  veigar: ['zed', 'fizz', 'talon', 'kassadin'],
  twitch: ['caitlyn', 'draven', 'nilah', 'ashe'],
  jinx: ['draven', 'caitlyn', 'nilah', 'kalista'],
  kaisa: ['caitlyn', 'draven', 'ashe', 'xayah'],
  ezreal: ['draven', 'caitlyn', 'nilah', 'lucian'],
  vayne: ['caitlyn', 'draven', 'ashe', 'nilah'],
  samira: ['caitlyn', 'ashe', 'jhin', 'xayah'],
  lucian: ['caitlyn', 'draven', 'ashe', 'jhin'],
  zeri: ['caitlyn', 'draven', 'ashe', 'nilah'],
  thresh: ['morgana', 'renata', 'brand', 'zyra'],
  nautilus: ['morgana', 'renata', 'janna', 'lulu'],
  blitzcrank: ['morgana', 'renata', 'janna', 'lulu'],
  pyke: ['morgana', 'soraka', 'janna', 'lulu'],
  leona: ['morgana', 'janna', 'lulu', 'renata'],
  alistar: ['morgana', 'janna', 'lulu', 'renata'],
  rakan: ['morgana', 'brand', 'zyra', 'xerath'],
  nami: ['blitzcrank', 'pyke', 'thresh', 'nautilus'],
  lulu: ['blitzcrank', 'pyke', 'brand', 'zyra'],
  yuumi: ['blitzcrank', 'pyke', 'brand', 'zyra'],
  brand: ['nami', 'janna', 'lulu', 'soraka'],
  zyra: ['nami', 'janna', 'lulu', 'soraka'],
}

/** Conseils de lane vs archétype / champ (quand tu as déjà pick). */
const PLAY_VS: Record<string, string[]> = {
  darius: ['Respecte le pull Q. Trade court hors E.', 'All-in après 6 seulement avec flash up.'],
  illaoi: ['Ne teamfight pas dans ses tentacules. Push et rotate.'],
  sett: ['Évite son W chargé. Side angle pour kiter.'],
  aatrox: ['Short trades hors Q2/Q3. All-in quand Q CD.'],
  zed: ['Save un spell pour sa R. Malzahar/Zhonya = hard stop.'],
  yasuo: ['Ne stack pas de windwall sur toi. Engage hors dash.'],
  yone: ['Respecte E2. Trade quand il est sans E.'],
  akali: ['Vision shroud. Force fights hors énergie.'],
  katarina: ['Spread. Ne clump pas pour sa R.'],
  masteryi: ['CC hard + burst. Ne 1v1 pas late sans CC.'],
  yi: ['CC hard + burst. Ne 1v1 pas late sans CC.'],
  kayn: ['Track transform. Ward river tôt.'],
  khazix: ['Group mid-late. Ward isolations.'],
  evelynn: ['Pink / Control wards. Ne push pas sans vision.'],
  thresh: ['Respecte hook. Stand derrière minions.'],
  blitzcrank: ['Max range. Ne walk pas dans le bush blind.'],
  nautilus: ['Respecte root R. Position offset.'],
  pyke: ['Ne low HP pas près de lui. Vision river.'],
  jinx: ['All-in early avant stacks. Dive post-6 avec CC.'],
  kaisa: ['Punish avant evolve. Force fights courts.'],
  vayne: ['Burst early. Ne kite pas trop long.'],
  twitch: ['Sweep bushes. Force objectives hors stealth.'],
  malphite: ['Side shove. Ne group pas pour sa R.'],
  amumu: ['Spread. Pink pour engage.'],
  ornn: ['Ne siege pas trop long. Conteste son upgrade.'],
  sion: ['Timeout son passive. Ne overstay pas.'],
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function normalizeLane(raw?: string | null): LaneKey {
  if (!raw) return 'unknown'
  const k = raw.toLowerCase().replace(/[^a-z]/g, '')
  return LANE_ALIASES[k] || 'unknown'
}

function tagScore(enemy: ChampionInfo, candidate: ChampionInfo): number {
  const e = new Set(enemy.tags)
  const c = new Set(candidate.tags)
  let score = 0
  // Assassin / diver → tanks & peel / hard CC mages
  if (e.has('Assassin')) {
    if (c.has('Tank')) score += 3
    if (c.has('Mage')) score += 2
    if (c.has('Support')) score += 1
  }
  // Marksman → dive / assassins / engage
  if (e.has('Marksman')) {
    if (c.has('Assassin')) score += 3
    if (c.has('Fighter')) score += 2
  }
  // Mage poke → assassins / engage
  if (e.has('Mage') && !e.has('Tank')) {
    if (c.has('Assassin')) score += 3
    if (c.has('Fighter')) score += 1
  }
  // Tank → %HP / true dmg fighters & mages
  if (e.has('Tank')) {
    if (c.has('Fighter')) score += 2
    if (c.has('Mage')) score += 2
    if (c.has('Marksman')) score += 1
  }
  // Fighter bruiser → ranged / kiting
  if (e.has('Fighter') && !e.has('Tank')) {
    if (c.has('Marksman')) score += 3
    if (c.has('Mage')) score += 2
  }
  // Support engage → enchanteurs / disengage
  if (e.has('Support') && (e.has('Tank') || e.has('Fighter'))) {
    if (c.has('Mage')) score += 2
    if (c.has('Support') && c.has('Mage')) score += 1
  }
  return score
}

function tierRank(tier: string): number {
  const t = (tier || '-').toUpperCase()
  if (t.startsWith('OP') || t === 'S+') return 6
  if (t === 'S' || t.startsWith('1')) return 5
  if (t === 'A' || t.startsWith('2')) return 4
  if (t === 'B' || t.startsWith('3')) return 3
  if (t === 'C' || t.startsWith('4')) return 2
  if (t === 'D' || t.startsWith('5')) return 1
  return 0
}

export interface CounterSuggestion {
  championId: number
  championName: string
  championImage: string | null
  reason: string
  score: number
}

export async function suggestCounters(params: {
  enemyChampionId: number
  enemyChampionKey?: string | null
  enemyChampionName?: string | null
  lane?: string | null
  bannedIds?: number[]
  allyIds?: number[]
  limit?: number
}): Promise<CounterSuggestion[]> {
  const all = await getAllChampions()
  const enemy =
    (await getChampionById(params.enemyChampionId)) ||
    all.find((c) => c.key.toLowerCase() === (params.enemyChampionKey || '').toLowerCase()) ||
    null
  if (!enemy) return []

  const banned = new Set(params.bannedIds || [])
  const taken = new Set(params.allyIds || [])
  const hard = new Set(
    (HARD_COUNTERS[normalizeKey(enemy.key)] || []).map((k) => normalizeKey(k)),
  )

  const scored: CounterSuggestion[] = []
  for (const c of all) {
    if (c.id === enemy.id) continue
    if (banned.has(c.id) || taken.has(c.id)) continue
    const keyNorm = normalizeKey(c.key)
    let score = tagScore(enemy, c)
    let reason = `Bon profil vs ${enemy.tags.join('/') || enemy.name}`
    if (hard.has(keyNorm)) {
      score += 8
      reason = `Counter classique de ${enemy.name}`
    }
    score += tierRank(c.tier) * 0.6
    if (c.winRate > 51) score += (c.winRate - 50) * 0.15
    if (score < 2.5) continue
    scored.push({
      championId: c.id,
      championName: c.name,
      championImage: c.image,
      reason,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score || b.championName.localeCompare(a.championName, 'fr'))
  return scored.slice(0, params.limit ?? 3)
}

export function playTipsVs(enemyKeyOrName: string | null | undefined): string[] {
  if (!enemyKeyOrName) return []
  const k = normalizeKey(enemyKeyOrName)
  return PLAY_VS[k] || []
}

export function matchupBlurb(you: ChampionInfo | null, enemy: ChampionInfo): string {
  const tips = playTipsVs(enemy.key) || playTipsVs(enemy.name)
  if (tips[0]) return tips[0]
  const e = new Set(enemy.tags)
  if (e.has('Assassin')) return `Vs ${enemy.name}: garde un spell défensif, vision, ne overextend pas solo.`
  if (e.has('Marksman')) return `Vs ${enemy.name}: engage / dive avec CC, ne la laisse pas free hit.`
  if (e.has('Tank')) return `Vs ${enemy.name}: %HP / poke, timeout ses CDs, side plutôt que force.`
  if (e.has('Mage')) return `Vs ${enemy.name}: gapclose hors CD, respect le poke, roam si freeze.`
  if (e.has('Fighter')) return `Vs ${enemy.name}: short trades, kite, all-in seulement avec avantage.`
  return `Vs ${enemy.name}: joue propre, track CDs et vision.`
}
