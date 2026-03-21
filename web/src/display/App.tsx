import { useState, useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { QRCodeSVG } from 'qrcode.react'
import { createWs } from '../shared/ws'
import { ParticleSystem } from '../shared/ParticleSystem'
import { SceneHelpers } from '../shared/SceneHelpers'
import type { ServerMsg, ParticipantSnapshot } from '../shared/types'

export function DisplayApp() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'lobby' | 'live'>('lobby')
  const [count, setCount] = useState(0)
  const snapshotRef = useRef<ParticipantSnapshot[]>([])

  const mobileUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port}/mobile`

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
        case 'error':
          if ('message' in data) setError(data.message)
          break
      }
    })
  }, [password])

  if (!authed) {
    return (
      <div style={styles.loginContainer}>
        <h1 style={styles.loginTitle}>Display</h1>
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
          <button onClick={handleAuth} style={styles.button}>Connect</button>
          {error && <div style={styles.error}>{error}</div>}
        </div>
      </div>
    )
  }

  if (phase === 'lobby') {
    return (
      <div style={styles.lobbyContainer}>
        <h1 style={styles.lobbyTitle}>Collective Canvas 3D</h1>
        <div style={styles.qrContainer}>
          <QRCodeSVG
            value={mobileUrl}
            size={320}
            bgColor="transparent"
            fgColor="#ffffff"
            level="M"
          />
        </div>
        <div style={styles.lobbyUrl}>{mobileUrl}</div>
        <div style={styles.countBadge}>
          <span style={styles.countNumber}>{count}</span>
          <span style={styles.countLabel}>{count === 1 ? 'participant' : 'participants'}</span>
        </div>
      </div>
    )
  }

  // Live phase — full screen 3D
  return (
    <div style={styles.canvasContainer}>
      <Canvas camera={{ position: [3, 2, 5], fov: 60 }}>
        <color attach="background" args={['#000']} />
        <SceneHelpers />
        <ParticleSystem snapshotRef={snapshotRef} />
        <OrbitControls
          autoRotate
          autoRotateSpeed={0.5}
          enableDamping
          dampingFactor={0.1}
          enableZoom={false}
          enablePan={false}
        />
      </Canvas>
      <div style={styles.liveOverlay}>
        <span style={styles.liveCount}>{count}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loginContainer: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#000', color: '#fff',
  },
  loginTitle: { fontSize: '1.5rem', opacity: 0.5, marginBottom: '2rem' },
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
  lobbyContainer: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#000', color: '#fff', gap: '2rem',
  },
  lobbyTitle: { fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em' },
  qrContainer: { padding: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: 24 },
  lobbyUrl: { fontSize: '1.2rem', opacity: 0.5, fontFamily: 'monospace' },
  countBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
  },
  countNumber: { fontSize: '4rem', fontWeight: 700 },
  countLabel: { fontSize: '1.2rem', opacity: 0.5 },
  canvasContainer: { width: '100%', height: '100%', position: 'relative' },
  liveOverlay: {
    position: 'absolute', top: 20, right: 20,
    background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem',
    borderRadius: 8,
  },
  liveCount: { fontSize: '1.5rem', fontWeight: 700, color: '#fff' },
}
