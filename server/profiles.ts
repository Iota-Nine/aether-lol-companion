function encodeRiotId(gameName: string, tagLine: string): string {
  const name = encodeURIComponent(gameName.trim())
  const tag = encodeURIComponent(tagLine.trim())
  return `${name}-${tag}`
}

/** Normalise une région LCU / Riot vers les slugs sites tiers */
export function normalizeRegion(raw?: string | null): string {
  const value = (raw ?? 'euw').toLowerCase()
  const map: Record<string, string> = {
    euw1: 'euw',
    euw: 'euw',
    eun1: 'eune',
    eune: 'eune',
    na1: 'na',
    na: 'na',
    kr: 'kr',
    jp1: 'jp',
    jp: 'jp',
    br1: 'br',
    br: 'br',
    la1: 'lan',
    la2: 'las',
    oc1: 'oce',
    oce: 'oce',
    tr1: 'tr',
    tr: 'tr',
    ru: 'ru',
    ph2: 'ph',
    sg2: 'sg',
    th2: 'th',
    tw2: 'tw',
    vn2: 'vn',
  }
  return map[value] ?? 'euw'
}

export function buildProfileLinks(
  gameName: string,
  tagLine: string,
  region: string,
  mode: 'lol' | 'tft' = 'lol',
): { opgg: string; porofessor: string; uigg: string; lolchess: string } {
  const slug = encodeRiotId(gameName || 'Inconnu', tagLine || 'EUW')
  const reg = normalizeRegion(region)

  if (mode === 'tft') {
    return {
      opgg: `https://tft.op.gg/summoners/${reg}/${slug}`,
      porofessor: `https://porofessor.gg/fr/live/${reg}/${slug}`,
      uigg: `https://u.gg/tft/profile/${reg}/${slug}`,
      lolchess: `https://lolchess.gg/profile/${reg}/${gameName.trim()}-${tagLine.trim()}`,
    }
  }

  return {
    opgg: `https://www.op.gg/summoners/${reg}/${slug}`,
    porofessor: `https://porofessor.gg/fr/live/${reg}/${slug}`,
    uigg: `https://u.gg/lol/profile/${reg}/${slug}/overview`,
    lolchess: `https://lolchess.gg/profile/${reg}/${gameName.trim()}-${tagLine.trim()}`,
  }
}

export const TFT_QUEUE_IDS = new Set([
  1090, // TFT Normal
  1100, // TFT Ranked
  1110, // TFT Tutorial?
  1130, // Hyper Roll
  1160, // Double Up
  1170, // Double Up Ranked
  1180,
  1190,
  1210,
])

export function queueLabel(queueId?: number | null, gameMode?: string | null): string {
  if (gameMode?.toUpperCase() === 'TFT' || (queueId != null && TFT_QUEUE_IDS.has(queueId))) {
    switch (queueId) {
      case 1100:
        return 'TFT Ranked'
      case 1130:
        return 'TFT Hyper Roll'
      case 1160:
      case 1170:
        return 'TFT Double Up'
      case 1090:
        return 'TFT Normal'
      default:
        return 'TFT'
    }
  }
  switch (queueId) {
    case 420:
      return 'Ranked Solo/Duo'
    case 440:
      return 'Ranked Flex'
    case 450:
      return 'ARAM'
    case 400:
      return 'Normal Draft'
    case 430:
      return 'Normal Blind'
    default:
      return gameMode || 'LoL'
  }
}

export function isTftQueue(queueId?: number | null, gameMode?: string | null): boolean {
  if (gameMode && gameMode.toUpperCase() === 'TFT') return true
  if (queueId != null && TFT_QUEUE_IDS.has(queueId)) return true
  return false
}
