import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import { execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { LockfileData } from './types.js'

const LEAGUE_LOCKFILE_CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  path.join(process.env['LOCALAPPDATA'] ?? '', 'Riot Games', 'League of Legends', 'lockfile'),
  path.join(os.homedir(), 'Library', 'Application Support', 'League of Legends', 'lockfile'),
  path.join(os.homedir(), '.local', 'share', 'League of Legends', 'lockfile'),
]

function parseLockfile(filePath: string): LockfileData | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    const [name, pid, port, password, protocol] = raw.split(':')
    if (!name || !pid || !port || !password || !protocol) return null
    // Ignore Riot Client remoting lockfile — on veut LeagueClient
    if (name.toLowerCase().includes('riot')) return null
    return {
      name,
      pid: Number(pid),
      port: Number(port),
      password,
      protocol,
    }
  } catch {
    return null
  }
}

/** Parse --app-port / --remoting-auth-token depuis LeagueClientUx */
function findFromLeagueProcess(): LockfileData | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'LeagueClientUx.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    )
    const line = out.trim().split(/\r?\n/).find((l) => l.includes('LeagueClientUx')) ?? out
    const port = line.match(/--app-port=(\d+)/i)?.[1]
    const password = line.match(/--remoting-auth-token=([^\s"]+)/i)?.[1]
    if (!port || !password) return null
    return {
      name: 'LeagueClientUx',
      pid: 0,
      port: Number(port),
      password: password.replace(/"/g, ''),
      protocol: 'https',
    }
  } catch {
    return null
  }
}

export function findLockfile(): LockfileData | null {
  // 1) Process LeagueClientUx (le plus fiable)
  const fromProcess = findFromLeagueProcess()
  if (fromProcess) return fromProcess

  // 2) Lockfile League of Legends uniquement (pas Riot Client)
  for (const filePath of LEAGUE_LOCKFILE_CANDIDATES.filter(Boolean)) {
    const parsed = parseLockfile(filePath)
    if (parsed) return parsed
  }
  return null
}

export function lcuGet<T>(
  lockfile: LockfileData,
  endpoint: string,
  timeoutMs = 2500,
): Promise<T | null> {
  const auth = Buffer.from(`riot:${lockfile.password}`).toString('base64')

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: lockfile.port,
        path: endpoint,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode === 404 || !res.statusCode || res.statusCode >= 400) {
            resolve(null)
            return
          }
          try {
            const text = Buffer.concat(chunks).toString('utf8')
            if (!text) {
              resolve(null)
              return
            }
            // Certains endpoints renvoient une string JSON pure
            if (text.startsWith('"')) {
              resolve(JSON.parse(text) as T)
              return
            }
            resolve(JSON.parse(text) as T)
          } catch {
            resolve(null)
          }
        })
      },
    )

    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

/** Live Client Data API (en partie uniquement) — port 2999 */
export function liveClientGet<T>(endpoint: string): Promise<T | null> {
  const tryOnce = (protocol: 'https' | 'http') =>
    new Promise<T | null>((resolve) => {
      const lib = protocol === 'https' ? https : http
      const req = lib.request(
        {
          hostname: '127.0.0.1',
          port: 2999,
          path: endpoint,
          method: 'GET',
          rejectUnauthorized: false,
          headers: { Accept: 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            if (res.statusCode === 404 || !res.statusCode || res.statusCode >= 400) {
              resolve(null)
              return
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
            } catch {
              resolve(null)
            }
          })
        },
      )
      req.on('error', () => resolve(null))
      req.setTimeout(4000, () => {
        req.destroy()
        resolve(null)
      })
      req.end()
    })

  return tryOnce('https').then(async (data) => data ?? tryOnce('http'))
}
