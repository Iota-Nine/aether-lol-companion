import type { LiveSession } from './types'

export async function fetchLive(): Promise<LiveSession> {
  const res = await fetch('/api/live')
  if (!res.ok) throw new Error('Impossible de charger la session live')
  return res.json()
}
