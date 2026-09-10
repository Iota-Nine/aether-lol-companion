import { useCallback, useEffect, useState } from 'react'
import { fetchLive } from './api'
import type { LiveSession } from './types'
import './Overlay.css'

function clock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function OverlayApp() {
  const [live, setLive] = useState<LiveSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clickThrough, setClickThrough] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLive()
      setLive(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur live')
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    return () => document.documentElement.classList.remove('overlay-mode')
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 600)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const unsub = window.aetherDesktop?.onOverlayState?.((state) => {
      setClickThrough(state.clickThrough)
    })
    return () => {
      unsub?.()
    }
  }, [])

  useEffect(() => {
    void window.aetherDesktop?.overlaySetClickThrough?.(clickThrough)
  }, [clickThrough])

  const ig = live?.inGame
  const active = Boolean(ig?.active)
  const a = ig?.teamTotals.ally
  const e = ig?.teamTotals.enemy
  const goldDiff = a && e ? a.gold - e.gold : 0
  const events = (ig?.events || []).filter((ev) => (ev.kind || 'other') !== 'system').slice(0, 10)

  return (
    <div className={`overlay-shell ${active ? 'hot' : ''} ${clickThrough ? 'thru' : ''}`}>
      <header
        className="overlay-bar"
        onMouseEnter={() => {
          if (clickThrough) void window.aetherDesktop?.overlaySetClickThrough?.(false)
        }}
        onMouseLeave={() => {
          if (clickThrough) void window.aetherDesktop?.overlaySetClickThrough?.(true)
        }}
      >
        <div className="overlay-drag">
          <span className="overlay-mark">Æ</span>
          <strong>OVERLAY</strong>
          <em>{active ? clock(ig!.gameTime) : 'IDLE'}</em>
        </div>
        <div className="overlay-actions">
          <button
            type="button"
            className={clickThrough ? 'on' : ''}
            title="Traverser les clics (Ctrl+Shift+P)"
            onClick={() => setClickThrough((v) => !v)}
          >
            {clickThrough ? 'THRU ON' : 'THRU OFF'}
          </button>
          <button type="button" title="Masquer (Ctrl+Shift+O)" onClick={() => void window.aetherDesktop?.overlayHide?.()}>
            HIDE
          </button>
        </div>
      </header>

      {!active && (
        <div className="overlay-idle">
          <p>En attente d’une partie LoL…</p>
          <span>LoL en mode Fenêtre sans bordure (pas Plein écran exclusif)</span>
          <span>Ctrl+Shift+O · toggle · Ctrl+Shift+P · click-through</span>
          {error && <em>{error}</em>}
        </div>
      )}

      {active && a && e && (
        <>
          <div className="overlay-score">
            <div className="ov-side ally">
              <span>ALLY</span>
              <strong key={`a-${a.kills}-${a.deaths}-${a.assists}`} className="tick">
                {a.kills}/{a.deaths}/{a.assists}
              </strong>
              <small>CS {a.cs}</small>
            </div>
            <div className="ov-mid">
              <span>GOLD</span>
              <strong key={goldDiff} className={`tick ${goldDiff >= 0 ? 'up' : 'down'}`}>
                {goldDiff >= 0 ? '+' : ''}
                {goldDiff.toLocaleString('fr-FR')}
              </strong>
            </div>
            <div className="ov-side enemy">
              <span>ENEMY</span>
              <strong key={`e-${e.kills}-${e.deaths}-${e.assists}`} className="tick">
                {e.kills}/{e.deaths}/{e.assists}
              </strong>
              <small>CS {e.cs}</small>
            </div>
          </div>

          <div className="overlay-roster">
            <div className="ov-row">
              {(live?.allies || []).map((p) => (
                <div key={`oa-${p.cellId}`} className={`ov-chip ${p.live?.isDead ? 'dead' : ''}`} title={p.championName || ''}>
                  {p.championImage ? <img src={p.championImage} alt="" /> : <span>?</span>}
                  <em>
                    {p.live ? `${p.live.kills}/${p.live.deaths}` : '-'}
                  </em>
                </div>
              ))}
            </div>
            <div className="ov-row enemy">
              {(live?.enemies || []).map((p) => (
                <div key={`oe-${p.cellId}`} className={`ov-chip ${p.live?.isDead ? 'dead' : ''}`} title={p.championName || ''}>
                  {p.championImage ? <img src={p.championImage} alt="" /> : <span>?</span>}
                  <em>
                    {p.live ? `${p.live.kills}/${p.live.deaths}` : '-'}
                  </em>
                </div>
              ))}
            </div>
          </div>

          {events.length > 0 && (
            <div className="overlay-feed">
              {events.map((ev, i) => (
                <div key={`${ev.id}-${ev.time}-${i}`} className={`ov-ev kind-${ev.kind || 'other'}`}>
                  <time>{clock(ev.time)}</time>
                  <span>{ev.label}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
