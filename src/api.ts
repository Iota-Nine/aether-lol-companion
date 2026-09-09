import type { LiveSession, MetaGuides } from './types'

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
