import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchLive, fetchLaneMeta } from './api'
import type { LiveSession, LolBuildGuide, MetaGuides, PlayerCard, TftCompGuide } from './types'
import type { UpdateState } from './desktop'
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
    '—': '—',
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
  return `https://ddragon.leagueoflegends.com/cdn/15.6.1/img/item/${id}.png`
}

function PlayerSlot({
  player,
  isYou,
  index,
  tft,
  inGame,
}: {
  player: PlayerCard
  isYou: boolean
  index: number
  tft?: boolean
  inGame?: boolean
}) {
  const live = player.live
  const stats = player.playerStats
  const playerWr = tft
    ? stats?.top4Rate ?? stats?.formScore ?? stats?.rankedWR
    : stats?.formScore ?? stats?.rankedWR ?? stats?.recentWR
  // Priorité aux stats LCU joueur ; sinon WR champion OP.GG
  const displayWr = playerWr ?? (inGame || live ? null : player.championWinRate)
  const wrIsOpgg = playerWr == null && displayWr != null && displayWr > 0
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
              <span>CS {live.cs}</span>
              <span>OR ~{live.goldEstimate}</span>
              <span>WARD {live.wardScore}</span>
            </div>
            <div className="dmg-row">
              <div className="dmg-meta">
                <span>PART COMBAT</span>
                <strong>{live.damageShare}%</strong>
              </div>
              <div className="dmg-track">
                <div
                  className={`dmg-fill ${player.team}`}
                  style={{ width: `${Math.min(100, live.damageShare)}%` }}
                />
              </div>
            </div>
            {live.items.length > 0 && (
              <div className="item-row">
                {live.items.slice(0, 7).map((it) => (
                  <img
                    key={`${it.itemID}-${it.displayName}`}
                    src={itemIcon(it.itemID)}
                    alt={it.displayName}
                    title={it.displayName}
                  />
                ))}
              </div>
            )}
            {(live.spell1 || live.keystone) && (
              <div className="live-extras">
                {live.spell1 && <span>{live.spell1}</span>}
                {live.spell2 && <span>{live.spell2}</span>}
                {live.keystone && <span>{live.keystone}</span>}
              </div>
            )}
          </div>
        )}

        {stats && (
          <div className="player-form">
            {stats.tier && (
              <span className="rank-chip">
                {stats.tier} {stats.division}
                {stats.lp != null ? ` · ${stats.lp} LP` : ''}
              </span>
            )}
            {stats.rankedWR != null && (
              <span>
                Ranked {stats.rankedWR}% ({stats.wins}W {stats.losses}L)
              </span>
            )}
            {tft && stats.top4Rate != null && <span>Top4 {stats.top4Rate}%</span>}
            {!tft && stats.recentWR != null && (
              <span>
                Recent {stats.recentWR}% /{stats.recentGames}
              </span>
            )}
          </div>
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
          <strong>{displayWr != null ? displayWr.toFixed(1) : '—'}</strong>
          <span>
            {wrIsOpgg ? 'OP.GG' : live || tft ? 'FORM' : 'WR'}
          </span>
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
            <p>Scan en cours…</p>
            <span>
              {tft
                ? 'Aucun joueur TFT détecté — ouvre un lobby TFT'
                : inGame
                  ? 'Live Client 2999 indisponible — la partie doit être chargée'
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

  return (
    <section className="ingame-board">
      <div className="ingame-board-glow" aria-hidden />
      <div className="ingame-top">
        <div className="ingame-stream">
          <i className="stream-dot" />
          <span>DIRECT · LIVE CLIENT 2999</span>
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
          <small>
            CS {a.cs} · OR {a.gold.toLocaleString('fr-FR')}
          </small>
        </div>
        <div className="score-mid">
          <div className={`gold-diff ${goldDiff >= 0 ? 'up' : 'down'}`}>
            <span>GOLD EDGE</span>
            <strong>
              {goldDiff >= 0 ? '+' : ''}
              {goldDiff.toLocaleString('fr-FR')}
            </strong>
          </div>
          <div className="combat-compare">
            <div className="combat-bar">
              <i style={{ width: `${combatPct}%` }} />
              <b style={{ left: `${combatPct}%` }} />
            </div>
            <span>COMBAT POWER · {combatPct.toFixed(0)}% ALLY</span>
          </div>
        </div>
        <div className="score-side enemy">
          <span>ENEMY NET</span>
          <strong key={`e-${e.kills}-${e.deaths}-${e.assists}`} className="tick-num">
            {e.kills} / {e.deaths} / {e.assists}
          </strong>
          <small>
            CS {e.cs} · OR {e.gold.toLocaleString('fr-FR')}
          </small>
        </div>
      </div>

      {ig.events.length > 0 && (
        <div className="event-feed">
          {ig.events.slice(0, 8).map((ev, i) => (
            <div
              key={`${ev.id}-${ev.time}-${i}`}
              className="event-row"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <time>{formatGameClock(ev.time)}</time>
              <span>{ev.label}</span>
            </div>
          ))}
        </div>
      )}

      <p className="ingame-note">
        Flux temps réel · part combat = proxy KDA/CS/or (API Riot live = pas de DMG bruts)
      </p>
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
      aria-label="Sélecteur de lane meta OP.GG"
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
}: {
  lane: LaneId
  onLaneChange: (lane: LaneId) => void
  fallbackBuilds?: LolBuildGuide[]
  scout?: boolean
}) {
  const [meta, setMeta] = useState<MetaGuides | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchLaneMeta(lane, 7)
      .then((data) => {
        if (!cancelled) setMeta(data)
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

  const builds = meta?.lolBuilds?.length ? meta.lolBuilds : fallbackBuilds ?? []

  return (
    <section className={`guides-panel lol-guides ${scout ? 'scout-main' : ''}`} id="meta-opgg">
      <header className="guides-head">
        <div>
          <p className="panel-kicker">{scout ? 'META SCOUT · SANS LEAGUE' : 'META OP.GG'}</p>
          <h2>TOP 7 · {lane.toUpperCase()}</h2>
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

      {meta?.patchNote && <p className="lane-meta-note">{meta.patchNote}</p>}
      {error && <p className="lane-meta-error">{error}</p>}
      {loading && !builds.length && <p className="lane-meta-note">Chargement meta OP.GG…</p>}

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
              <span>OP.GG · {b.pickRate}% PR</span>
            </div>
            <div className="guide-build">
              <span className="keystone">{b.keystone}</span>
              <div className="items">
                {b.coreItems.map((item) => (
                  <span key={item} className="item-chip">
                    {item}
                  </span>
                ))}
                {b.boots !== '—' && <span className="item-chip boots">{b.boots}</span>}
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
              <span>Carry · {c.carry}</span>
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
    const ms = live?.inGame?.active ? 800 : 1500
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
    return desk.onUpdateState(setUpdate)
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
  // Mode scout : meta OP.GG sans League / hors draft / hors partie
  const isScoutMode = showLolLanes && !isInGame && !inChampSelect
  const showDraftHud = showLolLanes && (isInGame || inChampSelect)

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
            <p className="credit-gate-sub">Companion LoL · lecture seule · fair-play</p>
            <p className="credit-gate-feedback">
              Feedback / idées ?{' '}
              <a href="mailto:anissaanno94@gmail.com?subject=Feedback%20AETHER">anissaanno94@gmail.com</a>
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
                ? 'LIVE MATCH NEURAL LINK'
                : isTft
                  ? 'TFT Companion Desktop'
                  : isScoutMode
                    ? 'Meta OP.GG · sans League'
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
                REDÉMARRER
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
                ? 'NEURAL OVERLAY · REALTIME'
                : isScoutMode
                  ? 'META SCOUT · SANS CLIENT'
                  : 'COMPANION SYSTEM'}
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
            <strong>{live?.phase ?? '—'}</strong>
          </div>
          <div className="meta-chip">
            <span>QUEUE</span>
            <strong>{live?.queueName ?? '—'}</strong>
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
          <div className={`live-badge ${isInGame ? 'hot' : ''} ${isScoutMode ? 'scout' : ''}`}>
            <i className="live-dot" />
            {isInGame ? 'STREAM 0.8s' : isScoutMode ? 'META ONLY' : 'CLIENT LIVE'}
            <em>#{tick}</em>
          </div>
          <button type="button" className="icon-btn" onClick={() => void refresh()} title="Rafraîchir">
            ↻
          </button>
          <div className="sys-clock">{clockLabel}</div>
        </div>
      </header>

      {/* Barre lanes permanente — disponible sans League */}
      {showLolLanes && <LanePicker lane={metaLane} onChange={setMetaLane} sticky />}

      <section className="status-strip">
        <div className="status-message">
          <span className="status-key">
            {isInGame ? 'LIVE FEED' : isScoutMode ? 'META SCOUT' : 'STATUS'}
          </span>
          <p>
            {live?.message ??
              'Mode meta solo — choisis une lane (TOP / JGL / MID / ADC / SUP). League n’est pas requis.'}
          </p>
        </div>
        <div className="status-feed">
          <span>{isScoutMode ? 'SANS CLIENT OK' : 'LCU READ-ONLY'}</span>
          <span>
            {isInGame
              ? 'LIVE CLIENT · KDA / CS / OR / EVENTS'
              : isScoutMode
                ? 'TOP 7 OP.GG PAR LANE'
                : 'DATA LCU · RANKED + HISTORIQUE'}
          </span>
          <span>FAIR-PLAY MODE</span>
        </div>
      </section>

      {error && <div className="alert-banner">{error}</div>}

      {live && isTft && (
        <>
          <section className="vs-hud tft-form-hud">
            <div className="vs-side ally">
              <span>LOBBY FORM</span>
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
              <p className="vs-caption">WIN% ESTIMÉ · RANKED TFT + TOP4 RÉCENT (DATA LCU)</p>
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
                {isInGame
                  ? 'WIN% LIVE · RANKED + COMBAT EN PARTIE · FLUX CONTINU'
                  : 'TEAM WIN% · RANKED + HISTORIQUE RÉCENT'}
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
            />
            <TeamPanel
              title={isInGame ? 'ENEMIES' : 'RED SIDE'}
              subtitle={isInGame ? 'SCOREBOARD LIVE' : 'ÉQUIPE ENNEMIE'}
              players={live.enemies}
              winChance={live.teamWinChance.enemy}
              localPlayerCellId={null}
              side="enemy"
              inGame={isInGame}
            />
          </main>

          {live.guides?.patchNote && !isInGame && (
            <p className="guides-note">{live.guides.patchNote}</p>
          )}
        </>
      )}

      {/* Meta OP.GG = contenu principal hors TFT (avec ou sans League) */}
      {showLolLanes && (
        <LolBuildsPanel
          lane={metaLane}
          onLaneChange={setMetaLane}
          fallbackBuilds={live?.guides?.lolBuilds ?? []}
          scout={isScoutMode}
        />
      )}

      {isScoutMode && (live?.guides?.tftComps?.length ?? 0) > 0 && (
        <TftCompsPanel comps={live?.guides?.tftComps ?? []} />
      )}

      <footer className="hud-footer">
        <span>AETHER HUD v1.4 · META SCOUT</span>
        <span>Fonctionne sans League · live auto au draft</span>
        <span>Non affilié à Riot Games</span>
      </footer>
    </div>
  )
}
