/** Client OP.GG - meta champions + builds (API publique + MCP officiel OP.GG). */

export type OpggLane = 'top' | 'jungle' | 'mid' | 'adc' | 'support'

export interface OpggChampStats {
  championId: number
  winRate: number
  pickRate: number
  banRate: number
  tier: string
  tierRank: number
  position: OpggLane | null
  play: number
  patch: string
}

export interface OpggBuild {
  championId: number
  championKey: string
  role: string
  winRate: number
  pickRate: number
  banRate: number
  tier: string
  coreItems: string[]
  boots: string
  keystone: string
  runePage: string
  spells: string[]
  skillOrder: string[]
  tip: string
  patch: string
  source: 'op.gg'
}

const CACHE_MS = 1000 * 60 * 45
const MCP_URL = 'https://mcp-api.op.gg/mcp'

type RankedRow = {
  id?: number
  average_stats?: {
    play?: number
    win_rate?: number
    pick_rate?: number
    ban_rate?: number
    tier?: number
    rank?: number
  }
  positions?: Array<{
    name?: string
    stats?: {
      play?: number
      win_rate?: number
      pick_rate?: number
      ban_rate?: number
      role_rate?: number
      kda?: number
      tier_data?: { tier?: number; rank?: number }
    }
  }>
}

let rankedCache: {
  at: number
  patch: string
  byId: Map<number, OpggChampStats>
  byLane: Map<OpggLane, OpggChampStats[]>
} | null = null
const buildCache = new Map<string, { at: number; build: OpggBuild }>()

const TIER_LABEL: Record<number, string> = {
  1: 'S',
  2: 'A',
  3: 'B',
  4: 'C',
  5: 'D',
}

const POS_MAP: Record<string, OpggLane> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'mid',
  MIDDLE: 'mid',
  ADC: 'adc',
  BOTTOM: 'adc',
  BOT: 'adc',
  SUPPORT: 'support',
  UTILITY: 'support',
  SUP: 'support',
}

function pct(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0
  const n = v <= 1 ? v * 100 : v
  return Number(n.toFixed(1))
}

function tierLabel(tier: number | null | undefined): string {
  if (!tier) return '-'
  return TIER_LABEL[tier] ?? String(tier)
}

export function toOpggChampionName(keyOrName: string): string {
  const raw = keyOrName.trim()
  if (!raw) return raw
  if (raw.includes('_') && raw === raw.toUpperCase()) return raw
  // LeeSin -> LEE_SIN, MissFortune -> MISS_FORTUNE, JarvanIV -> JARVAN_IV
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase()
}

export function normalizeLane(pos?: string | null): OpggLane {
  if (!pos) return 'mid'
  const key = pos.toUpperCase().replace(/\s+/g, '_')
  return POS_MAP[key] ?? 'mid'
}

function bestPosition(positions: Array<{ name?: string; stats?: { role_rate?: number } }> | undefined): OpggLane | null {
  if (!positions?.length) return null
  const sorted = [...positions].sort(
    (a, b) => (b.stats?.role_rate ?? 0) - (a.stats?.role_rate ?? 0),
  )
  return normalizeLane(sorted[0]?.name)
}

export async function fetchOpggRankedMeta(region = 'euw'): Promise<{
  patch: string
  byId: Map<number, OpggChampStats>
  byLane: Map<OpggLane, OpggChampStats[]>
}> {
  if (rankedCache && Date.now() - rankedCache.at < CACHE_MS) {
    return { patch: rankedCache.patch, byId: rankedCache.byId, byLane: rankedCache.byLane }
  }

  const regions = [region.toLowerCase(), 'euw', 'kr', 'global']
  let payload: { data?: RankedRow[]; meta?: { version?: string } } | null = null

  for (const reg of [...new Set(regions)]) {
    try {
      const res = await fetch(`https://lol-api-champion.op.gg/api/${reg}/champions/ranked`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AETHER-LoL-Companion/1.0',
          Referer: 'https://www.op.gg/',
        },
      })
      if (!res.ok) continue
      payload = (await res.json()) as typeof payload
      if (payload?.data?.length) break
    } catch {
      // try next region
    }
  }

  const byId = new Map<number, OpggChampStats>()
  const byLane = new Map<OpggLane, OpggChampStats[]>([
    ['top', []],
    ['jungle', []],
    ['mid', []],
    ['adc', []],
    ['support', []],
  ])
  const patch = payload?.meta?.version || '-'

  for (const row of payload?.data ?? []) {
    const id = row.id
    if (!id) continue
    const s = row.average_stats
    byId.set(id, {
      championId: id,
      winRate: pct(s?.win_rate),
      pickRate: pct(s?.pick_rate),
      banRate: pct(s?.ban_rate),
      tier: tierLabel(s?.tier),
      tierRank: s?.rank ?? 0,
      position: bestPosition(row.positions),
      play: s?.play ?? 0,
      patch,
    })

    for (const pos of row.positions ?? []) {
      const lane = normalizeLane(pos.name)
      const ps = pos.stats
      if (!ps) continue
      // Ignore micro-sample / of-meta roles
      if ((ps.role_rate ?? 0) < 0.05 && (ps.play ?? 0) < 500) continue
      byLane.get(lane)?.push({
        championId: id,
        winRate: pct(ps.win_rate),
        pickRate: pct(ps.pick_rate),
        banRate: pct(ps.ban_rate),
        tier: tierLabel(ps.tier_data?.tier),
        tierRank: ps.tier_data?.rank ?? 999,
        position: lane,
        play: ps.play ?? 0,
        patch,
      })
    }
  }

  for (const lane of byLane.keys()) {
    const list = byLane.get(lane) || []
    list.sort((a, b) => {
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank
      return b.winRate - a.winRate
    })
    byLane.set(lane, list)
  }

  rankedCache = { at: Date.now(), patch, byId, byLane }
  return { patch, byId, byLane }
}

/** Top N meta OP.GG pour une lane (tri tier rank). */
export async function fetchOpggLaneTop(
  lane: OpggLane,
  limit = 7,
  region = 'euw',
): Promise<{ patch: string; champs: OpggChampStats[] }> {
  const meta = await fetchOpggRankedMeta(region)
  return {
    patch: meta.patch,
    champs: (meta.byLane.get(lane) || []).slice(0, limit),
  }
}

let mcpSession: string | null = null

async function mcpRpc(body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (mcpSession) headers['mcp-session-id'] = mcpSession

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) mcpSession = sid

  if (res.status === 202 || res.status === 204) return null
  const text = await res.text()
  if (!text.trim()) return null
  if (text.trim().startsWith('{')) return JSON.parse(text)
  const lines = text.split('\n').filter((l) => l.startsWith('data:'))
  const last = lines.at(-1)?.replace(/^data:\s*/, '')
  if (!last) {
    // notifications can return empty / non-json
    if (String(body.method || '').startsWith('notifications/')) return null
    throw new Error('Réponse MCP OP.GG invalide')
  }
  return JSON.parse(last)
}

async function ensureMcp(): Promise<void> {
  if (mcpSession) return
  await mcpRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'aether-lol-companion', version: '1.0.1' },
    },
  })
  await mcpRpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
}

function parseQuotedList(block: string): string[] {
  const out: string[] = []
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) out.push(m[1]!.replace(/\\"/g, '"'))
  return out
}

function parseOpggAnalysisText(text: string): {
  winRate: number
  pickRate: number
  banRate: number
  tier: string
  coreItems: string[]
  boots: string
  keystone: string
  runePage: string
  spells: string[]
  skillOrder: string[]
} {
  const avg = text.match(
    /AverageStats\((\d+),([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+),(\d+),(\d+)\)/,
  )
  const winRate = pct(avg ? Number(avg[2]) : 0)
  const pickRate = pct(avg ? Number(avg[3]) : 0)
  const banRate = pct(avg ? Number(avg[4]) : 0)
  const tier = tierLabel(avg ? Number(avg[6]) : null)

  const coreBlocks = [...text.matchAll(/CoreItems\(\[([^\]]*)\]/g)].map((m) => m[1] || '')
  const coreItems = coreBlocks[0] ? parseQuotedList(coreBlocks[0]) : []
  const bootsList = coreBlocks[1] ? parseQuotedList(coreBlocks[1]) : []
  const bootsMatch = text.match(/Boots\(\[([^\]]*)\]/)
  const boots = bootsMatch
    ? parseQuotedList(bootsMatch[1] || '')[0] || '-'
    : bootsList[0] || '-'

  const runes = text.match(/Runes\("([^"]+)",\[([^\]]*)\]/)
  const runeNames = runes ? parseQuotedList(`[${runes[2]}]`) : []
  const keystone = runeNames[0] || '-'
  const runePage = runes?.[1] || '-'

  const spellsMatch = text.match(/SummonerSpells\(\[([^\]]*)\]/)
  // spells may be ids; names preferred if present as strings
  const spellsRaw = spellsMatch ? parseQuotedList(`[${spellsMatch[1]}]`) : []
  const spells = spellsRaw.length
    ? spellsRaw
    : (spellsMatch?.[1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  const skills = text.match(/Skills\(\[([^\]]*)\]/)
  const skillOrder = skills
    ? parseQuotedList(`[${skills[1]}]`).length
      ? parseQuotedList(`[${skills[1]}]`)
      : (skills[1] || '')
          .split(',')
          .map((s) => s.replace(/"/g, '').trim())
          .filter(Boolean)
    : []

  return { winRate, pickRate, banRate, tier, coreItems, boots, keystone, runePage, spells, skillOrder }
}

export async function fetchOpggBuild(params: {
  championKey: string
  championId: number
  position?: string | null
  region?: string
}): Promise<OpggBuild | null> {
  const lane = normalizeLane(params.position)
  const champ = toOpggChampionName(params.championKey)
  const cacheKey = `${champ}:${lane}`
  const hit = buildCache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.build

  const meta = await fetchOpggRankedMeta(params.region || 'euw')
  const ranked = meta.byId.get(params.championId)

  try {
    await ensureMcp()
    const response = (await mcpRpc({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'lol_get_champion_analysis',
        arguments: {
          champion: champ,
          game_mode: 'ranked',
          lang: 'en_US',
          position: lane,
          tier: 'platinum_plus',
          desired_output_fields: [
            'champion',
            'position',
            'data.summary.average_stats.{win_rate,pick_rate,ban_rate,tier,rank,play,kda}',
            'data.core_items.{ids_names[],pick_rate,play,win}',
            'data.boots.{ids_names[],pick_rate,play,win}',
            'data.runes.{primary_page_name,primary_rune_names[],secondary_page_name,pick_rate}',
            'data.summoner_spells.{ids_names[],pick_rate}',
            'data.skills.{order[],pick_rate}',
          ],
        },
      },
    })) as {
      result?: { content?: Array<{ text?: string }> }
      error?: { message?: string }
    }

    if (response.error) throw new Error(response.error.message || 'MCP error')
    const text = response.result?.content?.[0]?.text || ''
    if (!text) throw new Error('Build OP.GG vide')

    const parsed = parseOpggAnalysisText(text)
    const build: OpggBuild = {
      championId: params.championId,
      championKey: params.championKey,
      role: lane.toUpperCase(),
      winRate: parsed.winRate || ranked?.winRate || 0,
      pickRate: parsed.pickRate || ranked?.pickRate || 0,
      banRate: parsed.banRate || ranked?.banRate || 0,
      tier: parsed.tier !== '-' ? parsed.tier : ranked?.tier || '-',
      coreItems: parsed.coreItems.slice(0, 4),
      boots: parsed.boots,
      keystone: parsed.keystone,
      runePage: parsed.runePage,
      spells: parsed.spells.slice(0, 2),
      skillOrder: parsed.skillOrder.slice(0, 6),
      tip: `Source OP.GG patch ${meta.patch} · ${lane.toUpperCase()} · Platinum+`,
      patch: meta.patch,
      source: 'op.gg',
    }
    buildCache.set(cacheKey, { at: Date.now(), build })
    return build
  } catch (e) {
    console.warn('[aether] OP.GG build:', champ, e)
    if (!ranked) return null
    const build: OpggBuild = {
      championId: params.championId,
      championKey: params.championKey,
      role: (ranked.position || lane).toUpperCase(),
      winRate: ranked.winRate,
      pickRate: ranked.pickRate,
      banRate: ranked.banRate,
      tier: ranked.tier,
      coreItems: [],
      boots: '-',
      keystone: '-',
      runePage: '-',
      spells: [],
      skillOrder: [],
      tip: `WR/PR OP.GG patch ${meta.patch} (build détaillé indisponible)`,
      patch: meta.patch,
      source: 'op.gg',
    }
    buildCache.set(cacheKey, { at: Date.now(), build })
    return build
  }
}
