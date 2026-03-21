import { useState, useRef, useCallback, useEffect } from 'react'
import { createWs } from '../shared/ws'
import type { ServerMsg, PositionMsg } from '../shared/types'

type Phase = 'loading' | 'join' | 'waiting' | 'permission' | 'hint' | 'painting' | 'error'

function hasMotionSensor(): boolean {
  return 'DeviceMotionEvent' in window && 'ontouchstart' in window
}

// Sensitivity: degrees/second integrated over time → maps to position
// Tuning: how rotation maps to brush movement
const POSITION_DECAY = 1.0 // no decay — brush stays where you put it
const ROTATION_SCALE = 0.05 // very high sensitivity — arm circle → visible circle

export function MobileApp() {
  const [phase, setPhase] = useState<Phase>('join')
  const [color, setColor] = useState('#666')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [brushPos, setBrushPos] = useState({ x: 0, y: 0 })
  const wsRef = useRef<ReturnType<typeof createWs> | null>(null)
  const drawingRef = useRef(false)
  const sendIntervalRef = useRef<number | null>(null)
  // Position accumulated from gyroscope integration
  const posRef = useRef({ x: 0, y: 0, z: 0 })

  const startSending = useCallback(() => {
    if (sendIntervalRef.current) return
    console.log('[mobile] startSending at 30Hz')
    sendIntervalRef.current = window.setInterval(() => {
      const p = posRef.current
      const msg: PositionMsg = {
        type: 'position',
        alpha: p.x,
        beta: p.y,
        gamma: p.z,
        drawing: drawingRef.current,
      }
      wsRef.current?.send(msg)
    }, 1000 / 30)
  }, [])

  const stopSending = useCallback(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }
  }, [])

  const handleJoin = useCallback(() => {
    setPhase('loading')
    const ws = createWs('/ws', (data: ServerMsg) => {
      switch (data.type) {
        case '_connected':
          console.log('[mobile] WebSocket connected')
          break
        case '_disconnected':
          setPhase('error')
          setError('Connection lost. Reconnecting...')
          break
        case 'assigned':
          if ('color' in data) {
            console.log('[mobile] Assigned:', data.color, data.name)
            setColor(data.color)
            setName(data.name)
            setPhase('waiting')
          }
          break
        case 'go_live':
          console.log('[mobile] Go Live received')
          if (hasMotionSensor()) {
            setPhase('permission')
          } else {
            setPhase('painting')
            startSending()
          }
          break
        case 'stop':
          setPhase('waiting')
          stopSending()
          posRef.current = { x: 0, y: 0, z: 0 }
          break
        case 'error':
          if ('message' in data) {
            setError(data.message)
            setPhase('error')
          }
          break
      }
    })
    wsRef.current = ws
  }, [startSending, stopSending])

  const handleEnableBrush = useCallback(async () => {
    // Request permission for DeviceMotion (iOS 13+)
    const DME = DeviceMotionEvent as any
    if (typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission()
        if (result !== 'granted') {
          console.warn('[mobile] Motion permission denied')
        }
      } catch {
        console.warn('[mobile] Motion permission error')
      }
    }

    // Use gyroscope rotation rate — no gimbal lock, works in any orientation
    window.addEventListener('devicemotion', (e: DeviceMotionEvent) => {
      const rate = e.rotationRate
      if (!rate) return

      const interval = (e.interval || 16) / 1000 // seconds

      // Integrate rotation rate into position
      // alpha = yaw (Z rotation) → X position
      // beta = pitch (X rotation) → Y position
      // gamma = roll (Y rotation) → Z position
      const pos = posRef.current
      pos.x += (rate.alpha || 0) * interval * ROTATION_SCALE
      pos.y += (rate.beta || 0) * interval * ROTATION_SCALE
      pos.z += (rate.gamma || 0) * interval * ROTATION_SCALE

      // Slight decay toward center to prevent unbounded drift
      pos.x *= POSITION_DECAY
      pos.y *= POSITION_DECAY
      pos.z *= POSITION_DECAY

      // Clamp to [-1, 1]
      pos.x = Math.max(-1, Math.min(1, pos.x))
      pos.y = Math.max(-1, Math.min(1, pos.y))
      pos.z = Math.max(-1, Math.min(1, pos.z))

      setBrushPos({ x: pos.x, y: -pos.y })
    })

    setPhase('hint')
    setTimeout(() => {
      setPhase('painting')
      startSending()
    }, 3000)
  }, [startSending])

  const setIsDrawing = useCallback((value: boolean) => {
    drawingRef.current = value
    setDrawing(value)
  }, [])

  // Desktop mouse fallback
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
    posRef.current = { x: nx, y: ny, z: 0 }
    setBrushPos({ x: nx, y: -ny })
  }, [])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopSending()
    }
  }, [stopSending])

  const styles = {
    container: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      background: phase === 'waiting' || phase === 'painting' ? color : '#111',
      transition: 'background 0.5s ease',
      touchAction: 'none' as const,
      userSelect: 'none' as const,
    },
    title: { fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' },
    subtitle: { fontSize: '1rem', opacity: 0.8, textAlign: 'center' as const, padding: '0 2rem', lineHeight: 1.6 },
    button: {
      padding: '1rem 2.5rem',
      fontSize: '1.2rem',
      fontWeight: 700,
      border: 'none',
      borderRadius: '12px',
      background: '#fff',
      color: '#111',
      cursor: 'pointer',
      marginTop: '1.5rem',
    },
    brushDot: {
      position: 'absolute' as const,
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: `0 0 20px ${color}, 0 0 40px ${color}`,
      left: `${50 + brushPos.x * 40}%`,
      top: `${50 + brushPos.y * 40}%`,
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none' as const,
      opacity: drawing ? 1 : 0.4,
    },
    drawIndicator: {
      position: 'absolute' as const,
      bottom: 30,
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '0.9rem',
      opacity: 0.7,
      fontWeight: 600,
    },
  }

  if (phase === 'loading') {
    return <div style={styles.container}><div style={styles.title}>Connecting...</div></div>
  }

  if (phase === 'join') {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Collective Canvas 3D</div>
        <div style={styles.subtitle}>Move your phone to paint in 3D with everyone</div>
        <button style={styles.button} onClick={handleJoin}>Join</button>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div style={{ ...styles.container, animation: 'breathe 3s ease-in-out infinite' }}>
        <style>{`@keyframes breathe { 0%,100%{filter:brightness(0.9)} 50%{filter:brightness(1.1)} }`}</style>
        <div style={styles.title}>{name}</div>
        <div style={styles.subtitle}>
          You're in! The presenter will start the session soon.<br />
          Get ready to move your phone to paint in 3D.
        </div>
      </div>
    )
  }

  if (phase === 'permission') {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Ready!</div>
        <div style={styles.subtitle}>
          Tap below to enable your brush.<br />
          Your phone will ask for motion permission — tap Allow.
        </div>
        <button style={styles.button} onClick={handleEnableBrush}>Tap to enable your brush</button>
      </div>
    )
  }

  if (phase === 'hint') {
    return (
      <div style={styles.container}>
        <style>{`@keyframes tiltAnim { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-15deg)} 75%{transform:rotate(15deg)} }`}</style>
        <div style={{ fontSize: '4rem', animation: 'tiltAnim 1.5s ease-in-out infinite' }}>📱</div>
        <div style={{ ...styles.subtitle, marginTop: '1rem' }}>
          Move your phone like a wand to steer your brush.<br />Touch the screen to paint!
        </div>
      </div>
    )
  }

  if (phase === 'painting') {
    return (
      <div
        style={styles.container}
        onTouchStart={() => setIsDrawing(true)}
        onTouchEnd={() => setIsDrawing(false)}
        onMouseDown={() => setIsDrawing(true)}
        onMouseUp={() => setIsDrawing(false)}
        onMouseLeave={() => setIsDrawing(false)}
        onMouseMove={handleMouseMove}
      >
        <div style={styles.brushDot} />
        <div style={styles.drawIndicator}>
          {drawing ? '🎨 Painting...' : 'Touch to paint'}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.title}>Oops</div>
      <div style={styles.subtitle}>{error || "Can't reach the server — same WiFi?"}</div>
      <button style={styles.button} onClick={() => window.location.reload()}>Retry</button>
    </div>
  )
}
