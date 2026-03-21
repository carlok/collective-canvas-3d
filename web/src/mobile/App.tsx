import { useState, useRef, useCallback, useEffect } from 'react'
import { createWs } from '../shared/ws'
import type { ServerMsg, PositionMsg } from '../shared/types'

type Phase = 'loading' | 'join' | 'waiting' | 'permission' | 'hint' | 'painting' | 'error'

export function MobileApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [color, setColor] = useState('#666')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [brushPos, setBrushPos] = useState({ x: 0, y: 0 })
  const wsRef = useRef<ReturnType<typeof createWs> | null>(null)
  const drawingRef = useRef(false)
  const sendIntervalRef = useRef<number | null>(null)
  const orientationRef = useRef({ alpha: 0, beta: 0, gamma: 0 })

  // Connect WebSocket
  const handleJoin = useCallback(() => {
    setPhase('loading')
    const ws = createWs('/ws', (data: ServerMsg) => {
      switch (data.type) {
        case '_connected':
          break
        case '_disconnected':
          setPhase('error')
          setError('Connection lost. Reconnecting...')
          break
        case 'assigned':
          if ('color' in data) {
            setColor(data.color)
            setName(data.name)
            setPhase('waiting')
          }
          break
        case 'go_live':
          setPhase('permission')
          break
        case 'stop':
          setPhase('waiting')
          stopSending()
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
  }, [])

  // Request orientation permission (iOS) — must be in direct click handler
  const handleEnableBrush = useCallback(async () => {
    const DOE = DeviceOrientationEvent as any
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') {
          // Fallback to touch mode — still allow painting
          console.warn('Orientation permission denied, using touch fallback')
        }
      } catch {
        console.warn('Orientation permission error, using touch fallback')
      }
    }

    // Start listening to orientation
    window.addEventListener('deviceorientation', handleOrientation)
    setPhase('hint')
    setTimeout(() => {
      setPhase('painting')
      startSending()
    }, 3000)
  }, [])

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    orientationRef.current = {
      alpha: e.alpha ?? 0,
      beta: e.beta ?? 0,
      gamma: e.gamma ?? 0,
    }
    // Update brush position indicator
    const nx = ((e.alpha ?? 0) / 180) - 1
    const ny = (e.beta ?? 0) / 90
    setBrushPos({ x: nx, y: ny })
  }, [])

  const startSending = useCallback(() => {
    if (sendIntervalRef.current) return
    sendIntervalRef.current = window.setInterval(() => {
      const o = orientationRef.current
      const msg: PositionMsg = {
        type: 'position',
        alpha: o.alpha,
        beta: o.beta,
        gamma: o.gamma,
        drawing: drawingRef.current,
      }
      wsRef.current?.send(msg)
    }, 1000 / 30) // 30Hz
  }, [])

  const stopSending = useCallback(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }
  }, [])

  // Touch handlers for pen up/down
  const handleTouchStart = useCallback(() => {
    drawingRef.current = true
  }, [])

  const handleTouchEnd = useCallback(() => {
    drawingRef.current = false
  }, [])

  // Mouse fallback for desktop testing
  const handleMouseDown = useCallback(() => {
    drawingRef.current = true
  }, [])

  const handleMouseUp = useCallback(() => {
    drawingRef.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Map mouse position to orientation values for desktop fallback
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 360
    const ny = ((e.clientY - rect.top) / rect.height) * 180 - 90
    orientationRef.current = { alpha: nx, beta: ny, gamma: 0 }
    setBrushPos({
      x: (nx / 180) - 1,
      y: ny / 90,
    })
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopSending()
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    setPhase('join')
  }, [])

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
      width: 20,
      height: 20,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: `0 0 20px ${color}, 0 0 40px ${color}`,
      left: `${50 + brushPos.x * 30}%`,
      top: `${50 - brushPos.y * 30}%`,
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none' as const,
      opacity: drawingRef.current ? 1 : 0.4,
    },
    drawIndicator: {
      position: 'absolute' as const,
      bottom: 30,
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '0.9rem',
      opacity: 0.6,
    },
  }

  if (phase === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Connecting...</div>
      </div>
    )
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
        <style>{`
          @keyframes breathe {
            0%, 100% { filter: brightness(0.9); }
            50% { filter: brightness(1.1); }
          }
        `}</style>
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
        <button style={styles.button} onClick={handleEnableBrush}>
          Tap to enable your brush
        </button>
      </div>
    )
  }

  if (phase === 'hint') {
    return (
      <div style={styles.container}>
        <style>{`
          @keyframes tiltAnim {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(-15deg); }
            75% { transform: rotate(15deg); }
          }
        `}</style>
        <div style={{ fontSize: '4rem', animation: 'tiltAnim 1.5s ease-in-out infinite' }}>
          📱
        </div>
        <div style={{ ...styles.subtitle, marginTop: '1rem' }}>
          Tilt and move your phone to steer your brush.<br />
          Touch the screen to paint!
        </div>
      </div>
    )
  }

  if (phase === 'painting') {
    return (
      <div
        style={styles.container}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        <div style={styles.brushDot} />
        <div style={styles.drawIndicator}>
          {drawingRef.current ? 'Painting...' : 'Touch to paint'}
        </div>
      </div>
    )
  }

  // Error
  return (
    <div style={styles.container}>
      <div style={styles.title}>Oops</div>
      <div style={styles.subtitle}>{error || "Can't reach the server — same WiFi?"}</div>
      <button style={styles.button} onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  )
}
