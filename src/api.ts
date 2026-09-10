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
  if (!res.ok) throw new Error('Impossible de charger la meta')
  return res.json()
}

export async function fetchProfile(): Promise<ProfileHome> {
  const res = await fetch('/api/profile')
  if (!res.ok) throw new Error('Impossible de charger le profil')
  return res.json()
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    /* ignore */
  }
  return fallback
}

export async function fetchMatchDebrief(gameId: number): Promise<MatchDebrief> {
  const res = await fetch(`/api/match/${gameId}/debrief`)
  if (!res.ok) {
    throw new Error(await readApiError(res, `Debrief impossible (HTTP ${res.status})`))
  }
  return res.json()
}

export async function fetchLatestDebrief(): Promise<MatchDebrief> {
  const res = await fetch('/api/debrief/latest')
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Aucun debrief disponible'))
  }
  return res.json()
}
