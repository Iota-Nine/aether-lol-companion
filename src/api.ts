import type { LiveSession, MetaGuides, ProfileHome, MatchDebrief } from './types'

export async function fetchLive(): Promise<LiveSession> {
  const res = await fetch('/api/live')
  if (!res.ok) throw new Error('Impossible de charger la session live')
  return res.json()
}

export async function fetchLaneMeta(
  lane: 'top' | 'jungle' | 'mid' | 'adc' | 'support',
  limit = 7,
): Promise<MetaGuides> {
  const res = await fetch(`/api/meta/lane/${lane}?limit=${limit}`)
  if (!res.ok) throw new Error('Impossible de charger la meta OP.GG')
  return res.json()
}

export async function fetchProfile(): Promise<ProfileHome> {
  const res = await fetch('/api/profile')
  if (!res.ok) throw new Error('Impossible de charger le profil')
  return res.json()
}

export async function fetchMatchDebrief(gameId: number): Promise<MatchDebrief> {
  const res = await fetch(`/api/match/${gameId}/debrief`)
  if (!res.ok) throw new Error('Impossible de charger le debrief')
  return res.json()
}

export async function fetchLatestDebrief(): Promise<MatchDebrief> {
  const res = await fetch('/api/debrief/latest')
  if (!res.ok) throw new Error('Aucun debrief disponible')
  return res.json()
}
