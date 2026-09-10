import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fetchLive, fetchLaneMeta } from './api'
import type { LiveSession, LolBuildGuide, MetaGuides, PlayerCard, TftCompGuide } from './types'
import type { UpdateState, OverlayState } from './desktop'
import { HomeBoard } from './HomeBoard'
import { itemIconUrl, resolveSpellIcon } from './ddragon'
import './App.css'

function wrTone(wr: number | null): 'good' | 'mid' | 'bad' | 'neutral' {
  if (wr == null) return 'neutral'
  if (wr >= 51.5) return 'good'
  if (wr >= 49.5) return 'mid'
  return 'bad'
}

function formatTimer(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function roleShort(role: string): string {
  const map: Record<string, string> = {
    Top: 'TOP',
    Jungle: 'JGL',
    Mid: 'MID',
    ADC: 'ADC',
    Support: 'SUP',
    HOST: 'HOST',
    '-': '-',
  }
  if (role.startsWith('P')) return role
  return map[role] ?? role.slice(0, 3).toUpperCase()
}

function formatGameClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function itemIcon(id: number): string {
  return itemIconUrl(id)
}

function LiveItemRow({ items }: { items: { itemID: number; displayName: string }[] }) {
  const slots = Array.from({ length: 7 }, (_, i) => items[i] ?? null)
  return (
    <div className="item-row live-items">
      {slots.map((it, i) =>
        it ? (
          <img key={`${it.itemID}-${i}`} src={itemIcon(it.itemID)} alt="" title={it.displayName} />
        ) : (
          <span key={`empty-${i}`} className="item-empty" />
        ),
      )}
    </div>
  )
}

function LiveSpellIcons({
  spell1,
  spell2,
  spell1Key,
  spell2Key,
  spell1Id,
  spell2Id,
}: {
  spell1?: string | null
  spell2?: string | null
  spell1Key?: string | null
  spell2Key?: string | null
  spell1Id?: number | null
  spell2Id?: number | null
}) {
  const a = resolveSpellIcon({ key: spell1Key, name: spell1, id: spell1Id })
  const b = resolveSpellIcon({ key: spell2Key, name: spell2, id: spell2Id })
  if (!a && !b) return null
  return (
    <div className="live-spells">
      {a ? <img src={a} alt={spell1 || ''} title={spell1 || ''} /> : <span className="spell-empty" />}
      {b ? <img src={b} alt={spell2 || ''} title={spell2 || ''} /> : <span className="spell-empty" />}
    </div>
  )
}

function PlayerSlot({
  player,
  isYou,
  index,
  tft,
  inGame,
  soloLive,
}: {
  player: PlayerCard
  isYou: boolean
  index: number
  tft?: boolean
  inGame?: boolean
  soloLive?: boolean
}) {
  const live = player.live
  const stats = player.playerStats
  // Anneau: WR COMPTE ranked (scout). Meta champ en hint, pas en faux 100%.
  const champMetaWr =
    player.championWinRate != null && player.championWinRate > 0 ? player.championWinRate : null
  const accountWr = tft
    ? stats?.top4Rate ?? stats?.formScore ?? stats?.rankedWR
    : stats?.recentWR ?? stats?.formScore ?? stats?.rankedWR
  // En draft: privilégie le WR compte. En live: meta champ si dispo, sinon rien.
  const displayWr = inGame || live ? champMetaWr : accountWr ?? champMetaWr
  const wrLabel =
    !inGame && !live && accountWr != null
      ? stats?.rankedWR != null
        ? 'COMPTE'
        : stats?.recentWR != null
          ? 'RECENT'
          : 'COMPTE'
      : champMetaWr != null
        ? 'META'
        : accountWr != null
          ? 'COMPTE'
          : 'WR'
  const tone = wrTone(displayWr ?? null)
  const status = player.locked ? 'locked' : player.isPickIntent ? 'intent' : 'waiting'

  return (
    <article
      className={`slot ${player.team} ${isYou ? 'you' : ''} status-${status} ${tft ? 'tft' : ''} ${live ? 'live-slot' : ''} ${live?.isDead ? 'is-dead' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="slot-index">{String(index + 1).padStart(2, '0')}</div>

      <div className="slot-portrait">
        <div className="portrait-ring">
          {player.championImage ? (
            <img src={player.championImage} alt={player.championName ?? 'Champion'} />
          ) : (
            <div className="portrait-empty">
              <span>{tft ? '◆' : '?'}</span>
            </div>
          )}
          {live && <span className="lvl-badge">LVL {live.level}</span>}
        </div>
        <LiveSpellIcons
          spell1={live?.spell1}
          spell2={live?.spell2}
          spell1Key={live?.spell1Key}
          spell2Key={live?.spell2Key}
          spell1Id={player.spell1Id}
          spell2Id={player.spell2Id}
        />
        <div className={`slot-flag flag-${status}`}>
          {live
            ? live.isDead
              ? `DEAD ${live.respawnTimer}s`
              : 'LIVE'
            : inGame
              ? 'INGAME'
              : tft
                ? player.locked
                  ? 'INGAME'
                  : 'LOBBY'
                : status === 'locked'
                  ? 'LOCK'
                  : status === 'intent'
                    ? 'HOVER'
                    : 'WAIT'}
        </div>
      </div>

      <div className="slot-body">
        <div className="slot-line-top">
          <div className="slot-identity">
            <strong className="slot-name">
              {player.gameName}
              <span className="slot-tag">#{player.tagLine}</span>
            </strong>
            {isYou && <span className="you-chip">YOU</span>}
          </div>
          <span className="role-chip">{roleShort(player.assignedPosition)}</span>
        </div>

        <div className="slot-line-mid">
          {player.championName ? (
            <>
              <span className="champ-label">{player.championName}</span>
              {player.championTier && !live && (
                <span className={`tier tier-${player.championTier.toLowerCase()}`}>
                  TIER {player.championTier}
                </span>
              )}
            </>
          ) : (
            <span className="champ-label dim">
              {tft ? 'En lobby / file d’attente…' : 'En attente du pick…'}
            </span>
          )}
        </div>

        {live && (
          <div className="live-stats">
            <div className="live-kda">
              <strong key={`${live.kills}-${live.deaths}-${live.assists}`} className="tick-num">
                {live.kills}/{live.deaths}/{live.assists}
              </strong>
              <span>KDA {live.kdaRatio}</span>
            </div>
            <div className="live-metrics">
              <span key={`cs-${live.cs}`} className="tick-num">
                CS {live.cs}
              </span>
              <span key={`g-${live.goldEstimate}`} className="tick-num">
                OR {live.goldEstimate.toLocaleString('fr-FR')}
              </span>
              <span>WARD {live.wardScore}</span>
            </div>
            <div className="dmg-row">
              <div className="dmg-meta">
                <span>PART COMBAT</span>
                <strong>{soloLive ? '-' : `${live.damageShare}%`}</strong>
              </div>
              <div className="dmg-track">
                <div
                  className={`dmg-fill ${player.team}`}
                  style={{ width: soloLive ? '0%' : `${Math.min(100, live.damageShare)}%` }}
                />
              </div>
            </div>
            <LiveItemRow items={live.items} />
            {live.keystone && <div className="live-keystone">{live.keystone}</div>}
          </div>
        )}

        {stats && (
          <div className="player-form">
            <span className="rank-chip account-chip">COMPTE ≠ CHAMP</span>
            {stats.tier && (
              <span className="rank-chip">
                {stats.tier} {stats.division}
                {stats.lp != null ? ` · ${stats.lp} LP` : ''}
              </span>
            )}
            {stats.rankedWR != null && (
              <span>
                Ranked compte {stats.rankedWR}% ({stats.wins}W {stats.losses}L)
              </span>
            )}
            {tft && stats.top4Rate != null && <span>Top4 {stats.top4Rate}%</span>}
            {!tft && stats.recentWR != null && (
              <span>
                Recent compte {stats.recentWR}% /{stats.recentGames}
              </span>
            )}
          </div>
        )}
        {player.championName && champMetaWr != null && (
          <p className="champ-meta-hint">
            Meta {player.championName} · {champMetaWr.toFixed(1)}% WR (pas ton historique perso)
          </p>
        )}
      </div>

      <div className={`slot-wr tone-${tone}`}>
        <div
          className="wr-ring"
          style={
            {
              '--wr': `${displayWr ?? 0}`,
            } as CSSProperties
          }
        >
          <strong>{displayWr != null ? displayWr.toFixed(1) : '-'}</strong>
          <span>{wrLabel}</span>
        </div>
      </div>
    </article>
  )
}

function TeamPanel({
  title,
  subtitle,
  players,
  winChance,
  localPlayerCellId,
  side,
  hideChance,
  tft,
  inGame,
  soloLive,
}: {
  title: string
  subtitle: string
  players: PlayerCard[]
  winChance: number
  localPlayerCellId: number | null
  side: 'ally' | 'enemy'
  hideChance?: boolean
  tft?: boolean
  inGame?: boolean
  soloLive?: boolean
}) {
  return (
    <section className={`team-panel ${side} ${tft ? 'tft-panel' : ''} ${inGame ? 'ingame-panel' : ''}`}>
      <div className="panel-corners" aria-hidden />
      <header className="panel-head">
        <div>
          <p className="panel-kicker">{subtitle}</p>
          <h2>{title}</h2>
        </div>
        {!hideChance && (
          <div className={`panel-chance tone-${wrTone(winChance)}`}>
            <span>WIN%</span>
            <strong>{winChance.toFixed(1)}</strong>
          </div>
        )}
        {hideChance && (
          <div className="panel-chance">
            <span>PLAYERS</span>
            <strong>{players.length}</strong>
          </div>
        )}
      </header>

      <div className="slot-list">
        {players.length === 0 ? (
          <div className="empty-state">
            <div className="radar" />
            <p>{soloLive && side === 'enemy' ? 'SOLO / PRACTICE' : 'Scan en cours…'}</p>
            <span>
              {tft
                ? 'Aucun joueur TFT détecté, ouvre un lobby TFT'
                : soloLive && side === 'enemy'
                  ? "Aucun ennemi: outil d'entraînement ou custom solo"
                  : inGame
                    ? 'Live Client 2999 indisponible, la partie doit être chargée'
                    : 'Aucun joueur détecté en champion select'}
            </span>
          </div>
        ) : (
          players.map((p, i) => (
            <PlayerSlot
              key={`${p.cellId}-${p.gameName}`}
              player={p}
              isYou={p.cellId === localPlayerCellId}
              index={i}
              tft={tft}
              inGame={inGame}
              soloLive={soloLive}
            />
          ))
        )}
      </div>
    </section>
  )
}

function BanRack({
  bans,
  label,
  side,
}: {
  bans: { id: number; name: string; image: string }[]
  label: string
  side: 'ally' | 'enemy'
}) {
  const slots = Array.from({ length: Math.max(5, bans.length) }, (_, i) => bans[i] ?? null)

  return (
    <div className={`ban-rack ${side}`}>
      <span className="ban-label">{label}</span>
      <div className="ban-slots">
        {slots.slice(0, 5).map((ban, i) => (
          <div key={`${side}-ban-${i}`} className={`ban-slot ${ban ? 'filled' : 'empty'}`} title={ban?.name}>
            {ban?.image ? <img src={ban.image} alt={ban.name} /> : <span>{i + 1}</span>}
            {ban && <i className="ban-slash" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function InGameBoard({ live }: { live: LiveSession }) {
  const ig = live.inGame
  if (!ig?.active) return null
  const a = ig.teamTotals.ally
  const e = ig.teamTotals.enemy
  const goldDiff = a.gold - e.gold
  const combatPct = (a.combat / (a.combat + e.combat || 1)) * 100
  const roster = [...live.allies, ...live.enemies]
  const killFeed = ig.events.filter((ev) => (ev.kind || 'other') !== 'system').slice(0, 10)

  return (
    <section className="ingame-board">
      <div className="ingame-board-glow" aria-hidden />
      <div className="ingame-top">
        <div className="ingame-stream">
          <i className="stream-dot" />
          <span>LIVE 0.6s</span>
        </div>
        <div className="ingame-clock">
          <span>MATCH CLOCK</span>
          <strong key={ig.gameTime} className="tick-num">
            {formatGameClock(ig.gameTime)}
          </strong>
          <em>{ig.gameMode}</em>
        </div>
        <div className="ingame-map">{ig.mapName || "SUMMONER'S RIFT"}</div>
      </div>

      <div className="ingame-score">
        <div className="score-side ally">
          <span>ALLY NET</span>
          <strong key={`a-${a.kills}-${a.deaths}-${a.assists}`} className="tick-num">
            {a.kills} / {a.deaths} / {a.assists}
          </strong>
          <small key={`acs-${a.cs}-${a.gold}`} className="tick-num">
            CS {a.cs} · OR {a.gold.toLocaleString('fr-FR')}
          </small>
        </div>
        <div className="score-mid">
          <div className={`gold-diff ${goldDiff >= 0 ? 'up' : 'down'}`}>
            <span>GOLD EDGE</span>
            <strong key={goldDiff} className="tick-num">
              {goldDiff >= 0 ? '+' : ''}
              {goldDiff.toLocaleString('fr-FR')}
            </strong>
          </div>
          <div className="combat-compare">
            <div className="combat-bar">
              <i style={{ width: `${combatPct}%` }} />
              <b style={{ left: `${combatPct}%` }} />
            </div>
            <span>COMBAT {combatPct.toFixed(0)}% ALLY</span>
          </div>
        </div>
        <div className="score-side enemy">
          <span>ENEMY NET</span>
          <strong key={`e-${e.kills}-${e.deaths}-${e.assists}`} className="tick-num">
            {e.kills} / {e.deaths} / {e.assists}
          </strong>
          <small key={`ecs-${e.cs}-${e.gold}`} className="tick-num">
            CS {e.cs} · OR {e.gold.toLocaleString('fr-FR')}
          </small>
        </div>
      </div>

      {roster.length > 0 && (
        <div className="ingame-roster">
          <div className="roster-side ally">
            {live.allies.map((p) => (
              <div key={`ra-${p.cellId}`} className={`roster-chip ${p.live?.isDead ? 'dead' : ''}`}>
                {p.championImage ? <img src={p.championImage} alt="" /> : <span>?</span>}
                <em key={`${p.live?.kills}-${p.live?.deaths}-${p.live?.assists}`} className="tick-num">
                  {p.live ? `${p.live.kills}/${p.live.deaths}/${p.live.assists}` : '-'}
                </em>
              </div>
            ))}
          </div>
          <div className="roster-side enemy">
            {live.enemies.map((p) => (
              <div key={`re-${p.cellId}`} className={`roster-chip ${p.live?.isDead ? 'dead' : ''}`}>
                {p.championImage ? <img src={p.championImage} alt="" /> : <span>?</span>}
                <em key={`${p.live?.kills}-${p.live?.deaths}-${p.live?.assists}`} className="tick-num">
                  {p.live ? `${p.live.kills}/${p.live.deaths}/${p.live.assists}` : '-'}
                </em>
              </div>
            ))}
          </div>
        </div>
      )}

      {killFeed.length > 0 && (
        <div className="event-feed">
          {killFeed.map((ev, i) => (
            <div
              key={`${ev.id}-${ev.time}-${i}`}
              className={`event-row kind-${ev.kind || 'other'}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <time>{formatGameClock(ev.time)}</time>
              <i className="event-kind" />
              <span>{ev.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const LANES = [
  { id: 'top', label: 'TOP' },
  { id: 'jungle', label: 'JUNGLE' },
  { id: 'mid', label: 'MID' },
  { id: 'adc', label: 'ADC' },
  { id: 'support', label: 'SUPPORT' },
] as const

type LaneId = (typeof LANES)[number]['id']

function LanePicker({
  lane,
  onChange,
  sticky,
}: {
  lane: LaneId
  onChange: (lane: LaneId) => void
  sticky?: boolean
}) {
  return (
    <nav
      className={`lane-dock ${sticky ? 'is-sticky' : ''}`}
      aria-label="Sélecteur de lane meta"
    >
      <div className="lane-dock-copy">
        <span className="lane-dock-key">LANE META</span>
        <strong>TOP · JGL · MID · ADC · SUP</strong>
      </div>
      <div className="lane-switch" role="tablist" aria-label="Choisir une lane">
        {LANES.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={lane === l.id}
            className={`lane-btn ${lane === l.id ? 'active' : ''}`}
            onClick={() => onChange(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

function LolBuildsPanel({
  lane,
  onLaneChange,
  fallbackBuilds,
  scout,
  secondary,
}: {
  lane: LaneId
  onLaneChange: (lane: LaneId) => void
  fallbackBuilds?: LolBuildGuide[]
  scout?: boolean
  secondary?: boolean
}) {
  const [meta, setMeta] = useState<MetaGuides | null>(null)
  const [cache, setCache] = useState<Partial<Record<LaneId, MetaGuides>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Garde l'ancien contenu visible pendant le fetch (pas de flash vide)
    setLoading(true)
    setError(null)
    void fetchLaneMeta(lane, 7)
      .then((data) => {
        if (!cancelled) {
          setMeta(data)
          setCache((prev) => ({ ...prev, [lane]: data }))
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur meta')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lane])

  const builds =
    meta?.lolBuilds?.length
      ? meta.lolBuilds
      : cache[lane]?.lolBuilds?.length
        ? cache[lane]!.lolBuilds
        : fallbackBuilds ?? []
  const patchNote = meta?.patchNote || cache[lane]?.patchNote

  return (
    <section
      className={`guides-panel lol-guides ${scout && !secondary ? 'scout-main' : ''} ${secondary ? 'meta-secondary' : ''}`}
      id="meta-lane"
    >
      <header className="guides-head">
        <div>
          <p className="panel-kicker">
            {secondary ? 'META RANKED' : scout ? 'META SANS LEAGUE' : 'META RANKED'}
          </p>
          <h2>TOP 7 {lane.toUpperCase()}</h2>
        </div>
        <span className="guides-count">{loading ? '…' : `${builds.length} champs`}</span>
      </header>

      <div className="lane-switch lane-switch-inline" role="tablist" aria-label="Changer de lane">
        {LANES.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={lane === l.id}
            className={`lane-btn ${lane === l.id ? 'active' : ''}`}
            onClick={() => onLaneChange(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {patchNote && <p className="lane-meta-note">{patchNote}</p>}
      {error && <p className="lane-meta-error">{error}</p>}
      {loading && !builds.length && <p className="lane-meta-note">Chargement meta…</p>}

      <div className={`guides-list ${loading ? 'is-loading' : ''}`}>
        {builds.map((b, i) => (
          <article key={`${lane}-${b.championId}`} className="guide-card">
            <div className="guide-rank">#{i + 1}</div>
            <div className="guide-champ">
              {b.championImage ? <img src={b.championImage} alt={b.championName} /> : null}
              <div>
                <strong>{b.championName}</strong>
                <span>
                  {b.role} · TIER {b.tier}
                </span>
              </div>
            </div>
            <div className={`guide-wr tone-${wrTone(b.winRate)}`}>
              <strong>{b.winRate.toFixed(1)}%</strong>
              <span>{b.pickRate}% PR</span>
            </div>
            <div className="guide-build">
              <span className="keystone">{b.keystone}</span>
              <div className="items">
                {b.coreItems.map((item) => (
                  <span key={item} className="item-chip">
                    {item}
                  </span>
                ))}
                {b.boots !== '-' && <span className="item-chip boots">{b.boots}</span>}
              </div>
              <p>{b.tips}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function TftCompsPanel({ comps }: { comps: TftCompGuide[] }) {
  if (!comps.length) return null
  return (
    <section className="guides-panel tft-guides">
      <header className="guides-head">
        <div>
          <p className="panel-kicker">TFT META</p>
          <h2>COMPOS RECOMMANDÉES</h2>
        </div>
        <span className="guides-count">{comps.length} compos</span>
      </header>
      <div className="comps-grid">
        {comps.map((c) => (
          <article key={c.id} className={`comp-card tier-${c.tier.toLowerCase()}`}>
            <div className="comp-top">
              <div>
                <span className={`tier tier-${c.tier.toLowerCase()}`}>TIER {c.tier}</span>
                <h3>{c.name}</h3>
              </div>
              <div className="comp-stats">
                <div>
                  <strong className={`tone-${wrTone(c.winRate)}`}>{c.winRate}%</strong>
                  <span>WIN</span>
                </div>
                <div>
                  <strong>{c.avgPlace}</strong>
                  <span>AVG</span>
                </div>
              </div>
            </div>
            <div className="comp-meta">
              <span>{c.playStyle}</span>
              <span>{c.difficulty}</span>
              <span>Carry: {c.carry}</span>
            </div>
            <div className="comp-traits">
              {c.traits.map((t) => (
                <span key={t} className="trait-chip">
                  {t}
                </span>
              ))}
            </div>
            <div className="comp-units">
              {c.units.map((u) => (
                <span key={u.name} className={`unit cost-${u.cost}`} title={`${u.name} ★${u.star}`}>
                  <em>{u.cost}</em>
                  {u.name}
                </span>
              ))}
            </div>
            <p className="comp-tip">{c.tip}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const [live, setLive] = useState<LiveSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(() => new Date())
  const [tick, setTick] = useState(0)
  const [syncFlash, setSyncFlash] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [metaLane, setMetaLane] = useState<LaneId>('mid')
  const [creditGateOpen, setCreditGateOpen] = useState(true)
  const [overlay, setOverlay] = useState<OverlayState>({ open: false, clickThrough: false })
  const [pendingDebrief, setPendingDebrief] = useState(false)
  const wasInGameRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLive()
      setLive(data)
      setError(null)
      setTick((t) => t + 1)
      setSyncFlash(true)
      window.setTimeout(() => setSyncFlash(false), 280)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const ms = live?.inGame?.active ? 600 : 1500
    const id = window.setInterval(() => void refresh(), ms)
    return () => window.clearInterval(id)
  }, [refresh, live?.inGame?.active])

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const desk = window.aetherDesktop
    if (!desk?.onUpdateState) return
    void desk.getUpdateState?.().then(setUpdate)
    const unsub = desk.onUpdateState(setUpdate)
    // Relance côté UI aussi (filet de sécu si l'app reste ouverte des heures)
    const id = window.setInterval(() => {
      void desk.checkForUpdates?.()
    }, 5 * 60 * 1000)
    return () => {
      unsub()
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const desk = window.aetherDesktop
    if (!desk?.overlayGetState) return
    void desk.overlayGetState().then(setOverlay)
    const unsub = desk.onOverlayState?.(setOverlay)
    return () => {
      unsub?.()
    }
  }, [])

  const secondsLeft = live?.timer
    ? Math.max(0, Math.round(live.timer.adjustedTimeLeftInPhase / 1000))
    : null

  const connectionLabel = loading
    ? 'SYNC'
    : live?.connected
      ? 'LIVE'
      : 'OFFLINE'

  const connectionTone = loading ? 'sync' : live?.connected ? 'live' : 'offline'
  // Lanes meta = permanentes dès que ce n'est PAS une session TFT active
  const isTft = live?.mode === 'tft'
  const showLolLanes = !isTft
  const tftPlayers = live?.players?.length ? live.players : live?.allies ?? []
  const phase = live?.phase ?? 'Idle'
  const isInGame =
    Boolean(live?.inGame?.active) ||
    ['InProgress', 'GameStart', 'Reconnect'].includes(phase)
  const inChampSelect =
    !isInGame &&
    (phase === 'ChampSelect' ||
      Boolean(live?.timer) ||
      (live?.allies?.some((p) => p.championId || p.isPickIntent) ?? false))
  // Mode scout : meta sans League / hors draft / hors partie
  const isScoutMode = showLolLanes && !isInGame && !inChampSelect
  const showDraftHud = showLolLanes && (isInGame || inChampSelect)
  const isSoloLive = isInGame && (live?.enemies?.length ?? 0) === 0
  const isPractice = /PRACTICE/i.test(live?.inGame?.gameMode || live?.queueName || '')
  const isEndOfGame =
    showLolLanes &&
    !isInGame &&
    !inChampSelect &&
    ['EndOfGame', 'WaitingForStats', 'PreEndOfGame', 'TerminatedInError'].includes(phase)
  const showHome = isScoutMode && Boolean(live?.connected) && !isTft
  const showOfflineScout = isScoutMode && !live?.connected

  // Overlay auto + debrief auto à la sortie de game
  useEffect(() => {
    if (isInGame && !wasInGameRef.current) {
      void window.aetherDesktop?.overlayShow?.().then(setOverlay)
    }
    if (!isInGame && wasInGameRef.current) {
      setPendingDebrief(true)
    }
    if (isInGame) setPendingDebrief(false)
    wasInGameRef.current = isInGame
  }, [isInGame])

  useEffect(() => {
    if (!pendingDebrief) return
    const id = window.setTimeout(() => setPendingDebrief(false), 90_000)
    return () => window.clearTimeout(id)
  }, [pendingDebrief])

  const clockLabel = useMemo(
    () =>
      clock.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [clock],
  )

  const isDesktop = Boolean(window.aetherDesktop?.isDesktop)
  const showUpdateBanner =
    update &&
    update.status !== 'idle' &&
    update.status !== 'up-to-date'

  return (
    <div
      className={`hud ${isDesktop ? 'desktop' : ''} ${isTft ? 'mode-tft' : 'mode-lol'} ${isInGame ? 'mode-ingame' : ''} ${syncFlash ? 'syncing' : ''}`}
    >
      {creditGateOpen && (
        <div className="credit-gate" role="dialog" aria-modal="true" aria-labelledby="credit-gate-title">
          <div className="credit-gate-card">
            <span className="credit-gate-mark">Æ</span>
            <p className="credit-gate-kicker">AETHER</p>
            <h2 id="credit-gate-title">Made by Anissa</h2>
            <p className="credit-gate-sub">Companion LoL, lecture seule</p>
            <p className="credit-gate-feedback">
              Feedback / idées ?{' '}
              <a href="mailto:anissaanno94@gmail.com?subject=Feedback%20AETHER">anissaanno94@gmail.com</a>
            </p>
            <p className="credit-gate-discord">
              Discord: <strong>sutabakusu</strong>
            </p>
            <button type="button" className="credit-gate-ok" autoFocus onClick={() => setCreditGateOpen(false)}>
              OK
            </button>
          </div>
        </div>
      )}

      <div className="hud-bg" aria-hidden>
        <div className="bg-aurora" />
        <div className="bg-grid" />
        <div className="bg-hex" />
        <div className="bg-glow left" />
        <div className="bg-glow right" />
        <div className="bg-scan" />
        <div className="bg-noise" />
      </div>

      {isDesktop && (
        <div className="titlebar">
          <div className="titlebar-drag">
            <span className="titlebar-mark">Æ</span>
            <strong>AETHER</strong>
            <span className="titlebar-sub">
              {isInGame
                ? 'MATCH LIVE'
                : isTft
                  ? 'TFT Companion Desktop'
                  : isScoutMode
                    ? live?.connected
                      ? 'Profil, historique, debrief'
                      : 'Meta sans League'
                    : 'LoL Companion Desktop'}
            </span>
          </div>
          <div className="titlebar-controls">
            <button type="button" aria-label="Réduire" onClick={() => void window.aetherDesktop?.minimize()}>
              ─
            </button>
            <button type="button" aria-label="Agrandir" onClick={() => void window.aetherDesktop?.maximize()}>
              □
            </button>
            <button
              type="button"
              className="close"
              aria-label="Fermer"
              onClick={() => void window.aetherDesktop?.close()}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {showUpdateBanner && (
        <div className={`update-banner status-${update.status}`}>
          <div className="update-copy">
            <span className="update-key">AUTO-UPDATE</span>
            <p>{update.message}</p>
            {update.status === 'downloading' && (
              <div className="update-track">
                <i style={{ width: `${update.progress}%` }} />
              </div>
            )}
          </div>
          <div className="update-actions">
            {update.appVersion && <em>v{update.appVersion}</em>}
            {update.status === 'ready' && (
              <button type="button" onClick={() => void window.aetherDesktop?.installUpdate()}>
                INSTALLER MAINTENANT
              </button>
            )}
            {(update.status === 'error' || update.status === 'checking') && (
              <button type="button" onClick={() => void window.aetherDesktop?.checkForUpdates()}>
                RETRY
              </button>
            )}
          </div>
        </div>
      )}
      <header className="command-bar">
        <div className="brand-block">
          <div className="mark">
            <span>Æ</span>
            <i className="mark-ring" />
          </div>
          <div className="brand-copy">
            <p className="brand-eyebrow">
              {isInGame
                ? 'en partie'
                : showHome
                  ? 'PROFIL + HISTORIQUE'
                  : isScoutMode
                    ? 'META SANS CLIENT'
                    : 'Companion'}
            </p>
            <h1>AETHER</h1>
          </div>
        </div>

        <div className="command-center">
          <div className={`link-pill tone-${connectionTone}`}>
            <i className="pulse" />
            <span>{connectionLabel}</span>
          </div>
          <div className={`mode-pill ${isTft ? 'tft' : 'lol'}`}>{isTft ? 'TFT' : 'LoL'}</div>
          {isInGame && (
            <div className="mode-pill ingame-pill">
              <i />
              IN-GAME
            </div>
          )}
          <div className="meta-chip">
            <span>PHASE</span>
            <strong>{live?.phase ?? '-'}</strong>
          </div>
          <div className="meta-chip">
            <span>QUEUE</span>
            <strong>{live?.queueName ?? '-'}</strong>
          </div>
          <div className="meta-chip">
            <span>REGION</span>
            <strong>{(live?.region ?? 'euw').toUpperCase()}</strong>
          </div>
          {!isTft && !isInGame && (
            <div className="meta-chip timer">
              <span>DRAFT</span>
              <strong>{formatTimer(secondsLeft)}</strong>
            </div>
          )}
          {isInGame && live?.inGame && (
            <div className="meta-chip timer live-timer">
              <span>GAME</span>
              <strong key={live.inGame.gameTime} className="tick-num">
                {formatGameClock(live.inGame.gameTime)}
              </strong>
            </div>
          )}
        </div>

        <div className="command-actions">
          {isDesktop && (
            <button
              type="button"
              className={`overlay-toggle ${overlay.open ? 'on' : ''}`}
              title="Overlay in-game (Ctrl+Shift+O)"
              onClick={() => void window.aetherDesktop?.overlayToggle?.().then(setOverlay)}
            >
              {overlay.open ? 'OVERLAY ON' : 'OVERLAY'}
            </button>
          )}
          <div className={`live-badge ${isInGame ? 'hot' : ''} ${isScoutMode ? 'scout' : ''} ${showHome ? 'home' : ''}`}>
            <i className="live-dot" />
            {isInGame ? 'LIVE 0.6s' : showHome ? 'PROFIL + HISTO' : isScoutMode ? 'META' : 'CLIENT'}
            <em>#{tick}</em>
          </div>
          <button type="button" className="icon-btn" onClick={() => void refresh()} title="Rafraîchir">
            ↻
          </button>
          <div className="sys-clock">{clockLabel}</div>
        </div>
      </header>

      {/* Barre lanes - masquée en live pour laisser place au scoreboard */}
      {showLolLanes && !isInGame && <LanePicker lane={metaLane} onChange={setMetaLane} sticky />}

      <section className="status-strip">
        <div className="status-message">
          <span className="status-key">
            {isInGame
              ? 'LIVE'
              : isEndOfGame
                ? 'DEBRIEF'
                : showHome
                  ? 'HOME'
                  : isScoutMode
                    ? 'META'
                    : 'STATUS'}
          </span>
          <p>
            {live?.message ??
              'Mode meta solo: choisis une lane (TOP / JGL / MID / ADC / SUP). League n’est pas requis.'}
          </p>
        </div>
        <div className="status-feed">
          <span>{showOfflineScout ? 'SANS CLIENT OK' : 'LCU READ-ONLY'}</span>
          <span>
            {isInGame
              ? 'LIVE: KDA, CS, OR, EVENTS'
              : showHome
                ? 'PROFIL, HISTORIQUE, DEBRIEF'
                : isScoutMode
                  ? 'TOP 7 META PAR LANE'
                  : 'LCU: ranked + historique'}
          </span>
          <span>lecture seule</span>
        </div>
      </section>

      {error && <div className="alert-banner">{error}</div>}

      {isScoutMode && (
        <HomeBoard
          connected={Boolean(live?.connected)}
          forceLatestDebrief={isEndOfGame || pendingDebrief}
        />
      )}

      {live && isTft && (
        <>
          <section className="vs-hud tft-form-hud">
            <div className="vs-side ally">
              <span>LOBBY</span>
              <strong className={`tone-${wrTone(live.teamWinChance.ally)}`}>
                {live.teamWinChance.ally.toFixed(1)}%
              </strong>
            </div>
            <div className="vs-core">
              <div className="vs-track">
                <div className="vs-fill" style={{ width: `${live.teamWinChance.ally}%` }} />
                <div className="vs-divider" style={{ left: `${live.teamWinChance.ally}%` }}>
                  <span>WR</span>
                </div>
              </div>
              <p className="vs-caption">Win% estimé (ranked TFT + top4 récent)</p>
            </div>
            <div className="vs-side enemy">
              <span>BASELINE</span>
              <strong className={`tone-${wrTone(live.teamWinChance.enemy)}`}>
                {live.teamWinChance.enemy.toFixed(1)}%
              </strong>
            </div>
          </section>

          <main className="tft-grid">
            <TeamPanel
              title="TFT LOBBY / MATCH"
              subtitle={live.queueName ?? 'TEAMFIGHT TACTICS'}
              players={tftPlayers}
              winChance={live.teamWinChance.ally}
              localPlayerCellId={live.localPlayerCellId}
              side="ally"
              tft
            />
          </main>
          {live.guides?.patchNote && <p className="guides-note">{live.guides.patchNote}</p>}
          <TftCompsPanel comps={live.guides?.tftComps ?? []} />
        </>
      )}

      {/* Draft / in-game uniquement quand une vraie session LoL tourne */}
      {live && showDraftHud && (
        <>
          <section className={`vs-hud ${isInGame ? 'vs-live' : ''}`}>
            <div className="vs-side ally">
              <span>ALLIES</span>
              <strong
                key={`wa-${live.teamWinChance.ally}`}
                className={`tone-${wrTone(live.teamWinChance.ally)} tick-num`}
              >
                {live.teamWinChance.ally.toFixed(1)}%
              </strong>
            </div>

            <div className="vs-core">
              <div className="vs-track">
                <div className="vs-fill" style={{ width: `${live.teamWinChance.ally}%` }} />
                <div className="vs-divider" style={{ left: `${live.teamWinChance.ally}%` }}>
                  <span>VS</span>
                </div>
              </div>
              <p className="vs-caption">
                {isSoloLive
                  ? isPractice
                    ? "Outil d'entraînement, pas d'équipe ennemie"
                    : "Solo/custom, pas d'équipe ennemie"
                  : isInGame
                    ? 'Win% live: ranked compte + combat'
                    : 'Win% équipe: ranked + historique récent'}
              </p>
            </div>

            <div className="vs-side enemy">
              <span>ENEMIES</span>
              <strong
                key={`we-${live.teamWinChance.enemy}`}
                className={`tone-${wrTone(live.teamWinChance.enemy)} tick-num`}
              >
                {live.teamWinChance.enemy.toFixed(1)}%
              </strong>
            </div>
          </section>

          {isInGame && <InGameBoard live={live} />}

          {!isInGame && (
            <section className="ban-row">
              <BanRack bans={live.bans.ally} label="ALLY BANS" side="ally" />
              <BanRack bans={live.bans.enemy} label="ENEMY BANS" side="enemy" />
            </section>
          )}

          <main className={`draft-grid ${isInGame ? 'ingame-grid' : ''}`}>
            <TeamPanel
              title={isInGame ? 'ALLIES' : 'BLUE SIDE'}
              subtitle={isInGame ? 'SCOREBOARD LIVE' : 'ÉQUIPE ALLIÉE'}
              players={live.allies}
              winChance={live.teamWinChance.ally}
              localPlayerCellId={live.localPlayerCellId}
              side="ally"
              inGame={isInGame}
              soloLive={isSoloLive}
            />
            <TeamPanel
              title={isInGame ? 'ENEMIES' : 'RED SIDE'}
              subtitle={isInGame ? (isSoloLive ? 'AUCUN ENNEMI' : 'SCOREBOARD LIVE') : 'ÉQUIPE ENNEMIE'}
              players={live.enemies}
              winChance={live.teamWinChance.enemy}
              localPlayerCellId={null}
              side="enemy"
              inGame={isInGame}
              soloLive={isSoloLive}
              hideChance={isSoloLive}
            />
          </main>

          {live.guides?.patchNote && !isInGame && (
            <p className="guides-note">{live.guides.patchNote}</p>
          )}
        </>
      )}

      {/* Meta hors in-game (secondaire si profil) */}
      {showLolLanes && !isInGame && (
        <LolBuildsPanel
          lane={metaLane}
          onLaneChange={setMetaLane}
          fallbackBuilds={live?.guides?.lolBuilds ?? []}
          scout={isScoutMode}
          secondary={showHome}
        />
      )}

      {isScoutMode && (live?.guides?.tftComps?.length ?? 0) > 0 && (
        <TftCompsPanel comps={live?.guides?.tftComps ?? []} />
      )}

      <footer className="hud-footer">
        <span>AETHER · profil, historique, debrief</span>
        <span>Overlay: mode fenêtre sans bordure LoL</span>
        <span>Non affilié à Riot Games</span>
      </footer>
    </div>
  )
}
