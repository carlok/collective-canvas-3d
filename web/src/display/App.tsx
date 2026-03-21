import { useState, useRef, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { QRCodeSVG } from 'qrcode.react'
import { createWs } from '../shared/ws'
import { ParticleSystem } from '../shared/ParticleSystem'
import type { ServerMsg, ParticipantSnapshot } from '../shared/types'

export function DisplayApp() {
  const [authed, setAuthed] = useState(false)
  const [phase, setPhase] = useState<'lobby' | 'live'>('lobby')
  const [count, setCount] = useState(0)
  const snapshotRef = useRef<ParticipantSnapshot[]>([])

  const mobileUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port}/mobile`

  // Auto-connect: display page needs the password too
  const connect = useCallback(() => {
    const pw = prompt('Admin password for display:')
    if (!pw) return

    const ws = createWs('/ws/admin', (data: ServerMsg) => {
      switch (data.type) {
        case '_connected':
          ws.send({ type: 'auth', password: pw })
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
          alert('Invalid password')
          break
      }
    })
  }, [])

  useEffect(() => {
    connect()
  }, [])

  if (!authed) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>Connecting to server...</div>
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
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
        <color attach="background" args={['#000']} />
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
      {/* Participant count overlay */}
      <div style={styles.liveOverlay}>
        <span style={styles.liveCount}>{count}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#000',
  },
  loadingText: { fontSize: '1.5rem', opacity: 0.5, color: '#fff' },
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
