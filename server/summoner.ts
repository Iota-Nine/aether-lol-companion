import { lcuGet } from './lcu.js'
import type { LockfileData } from './types.js'

export interface CurrentSummoner {
  gameName: string
  tagLine: string
  displayName?: string
  puuid: string | null
  profileIconId: number
  summonerLevel: number
  summonerId?: number | null
}

type RawSummoner = {
  gameName?: string
  tagLine?: string
  displayName?: string
  puuid?: string
  profileIconId?: number
  summonerLevel?: number
  summonerId?: number
}

type ChatMe = {
  puuid?: string
  gameName?: string
  gameTag?: string
  name?: string
  icon?: number
  lol?: {
    rankedLeagueTier?: string
    rankedLeagueDivision?: string
  }
}

function splitDisplayName(display?: string | null): { gameName?: string; tagLine?: string } {
  if (!display || !display.includes('#')) return {}
  const [gameName, tagLine] = display.split('#')
  return { gameName: gameName || undefined, tagLine: tagLine || undefined }
}

function normalize(raw: RawSummoner | null | undefined): CurrentSummoner | null {
  if (!raw) return null
  const fromDisplay = splitDisplayName(raw.displayName)
  const gameName = raw.gameName || fromDisplay.gameName
  if (!gameName) return null
  return {
    gameName,
    tagLine: raw.tagLine || fromDisplay.tagLine || 'EUW',
    displayName: raw.displayName,
    puuid: raw.puuid || null,
    profileIconId: raw.profileIconId || 29,
    summonerLevel: raw.summonerLevel || 0,
    summonerId: raw.summonerId ?? null,
  }
}

async function fromChat(lockfile: LockfileData): Promise<CurrentSummoner | null> {
  const me = await lcuGet<ChatMe>(lockfile, '/lol-chat/v1/me', 4000)
  if (!me) return null
  const gameName = me.gameName || me.name
  if (!gameName && !me.puuid) return null
  return {
    gameName: gameName || 'Invocateur',
    tagLine: me.gameTag || 'EUW',
    puuid: me.puuid || null,
    profileIconId: me.icon || 29,
    summonerLevel: 0,
  }
}

async function fromAccountIds(lockfile: LockfileData): Promise<CurrentSummoner | null> {
  const ids = await lcuGet<{ summonerId?: number; puuid?: string }>(
    lockfile,
    '/lol-summoner/v1/current-summoner/account-and-summoner-ids',
    4000,
  )
  if (!ids) return null
  if (ids.puuid) {
    const byPuuid =
      (await lcuGet<RawSummoner>(lockfile, `/lol-summoner/v1/summoners/puuid/${ids.puuid}`, 4000)) ||
      (await lcuGet<RawSummoner>(lockfile, `/lol-summoner/v2/summoners/puuid/${ids.puuid}`, 4000))
    const n = normalize(byPuuid)
    if (n) return { ...n, puuid: n.puuid || ids.puuid }
    return {
      gameName: 'Invocateur',
      tagLine: 'EUW',
      puuid: ids.puuid,
      profileIconId: 29,
      summonerLevel: 0,
      summonerId: ids.summonerId ?? null,
    }
  }
  if (ids.summonerId) {
    const byId = await lcuGet<RawSummoner>(lockfile, `/lol-summoner/v1/summoners/${ids.summonerId}`, 4000)
    return normalize(byId)
  }
  return null
}

async function fromLobby(lockfile: LockfileData): Promise<CurrentSummoner | null> {
  const lobby = await lcuGet<{
    localMember?: {
      puuid?: string
      summonerId?: number
      gameName?: string
      tagLine?: string
      summonerName?: string
      riotId?: string
      riotIdGameName?: string
      riotIdTagLine?: string
    }
  }>(lockfile, '/lol-lobby/v2/lobby', 4000)
  const m = lobby?.localMember
  if (!m) return null
  const fromRiot = splitDisplayName(m.riotId)
  const gameName = m.riotIdGameName || m.gameName || fromRiot.gameName || m.summonerName
  if (!gameName && !m.puuid) return null
  return {
    gameName: gameName || 'Invocateur',
    tagLine: m.riotIdTagLine || m.tagLine || fromRiot.tagLine || 'EUW',
    puuid: m.puuid || null,
    profileIconId: 29,
    summonerLevel: 0,
    summonerId: m.summonerId ?? null,
  }
}

function merge(base: CurrentSummoner | null, extra: CurrentSummoner | null): CurrentSummoner | null {
  if (!base) return extra
  if (!extra) return base
  return {
    gameName: base.gameName !== 'Invocateur' ? base.gameName : extra.gameName,
    tagLine: base.tagLine && base.tagLine !== 'EUW' ? base.tagLine : extra.tagLine || base.tagLine,
    displayName: base.displayName || extra.displayName,
    puuid: base.puuid || extra.puuid,
    profileIconId: base.profileIconId || extra.profileIconId,
    summonerLevel: base.summonerLevel || extra.summonerLevel,
    summonerId: base.summonerId ?? extra.summonerId ?? null,
  }
}

/** Résout l’invocateur local avec plusieurs endpoints LCU (puuid souvent manquant / flaky). */
export async function resolveCurrentSummoner(lockfile: LockfileData): Promise<CurrentSummoner | null> {
  const primary = normalize(
    await lcuGet<RawSummoner>(lockfile, '/lol-summoner/v1/current-summoner', 4000),
  )
  if (primary?.puuid && primary.gameName !== 'Invocateur') return primary

  let out = primary
  out = merge(out, await fromChat(lockfile))
  if (out?.puuid && out.gameName !== 'Invocateur') return out

  out = merge(out, await fromAccountIds(lockfile))
  if (out?.puuid) return out

  out = merge(out, await fromLobby(lockfile))
  return out
}
