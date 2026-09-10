import type { LiveSession, MetaGuides, ProfileHome, MatchDebrief } from './types'

/** En Electron, tape toujours l’API locale (évite Failed to fetch si le proxy Vite / timing foire). */
function apiBase(): string {
  if (typeof window !== 'undefined' && window.aetherDesktop) {
    return 'http://127.0.0.1:8787'
  }
  return ''
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function apiFetch(path: string, retries = 4): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${apiBase()}${path}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      return res
    } catch (e) {
      lastErr = e
      await sleep(250 * (i + 1))
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : 'erreur réseau'
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    throw new Error('API AETHER injoignable. Relance l’app (serveur local).')
  }
  throw lastErr instanceof Error ? lastErr : new Error('Connexion API impossible')
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

export async function fetchLive(): Promise<LiveSession> {
  const res = await apiFetch('/api/live')
  if (!res.ok) throw new Error(await readApiError(res, 'Impossible de charger la session live'))
  return res.json()
}

export async function fetchLaneMeta(
  lane: 'top' | 'jungle' | 'mid' | 'adc' | 'support',
  limit = 7,
): Promise<MetaGuides> {
  const res = await apiFetch(`/api/meta/lane/${lane}?limit=${limit}`)
  if (!res.ok) throw new Error(await readApiError(res, 'Impossible de charger la meta'))
  return res.json()
}

export async function fetchProfile(): Promise<ProfileHome> {
  const res = await apiFetch('/api/profile')
  if (!res.ok) throw new Error(await readApiError(res, 'Impossible de charger le profil'))
  return res.json()
}

export async function fetchMatchDebrief(gameId: number): Promise<MatchDebrief> {
  const res = await apiFetch(`/api/match/${gameId}/debrief`)
  if (!res.ok) {
    throw new Error(await readApiError(res, `Debrief impossible (HTTP ${res.status})`))
  }
  return res.json()
}

export async function fetchLatestDebrief(): Promise<MatchDebrief> {
  const res = await apiFetch('/api/debrief/latest')
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Aucun debrief disponible'))
  }
  return res.json()
}
