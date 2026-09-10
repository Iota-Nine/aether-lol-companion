import { getChampionById } from './champions.js'
import {
  matchupBlurb,
  normalizeLane,
  playTipsVs,
  suggestCounters,
  type CounterSuggestion,
} from './counters.js'
import type { LiveSession, PlayerCard } from './types.js'

export interface CoachTip {
  id: string
  priority: number
  kind: 'counter' | 'tactic' | 'objective' | 'endgame' | 'macro' | 'draft' | 'matchup'
  title: string
  body: string
  trigger?: string
}

export interface CoachCounterCard {
  enemyChampionId: number
  enemyChampionName: string
  enemyChampionImage: string | null
  lane: string
  suggestions: CounterSuggestion[]
  playTips: string[]
}

export interface CoachAdvice {
  mode: 'draft' | 'ingame' | 'idle'
  headline: string
  urgency: 'low' | 'mid' | 'high' | 'critical'
  tips: CoachTip[]
  counters: CoachCounterCard[]
  updatedAt: number
}

function laneLabel(lane: string): string {
  switch (normalizeLane(lane)) {
    case 'top':
      return 'TOP'
    case 'jungle':
      return 'JGL'
    case 'mid':
      return 'MID'
    case 'adc':
      return 'ADC'
    case 'support':
      return 'SUP'
    default:
      return 'LANE'
  }
}

function sameLane(a?: string | null, b?: string | null): boolean {
  const la = normalizeLane(a)
  const lb = normalizeLane(b)
  if (la === 'unknown' || lb === 'unknown') return false
  return la === lb
}

function youCard(live: LiveSession): PlayerCard | null {
  if (live.localPlayerCellId != null) {
    return live.players.find((p) => p.cellId === live.localPlayerCellId) || null
  }
  return live.allies[0] || null
}

function recentEvents(live: LiveSession, maxAgeSec = 90) {
  const ig = live.inGame
  if (!ig?.active) return []
  const now = ig.gameTime
  return (ig.events || []).filter((e) => now - e.time <= maxAgeSec)
}

function buildMacroTips(live: LiveSession): CoachTip[] {
  const ig = live.inGame
  if (!ig?.active) return []
  const tips: CoachTip[] = []
  const goldDiff = (ig.teamTotals.ally.gold || 0) - (ig.teamTotals.enemy.gold || 0)
  const t = ig.gameTime
  const events = recentEvents(live, 120)
  const last = events[0]
  const alliesAlive = live.allies.filter((p) => !p.live?.isDead).length
  const enemiesDead = live.enemies.filter((p) => p.live?.isDead).length
  const enemiesAlive = live.enemies.filter((p) => !p.live?.isDead).length
  const longEnemyRespawn = live.enemies
    .filter((p) => p.live?.isDead && (p.live.respawnTimer || 0) >= 20)
    .sort((a, b) => (b.live?.respawnTimer || 0) - (a.live?.respawnTimer || 0))[0]

  const inhibRecent = events.find((e) => e.name === 'InhibKilled')
  const baronRecent = events.find((e) => e.name === 'BaronKill')
  const dragonRecent = events.find((e) => e.name === 'DragonKill')
  const heraldRecent = events.find((e) => e.name === 'HeraldKill')
  const aceRecent = events.find((e) => e.name === 'Ace')
  const turretRecent = events.find((e) => e.name === 'TurretKilled')

  if (inhibRecent) {
    tips.push({
      id: `inhib-${inhibRecent.id}`,
      priority: 100,
      kind: 'endgame',
      title: 'INHIB DOWN',
      body:
        goldDiff >= 0
          ? 'Pousse la lane ouverte, force Nexus si 4+ morts ennemis ou Baron. Ne reset pas sans raison.'
          : 'Secure vision, freeze la wave open, attend un pick / Baron avant de suicide end.',
      trigger: inhibRecent.label,
    })
  }

  if (baronRecent) {
    const killerChamp = baronRecent.label.replace(/^BARON\s*·\s*/i, '').trim().toLowerCase()
    const weHaveBaron =
      live.allies.some((p) => (p.championName || '').toLowerCase() === killerChamp) ||
      (killerChamp === 'équipe' && goldDiff >= 0)
    tips.push({
      id: `baron-${baronRecent.id}`,
      priority: 95,
      kind: 'objective',
      title: weHaveBaron ? 'BARON: SIEGE' : 'BARON ENNEMI',
      body: weHaveBaron
        ? 'Group mid, push avec les sbires buff, force tours / inhib. Pas de split random.'
        : 'Clear waves, ne contest pas 5v5 mid. Trade side / vision, timeout 3 min.',
      trigger: baronRecent.label,
    })
  }

  if (dragonRecent) {
    const typeMatch = dragonRecent.label.match(/DRAGON\s+(\w+)/i)
    const dtype = (typeMatch?.[1] || '').toUpperCase()
    tips.push({
      id: `drake-${dragonRecent.id}`,
      priority: 78,
      kind: 'objective',
      title: dtype ? `DRAKE ${dtype}` : 'DRAGON',
      body:
        dtype.includes('ELDER')
          ? 'Elder: fight pour end. Reset items si besoin puis force.'
          : 'Reset propre, setup prochain objectif / Herald / tour. Ne chase pas trop loin.',
      trigger: dragonRecent.label,
    })
  }

  if (heraldRecent) {
    tips.push({
      id: `herald-${heraldRecent.id}`,
      priority: 72,
      kind: 'objective',
      title: 'HÉRAUT',
      body: 'Utilise-le sur une tour prioritaire (mid ou lane gagnée). Sync avec flash / wave.',
      trigger: heraldRecent.label,
    })
  }

  if (aceRecent || enemiesDead >= 3) {
    tips.push({
      id: `ace-${aceRecent?.id ?? enemiesDead}`,
      priority: 92,
      kind: 'endgame',
      title: enemiesDead >= 4 ? 'ACE WINDOW' : 'PICK WINDOW',
      body:
        t >= 25 * 60
          ? 'Push ouvert / Nexus. Ne farm pas jungle pendant les respawns longs.'
          : 'Prends tour + objectif (Drake/Baron/Herald). Convertis avant respawn.',
      trigger: aceRecent?.label || `${enemiesDead} morts ennemis`,
    })
  }

  if (longEnemyRespawn && goldDiff >= 1500) {
    tips.push({
      id: `respawn-${longEnemyRespawn.cellId}-${longEnemyRespawn.live?.respawnTimer}`,
      priority: 88,
      kind: 'tactic',
      title: `${longEnemyRespawn.championName || 'Ennemi'} mort ${Math.floor(longEnemyRespawn.live?.respawnTimer || 0)}s`,
      body: 'Force objectif ou tour maintenant. Ne free farm pas.',
    })
  }

  if (turretRecent && !inhibRecent) {
    tips.push({
      id: `turret-${turretRecent.id}`,
      priority: 55,
      kind: 'macro',
      title: 'TOUR DOWN',
      body:
        goldDiff >= 2000
          ? 'Ouvre la map: vision deep, invade, prepare Drake/Baron.'
          : 'Stabilise waves, trade plates / vision, pas de greedy dive.',
      trigger: turretRecent.label,
    })
  }

  // Gold / tempo
  if (goldDiff >= 4500) {
    tips.push({
      id: 'gold-stomp',
      priority: 70,
      kind: 'macro',
      title: `+${Math.round(goldDiff / 100) * 100} OR`,
      body: 'Force objectifs, pas de 1v1 inutiles. Siege mid, vision, end clean.',
    })
  } else if (goldDiff >= 2000) {
    tips.push({
      id: 'gold-ahead',
      priority: 58,
      kind: 'macro',
      title: `+${Math.round(goldDiff / 100) * 100} OR`,
      body: 'Joue pour Drake/Baron/tours. Trade propre, pas de throw solo.',
    })
  } else if (goldDiff <= -4500) {
    tips.push({
      id: 'gold-stomp-behind',
      priority: 70,
      kind: 'macro',
      title: `${Math.round(goldDiff / 100) * 100} OR`,
      body: 'Clear waves, stall, look pick isolé. Ne force pas Baron/Drake 5v5.',
    })
  } else if (goldDiff <= -2000) {
    tips.push({
      id: 'gold-behind',
      priority: 58,
      kind: 'macro',
      title: `${Math.round(goldDiff / 100) * 100} OR`,
      body: 'Défends, farm safe, vision defensive. Attend overextend ennemi.',
    })
  }

  // Phase tips
  if (t < 8 * 60 && !last) {
    tips.push({
      id: 'phase-early',
      priority: 20,
      kind: 'tactic',
      title: 'EARLY',
      body: 'Priorité: crash wave, track jungler, plates. Pas de death pour 1 creep.',
    })
  } else if (t >= 8 * 60 && t < 20 * 60) {
    tips.push({
      id: 'phase-mid',
      priority: 22,
      kind: 'tactic',
      title: 'MID GAME',
      body: 'Setup Drake/Herald, mid prio, roam sync. Ward river avant objectif.',
    })
  } else if (t >= 20 * 60 && t < 30 * 60) {
    tips.push({
      id: 'phase-baron',
      priority: 24,
      kind: 'tactic',
      title: 'BARON SETUP',
      body: 'Vision pit, wave mid avant contest. Ne start pas Baron sans vision / wave.',
    })
  } else if (t >= 30 * 60) {
    tips.push({
      id: 'phase-late',
      priority: 26,
      kind: 'endgame',
      title: 'LATE',
      body: '1 erreur = game. Group pour Elder/Baron, ne split pas sans TP.',
    })
  }

  if (alliesAlive <= 3 && enemiesAlive >= 4 && t > 15 * 60) {
    tips.push({
      id: 'numbers-down',
      priority: 80,
      kind: 'tactic',
      title: 'UNDERTOUR',
      body: 'Ne fight pas. Clear, stall, reset. Attend respawns.',
    })
  }

  // Win chance
  const allyWR = live.teamWinChance?.ally
  if (allyWR != null && allyWR >= 62 && goldDiff >= 0) {
    tips.push({
      id: 'wr-favor',
      priority: 30,
      kind: 'macro',
      title: `FAVOR ~${Math.round(allyWR)}%`,
      body: 'Joue pour objectifs, pas pour kills gratuits.',
    })
  } else if (allyWR != null && allyWR <= 38) {
    tips.push({
      id: 'wr-underdog',
      priority: 30,
      kind: 'macro',
      title: `UNDERDOG ~${Math.round(allyWR)}%`,
      body: 'Look picks, stall items, force erreur. Pas de open field 5v5.',
    })
  }

  return tips
}

async function buildCounterCards(live: LiveSession): Promise<CoachCounterCard[]> {
  const you = youCard(live)
  const bannedIds = [...(live.bans?.ally || []), ...(live.bans?.enemy || [])].map((b) => b.id)
  const allyIds = live.allies.map((p) => p.championId).filter((id): id is number => !!id && id > 0)
  const cards: CoachCounterCard[] = []

  const enemies = live.enemies.filter((e) => e.championId && e.championId > 0)
  // Prioritize same-lane enemy, then all
  const ordered = [...enemies].sort((a, b) => {
    const aSame = you && sameLane(you.assignedPosition, a.assignedPosition) ? 0 : 1
    const bSame = you && sameLane(you.assignedPosition, b.assignedPosition) ? 0 : 1
    return aSame - bSame
  })

  for (const enemy of ordered.slice(0, 3)) {
    const enemyId = enemy.championId!
    const info = await getChampionById(enemyId)
    const suggestions =
      you?.championId && you.championId > 0
        ? []
        : await suggestCounters({
            enemyChampionId: enemyId,
            enemyChampionKey: enemy.championKey,
            enemyChampionName: enemy.championName,
            lane: enemy.assignedPosition || you?.assignedPosition,
            bannedIds,
            allyIds,
            limit: 3,
          })

    const playTips = [
      ...playTipsVs(enemy.championKey || ''),
      ...playTipsVs(enemy.championName || ''),
    ]
    const uniqTips = [...new Set(playTips)]
    if (uniqTips.length === 0 && info) {
      const youInfo = you?.championId ? await getChampionById(you.championId) : null
      uniqTips.push(matchupBlurb(youInfo, info))
    }

    cards.push({
      enemyChampionId: enemyId,
      enemyChampionName: enemy.championName || info?.name || 'Ennemi',
      enemyChampionImage: enemy.championImage || info?.image || null,
      lane: laneLabel(enemy.assignedPosition || you?.assignedPosition || ''),
      suggestions,
      playTips: uniqTips.slice(0, 2),
    })
  }

  return cards
}

function draftTips(live: LiveSession, counters: CoachCounterCard[]): CoachTip[] {
  const tips: CoachTip[] = []
  const you = youCard(live)
  const laneEnemy = counters[0]
  if (!you?.championId && laneEnemy?.suggestions?.length) {
    const top = laneEnemy.suggestions[0]
    tips.push({
      id: `draft-counter-${laneEnemy.enemyChampionId}`,
      priority: 90,
      kind: 'counter',
      title: `COUNTER ${laneEnemy.lane}`,
      body: `Vs ${laneEnemy.enemyChampionName}: ${top.championName} (${top.reason}). Autres: ${laneEnemy.suggestions
        .slice(1)
        .map((s) => s.championName)
        .join(', ') || 'meta lane'}.`,
      trigger: laneEnemy.enemyChampionName,
    })
  } else if (you?.championId && laneEnemy) {
    tips.push({
      id: `draft-matchup-${laneEnemy.enemyChampionId}`,
      priority: 75,
      kind: 'matchup',
      title: `MATCHUP ${you.championName || 'TOI'} vs ${laneEnemy.enemyChampionName}`,
      body: laneEnemy.playTips[0] || `Joue propre vs ${laneEnemy.enemyChampionName} en ${laneEnemy.lane}.`,
      trigger: laneEnemy.enemyChampionName,
    })
  }

  for (const c of counters.slice(0, 2)) {
    if (c.playTips[1]) {
      tips.push({
        id: `matchup-extra-${c.enemyChampionId}`,
        priority: 40,
        kind: 'matchup',
        title: `VS ${c.enemyChampionName}`,
        body: c.playTips[1],
      })
    }
  }
  return tips
}

function pickHeadline(tips: CoachTip[]): { headline: string; urgency: CoachAdvice['urgency'] } {
  if (!tips.length) {
    return { headline: 'Coach en écoute…', urgency: 'low' }
  }
  const top = tips[0]
  const urgency: CoachAdvice['urgency'] =
    top.priority >= 90 ? 'critical' : top.priority >= 70 ? 'high' : top.priority >= 45 ? 'mid' : 'low'
  return {
    headline: `${top.title}: ${top.body}`,
    urgency,
  }
}

export async function buildCoachAdvice(live: LiveSession): Promise<CoachAdvice> {
  if (live.mode !== 'lol') {
    return {
      mode: 'idle',
      headline: 'Coach LoL actif en draft / in-game.',
      urgency: 'low',
      tips: [],
      counters: [],
      updatedAt: Date.now(),
    }
  }

  const inGame = Boolean(live.inGame?.active)
  const counters = await buildCounterCards(live)
  const tips: CoachTip[] = []

  if (inGame) {
    tips.push(...buildMacroTips(live))
    // keep matchup reminder lower priority
    const you = youCard(live)
    const laneEnemy = counters.find((c) =>
      you ? sameLane(you.assignedPosition, live.enemies.find((e) => e.championId === c.enemyChampionId)?.assignedPosition) : false,
    ) || counters[0]
    if (laneEnemy?.playTips[0]) {
      tips.push({
        id: `ingame-matchup-${laneEnemy.enemyChampionId}`,
        priority: 35,
        kind: 'matchup',
        title: `VS ${laneEnemy.enemyChampionName}`,
        body: laneEnemy.playTips[0],
      })
    }
  } else {
    tips.push(...draftTips(live, counters))
  }

  tips.sort((a, b) => b.priority - a.priority)
  const dedup: CoachTip[] = []
  const seen = new Set<string>()
  for (const tip of tips) {
    const key = tip.title
    if (seen.has(key)) continue
    seen.add(key)
    dedup.push(tip)
  }

  const top = dedup.slice(0, 6)
  const { headline, urgency } = pickHeadline(top)

  return {
    mode: inGame ? 'ingame' : 'draft',
    headline,
    urgency,
    tips: top,
    counters,
    updatedAt: Date.now(),
  }
}
