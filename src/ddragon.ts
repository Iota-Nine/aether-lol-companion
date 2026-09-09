/** Helpers Data Dragon partagés (items / sorts) */

export const DDRAGON_VERSION = '15.6.1'

const SPELL_BY_ID: Record<number, string> = {
  1: 'SummonerBoost',
  3: 'SummonerExhaust',
  4: 'SummonerFlash',
  6: 'SummonerHaste',
  7: 'SummonerHeal',
  11: 'SummonerSmite',
  12: 'SummonerTeleport',
  13: 'SummonerMana',
  14: 'SummonerDot',
  21: 'SummonerBarrier',
  32: 'SummonerSnowball',
  39: 'SummonerSnowURFSnowball_Mark',
  54: 'Summoner_UltBookPlaceholder',
  55: 'Summoner_UltBookSmitePlaceholder',
}

/** Noms Live Client EN + FR → clé Data Dragon */
const SPELL_BY_NAME: Record<string, string> = {
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
  exhaustion: 'SummonerExhaust',
  épuisement: 'SummonerExhaust',
  epuisement: 'SummonerExhaust',
  ghost: 'SummonerHaste',
  haste: 'SummonerHaste',
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
  dash: 'SummonerSnowball',
}

export function itemIconUrl(id: number, version = DDRAGON_VERSION): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`
}

export function spellIconUrl(key: string, version = DDRAGON_VERSION): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`
}

export function spellKeyFromId(id: number | null | undefined): string | null {
  if (id == null || id <= 0) return null
  return SPELL_BY_ID[id] ?? null
}

export function spellKeyFromName(name: string | null | undefined): string | null {
  if (!name) return null
  const n = name.trim().toLowerCase()
  if (SPELL_BY_NAME[n]) return SPELL_BY_NAME[n]
  // rawDisplayName style
  const m = name.match(/SummonerSpell_(Summoner[A-Za-z0-9]+)_/i)
  if (m?.[1]) return m[1]
  if (/^Summoner[A-Za-z0-9]+$/i.test(name)) return name
  return null
}

export function resolveSpellIcon(
  opts: { id?: number | null; name?: string | null; key?: string | null },
  version = DDRAGON_VERSION,
): string | null {
  const key = opts.key || spellKeyFromId(opts.id) || spellKeyFromName(opts.name)
  return key ? spellIconUrl(key, version) : null
}
