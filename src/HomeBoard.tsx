import { useCallback, useEffect, useState } from 'react'
import { fetchProfile, fetchMatchDebrief, fetchLatestDebrief } from './api'
import type { ProfileHome, MatchDebrief, MatchSummary } from './types'
import { itemIconUrl, resolveSpellIcon } from './ddragon'

function itemIcon(id: number): string {
  return itemIconUrl(id)
}

function spellIcon(id: number | null): string | null {
  return resolveSpellIcon({ id })
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatWhen(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ItemStrip({ items }: { items: number[] }) {
  if (!items.length) return null
  return (
    <div className="item-row compact">
      {items.slice(0, 7).map((id, i) => (
        <img key={`${id}-${i}`} src={itemIcon(id)} alt="" title={`Item ${id}`} />
      ))}
    </div>
  )
}

function SpellPair({ a, b }: { a: number | null; b: number | null }) {
  const ia = spellIcon(a)
  const ib = spellIcon(b)
  if (!ia && !ib) return null
  return (
    <div className="spell-pair">
      {ia ? <img src={ia} alt="" /> : <span className="spell-empty" />}
      {ib ? <img src={ib} alt="" /> : <span className="spell-empty" />}
    </div>
  )
}

function DebriefPanel({
  debrief,
  onClose,
}: {
  debrief: MatchDebrief
  onClose?: () => void
}) {
  const allies = debrief.players.filter((p) => p.team === 'ally')
  const enemies = debrief.players.filter((p) => p.team === 'enemy')

  return (
    <section className={`debrief-panel ${debrief.win ? 'win' : 'loss'}`}>
      <header className="debrief-head">
        <div>
          <span className="debrief-kicker">{debrief.win ? 'VICTOIRE' : 'DÉFAITE'} · {debrief.queueLabel}</span>
          <h2>{debrief.headline}</h2>
          <p className="debrief-dur">{formatDuration(debrief.gameDuration)}</p>
        </div>
        {onClose && (
          <button type="button" className="debrief-close" onClick={onClose}>
            FERMER
          </button>
        )}
      </header>

      <ul className="debrief-why">
        {debrief.why.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="debrief-cols">
        {[
          { title: 'ALLIÉS', rows: allies },
          { title: 'ENNEMIS', rows: enemies },
        ].map((col) => (
          <div key={col.title} className="debrief-col">
            <h3>{col.title}</h3>
            {col.rows.map((p) => (
              <article
                key={`${p.team}-${p.gameName}-${p.championId}`}
                className={`debrief-row grade-${p.grade.toLowerCase()} ${p.isYou ? 'you' : ''}`}
              >
                <div className="debrief-champ">
                  {p.championImage ? <img src={p.championImage} alt="" /> : <span>?</span>}
                  <em className={`grade-chip`}>{p.grade}</em>
                </div>
                <div className="debrief-meta">
                  <strong>
                    {p.isYou ? 'TOI' : p.gameName}
                    <span>#{p.tagLine}</span>
                  </strong>
                  <span className="debrief-champ-name">{p.championName}</span>
                  <span className="debrief-kda">
                    {p.kills}/{p.deaths}/{p.assists} · CS {p.cs} · {Math.round(p.gold / 1000)}k or
                  </span>
                  <p>{p.verdict}</p>
                  <ItemStrip items={p.items} />
                </div>
                <div className="debrief-score">{p.score}</div>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function MatchCard({
  match,
  onOpen,
}: {
  match: MatchSummary
  onOpen: (id: number) => void
}) {
  return (
    <button type="button" className={`match-card ${match.win ? 'win' : 'loss'}`} onClick={() => onOpen(match.gameId)}>
      <div className="match-result">{match.win ? 'W' : 'L'}</div>
      <div className="match-champ">
        {match.championImage ? <img src={match.championImage} alt="" /> : <span>?</span>}
      </div>
      <SpellPair a={match.spell1Id} b={match.spell2Id} />
      <div className="match-body">
        <div className="match-top">
          <strong>{match.championName}</strong>
          <span className="role-chip">{match.role}</span>
        </div>
        <div className="match-kda">
          {match.kills}/{match.deaths}/{match.assists}
          <em>CS {match.cs}</em>
        </div>
        <ItemStrip items={match.items} />
        <div className="match-foot">
          <span>{match.queueLabel}</span>
          <span>{formatDuration(match.gameDuration)}</span>
          <span>{formatWhen(match.gameCreation)}</span>
        </div>
      </div>
      <span className="match-open">DEBRIEF →</span>
    </button>
  )
}

export function HomeBoard({
  connected,
  forceLatestDebrief,
}: {
  connected: boolean
  forceLatestDebrief?: boolean
}) {
  const [profile, setProfile] = useState<ProfileHome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [debrief, setDebrief] = useState<MatchDebrief | null>(null)
  const [debriefLoading, setDebriefLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!connected) {
      setProfile(null)
      setLoading(false)
      return
    }
    try {
      const data = await fetchProfile()
      setProfile(data.connected ? data : null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Profil indisponible')
    } finally {
      setLoading(false)
    }
  }, [connected])

  useEffect(() => {
    void refresh()
    if (!connected) return
    const id = window.setInterval(() => void refresh(), 20_000)
    return () => window.clearInterval(id)
  }, [refresh, connected])

  useEffect(() => {
    if (!forceLatestDebrief || !connected) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await fetchLatestDebrief()
        if (!cancelled) setDebrief(d)
      } catch {
        /* pas encore dispo */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [forceLatestDebrief, connected])

  const openDebrief = async (gameId: number) => {
    setDebriefLoading(true)
    try {
      const d = await fetchMatchDebrief(gameId)
      setDebrief(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Debrief impossible')
    } finally {
      setDebriefLoading(false)
    }
  }

  if (!connected) {
    return (
      <section className="home-empty">
        <h2>SCOUT META</h2>
        <p>Lance League pour voir ton profil, l’historique et les debriefs. Sinon, scrappe la meta OP.GG ci-dessous.</p>
      </section>
    )
  }

  if (loading && !profile) {
    return (
      <section className="home-board loading">
        <p>Chargement du profil…</p>
      </section>
    )
  }

  if (!profile) {
    return (
      <section className="home-empty">
        <h2>COMPTE</h2>
        <p>{error || 'Impossible de lire ton invocateur LCU.'}</p>
      </section>
    )
  }

  const s = profile.stats

  return (
    <section className="home-board">
      <header className="home-profile">
        <img className="home-icon" src={profile.profileIconUrl} alt="" />
        <div className="home-identity">
          <span className="home-kicker">COMPTE CONNECTÉ</span>
          <h2>
            {profile.gameName}
            <span>#{profile.tagLine}</span>
          </h2>
          <p>Niveau {profile.summonerLevel}</p>
        </div>
        <div className="home-stats">
          <div>
            <span>RANK</span>
            <strong>
              {s?.tier ? `${s.tier} ${s.division ?? ''}` : '—'}
              {s?.lp != null ? ` · ${s.lp} LP` : ''}
            </strong>
          </div>
          <div>
            <span>WR RANKED</span>
            <strong>{s?.rankedWR != null ? `${s.rankedWR}%` : '—'}</strong>
            <em>
              {s ? `${s.wins}W ${s.losses}L` : ''}
            </em>
          </div>
          <div>
            <span>FORME RÉCENTE</span>
            <strong>{s?.formScore != null ? `${s.formScore}%` : s?.recentWR != null ? `${s.recentWR}%` : '—'}</strong>
            <em>{s?.recentGames ? `${s.recentGames} games` : ''}</em>
          </div>
        </div>
      </header>

      {error && <p className="home-error">{error}</p>}
      {debriefLoading && <p className="home-error">Analyse du match…</p>}

      {debrief && <DebriefPanel debrief={debrief} onClose={() => setDebrief(null)} />}

      <div className="home-history-head">
        <h3>HISTORIQUE</h3>
        <span>{profile.matches.length} dernières · clic = debrief</span>
      </div>

      <div className="match-list">
        {profile.matches.length === 0 ? (
          <p className="home-empty-inline">Aucune partie récente trouvée via le client.</p>
        ) : (
          profile.matches.map((m) => <MatchCard key={m.gameId} match={m} onOpen={openDebrief} />)
        )}
      </div>
    </section>
  )
}

export { DebriefPanel }
