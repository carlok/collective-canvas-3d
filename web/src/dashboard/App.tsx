import { useState, useRef, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { createWs } from '../shared/ws'
import { ParticleSystem } from '../shared/ParticleSystem'
import { TrailSystem } from '../shared/TrailSystem'
import { SceneHelpers } from '../shared/SceneHelpers'
import type { ServerMsg, ParticipantSnapshot } from '../shared/types'

export function DashboardApp() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'lobby' | 'live'>('lobby')
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const wsRef = useRef<ReturnType<typeof createWs> | null>(null)
  const snapshotRef = useRef<ParticipantSnapshot[]>([])

  const handleAuth = useCallback(() => {
    setError('')
    const ws = createWs('/ws/admin', (data: ServerMsg) => {
      switch (data.type) {
        case '_connected':
          ws.send({ type: 'auth', password })
          break
        case 'authenticated':
          if ('phase' in data) {
            setAuthed(true)
            setPhase(data.phase)
            setCount(data.participant_count)
          }
          break
        case 'error':
          if ('message' in data) setError(data.message)
          break
        case 'participant_count':
          if ('count' in data) setCount(data.count)
          break
        case 'state_change':
          if ('phase' in data) setPhase(data.phase)
          break
        case 'snapshot':
          if ('participants' in data) {
            snapshotRef.current = data.participants
          }
          break
      }
    })
    wsRef.current = ws
  }, [password])

  const handleGoLive = useCallback(() => {
    wsRef.current?.send({ type: 'go_live' })
  }, [])

  const handleStop = useCallback(() => {
    wsRef.current?.send({ type: 'stop' })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!authed) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'lobby') handleGoLive()
        else handleStop()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [authed, phase, handleGoLive, handleStop])

  if (!authed) {
    return (
      <div style={styles.loginContainer}>
        <h1 style={styles.title}>Collective Canvas 3D</h1>
        <h2 style={styles.subtitle}>Dashboard</h2>
        <div style={styles.loginForm}>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            style={styles.input}
            autoFocus
          />
          <button onClick={handleAuth} style={styles.button}>Enter</button>
          {error && <div style={styles.error}>{error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.dashboardContainer}>
      {/* Control panel */}
      <div style={styles.controlPanel}>
        <h2 style={styles.panelTitle}>Controls</h2>

        <div style={styles.stat}>
          <span style={styles.statLabel}>Phase</span>
          <span style={{
            ...styles.statValue,
            color: phase === 'live' ? '#4f4' : '#ff4',
          }}>
            {phase.toUpperCase()}
          </span>
        </div>

        <div style={styles.stat}>
          <span style={styles.statLabel}>Participants</span>
          <span style={styles.statValue}>{count}</span>
        </div>

        <div style={styles.buttonGroup}>
          {phase === 'lobby' ? (
            <button onClick={handleGoLive} style={{ ...styles.actionButton, background: '#4f4', color: '#000' }}>
              Go Live (Space)
            </button>
          ) : (
            <button onClick={handleStop} style={{ ...styles.actionButton, background: '#f44', color: '#fff' }}>
              Stop (Space)
            </button>
          )}
        </div>

        <div style={styles.hint}>
          Open <code>/display</code> on the projector
        </div>
      </div>

      {/* 3D preview */}
      <div style={styles.canvasContainer}>
        <Canvas camera={{ position: [3, 2, 5], fov: 60 }}>
          <color attach="background" args={['#0a0a0a']} />
          <SceneHelpers />
          <TrailSystem snapshotRef={snapshotRef} />
          <ParticleSystem snapshotRef={snapshotRef} />
          <OrbitControls enableDamping dampingFactor={0.1} />
        </Canvas>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loginContainer: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#0a0a0a',
  },
  title: { fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' },
  subtitle: { fontSize: '1rem', opacity: 0.5, marginBottom: '2rem' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: '1rem', width: 300 },
  input: {
    padding: '0.8rem 1rem', fontSize: '1rem',
    background: '#222', border: '1px solid #444', borderRadius: 8,
    color: '#fff', outline: 'none',
  },
  button: {
    padding: '0.8rem', fontSize: '1rem', fontWeight: 700,
    background: '#fff', color: '#000', border: 'none', borderRadius: 8,
    cursor: 'pointer',
  },
  error: { color: '#f44', textAlign: 'center' },
  dashboardContainer: {
    width: '100%', height: '100%',
    display: 'flex',
  },
  controlPanel: {
    width: 280, padding: '1.5rem',
    background: '#111', borderRight: '1px solid #333',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
    flexShrink: 0,
  },
  panelTitle: { fontSize: '1.2rem', fontWeight: 700 },
  stat: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { opacity: 0.6 },
  statValue: { fontSize: '1.4rem', fontWeight: 700 },
  buttonGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  actionButton: {
    padding: '1rem', fontSize: '1rem', fontWeight: 700,
    border: 'none', borderRadius: 8, cursor: 'pointer',
  },
  hint: { fontSize: '0.8rem', opacity: 0.4, marginTop: 'auto' },
  canvasContainer: { flex: 1, position: 'relative' },
}
