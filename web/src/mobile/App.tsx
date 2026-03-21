import { useState, useRef, useCallback, useEffect } from 'react'
import { createWs } from '../shared/ws'
import type { ServerMsg, PositionMsg } from '../shared/types'

type Phase = 'loading' | 'join' | 'waiting' | 'permission' | 'hint' | 'painting' | 'error'

function hasMotionSensor(): boolean {
  return 'DeviceMotionEvent' in window && 'ontouchstart' in window
}

/*
 * AIRPLANE MODEL
 * - The brush is always moving forward at constant speed
 * - Phone tilt steers direction (pitch + yaw), like flight controls
 * - Tap = draw (leave trail), no tap = reposition silently
 * - Circle tilt → circle path. Natural curves, no integration drift.
 */

const AIRPLANE_SPEED = 0.6 // units/s — fast enough to feel responsive
const TURN_RATE = 4.0 // radians/s at max tilt — snappy steering

export function MobileApp() {
  const [phase, setPhase] = useState<Phase>('join')
  const [color, setColor] = useState('#666')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [brushPos, setBrushPos] = useState({ x: 0, y: 0 })
  const [debug, setDebug] = useState({ x: 0, y: 0, z: 0, h: 0, p: 0, tLR: 0, tFB: 0, rawA: 0, rawB: 0, rawG: 0 })
  // Store raw orientation for debug
  const rawOrientRef = useRef({ alpha: 0, beta: 0, gamma: 0 })
  const wsRef = useRef<ReturnType<typeof createWs> | null>(null)
  const drawingRef = useRef(false)
  const sendIntervalRef = useRef<number | null>(null)

  // Airplane state
  const planeRef = useRef({
    x: 0, y: 0, z: 0,       // position
    heading: 0,               // yaw angle (radians) — left/right
    pitch: 0,                 // pitch angle (radians) — up/down
    lastTime: 0,
    age: 0,                   // seconds since physics started — for speed ramp-up
  })

  // Neutral orientation captured at start
  const neutralRef = useRef({ alpha: 0, beta: 90, gamma: 0, captured: false, samples: 0, sumA: 0, sumB: 0, sumG: 0 })
  // Tilt commands (normalized -1 to 1)
  const tiltRef = useRef({ lr: 0, fb: 0 })

  const startSending = useCallback(() => {
    if (sendIntervalRef.current) return
    console.log('[mobile] startSending at 30Hz')
    sendIntervalRef.current = window.setInterval(() => {
      const p = planeRef.current
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
          planeRef.current = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, lastTime: 0, age: 0 }
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

  // Physics loop — runs at ~60Hz via rAF, updates airplane position
  const animFrameRef = useRef(0)

  const startPhysics = useCallback(() => {
    planeRef.current.lastTime = performance.now()

    const tick = () => {
      const now = performance.now()
      const dt = Math.min((now - planeRef.current.lastTime) / 1000, 0.05) // cap at 50ms
      planeRef.current.lastTime = now

      const plane = planeRef.current
      const tilt = tiltRef.current

      // Deadzone: ignore tiny tilt (prevents drift from sensor noise/bias)
      const DEADZONE = 0.12
      const lr = Math.abs(tilt.lr) < DEADZONE ? 0 : tilt.lr
      const fb = Math.abs(tilt.fb) < DEADZONE ? 0 : tilt.fb

      // Steer heading (yaw) — always responsive
      plane.heading += lr * TURN_RATE * dt

      // Pitch: strong input → steer, otherwise aggressively auto-level
      if (Math.abs(fb) > 0) {
        plane.pitch += fb * TURN_RATE * 0.7 * dt // pitch less sensitive than yaw
      }
      // Always auto-level pitch (even during input, to counteract bias)
      plane.pitch *= (1 - 4.0 * dt) // very aggressive decay ~0.25s to level

      // Clamp pitch
      plane.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, plane.pitch))

      // Speed ramps up from 0 over 3 seconds
      plane.age += dt
      const speedRamp = Math.min(1, plane.age / 3.0) // 0→1 over 3s
      const speed = AIRPLANE_SPEED * speedRamp

      // Velocity from heading + pitch
      const vx = Math.cos(plane.pitch) * Math.sin(plane.heading) * speed
      const vy = Math.sin(plane.pitch) * speed
      const vz = Math.cos(plane.pitch) * Math.cos(plane.heading) * speed

      // Update position
      plane.x += vx * dt
      plane.y += vy * dt
      plane.z += vz * dt

      // 3D bubble constraint — keep inside sphere of radius R
      const BUBBLE_R = 2.0
      const dist = Math.sqrt(plane.x * plane.x + plane.y * plane.y + plane.z * plane.z)
      if (dist > BUBBLE_R) {
        // Push back toward center + deflect heading inward
        const over = dist - BUBBLE_R
        const nx = plane.x / dist
        const ny = plane.y / dist
        const nz = plane.z / dist
        // Snap position to bubble surface
        plane.x = nx * BUBBLE_R
        plane.y = ny * BUBBLE_R
        plane.z = nz * BUBBLE_R
        // Reflect heading: steer toward center
        plane.heading = Math.atan2(-nx, -nz) // point back toward origin
        plane.pitch = Math.asin(-ny) * 0.5  // gently aim back down/up
      }

      // Update brush dot on screen (show x/y projection, scaled so ±2 fills screen)
      const screenScale = 0.5 // ±2 range fills the dot area
      setBrushPos({ x: plane.x * screenScale, y: -plane.y * screenScale })

      // Debug HUD update (throttle to ~10Hz)
      if (Math.random() < 0.16) {
        const t = tiltRef.current
        const r = rawOrientRef.current
        setDebug({
          x: plane.x, y: plane.y, z: plane.z,
          h: plane.heading, p: plane.pitch,
          tLR: t.lr, tFB: t.fb,
          rawA: r.alpha, rawB: r.beta, rawG: r.gamma,
        })
      }

      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const stopPhysics = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
  }, [])

  const handleEnableBrush = useCallback(async () => {
    // Request permission for DeviceOrientation (iOS 13+)
    const DOE = DeviceOrientationEvent as any
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') {
          console.warn('[mobile] Orientation permission denied')
        }
      } catch {
        console.warn('[mobile] Orientation permission error')
      }
    }

    // DeviceOrientation gives absolute angles — no integration, no drift
    // beta = forward/back tilt (0=flat, 90=upright), gamma = left/right (-90 to 90)
    window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
      const alpha = e.alpha ?? 0  // compass heading
      const beta = e.beta ?? 90   // forward/back tilt
      const gamma = e.gamma ?? 0  // left/right tilt

      // Store raw values for debug HUD
      rawOrientRef.current = { alpha, beta, gamma }

      // Calibrate: average first 20 samples as neutral hold position
      const neutral = neutralRef.current
      if (!neutral.captured) {
        neutral.samples++
        neutral.sumA += alpha
        neutral.sumB += beta
        neutral.sumG += gamma
        if (neutral.samples >= 20) {
          neutral.alpha = neutral.sumA / neutral.samples
          neutral.beta = neutral.sumB / neutral.samples
          neutral.gamma = neutral.sumG / neutral.samples
          neutral.captured = true
          console.log('[mobile] Neutral: a=', neutral.alpha.toFixed(1), 'b=', neutral.beta.toFixed(1), 'g=', neutral.gamma.toFixed(1))
        }
        return
      }

      // Use ALL axes for steering — pick whatever moves most
      // alpha (compass 0-360) → heading (handle wraparound)
      // beta (tilt forward/back) → pitch
      // gamma (tilt left/right) → also heading (redundant with alpha)
      const MAX_TILT = 35 // degrees for full steering

      // Alpha wraparound: handle 359→1 crossing
      let dAlpha = alpha - neutral.alpha
      if (dAlpha > 180) dAlpha -= 360
      if (dAlpha < -180) dAlpha += 360

      const dGamma = gamma - neutral.gamma
      const dBeta = beta - neutral.beta

      // LR steering: use whichever of alpha or gamma gives stronger signal
      const lrFromAlpha = -dAlpha / MAX_TILT  // negative: rotate clockwise = steer right
      const lrFromGamma = dGamma / MAX_TILT
      const lr = Math.abs(lrFromAlpha) > Math.abs(lrFromGamma) ? lrFromAlpha : lrFromGamma

      tiltRef.current.lr = Math.max(-1, Math.min(1, lr))
      tiltRef.current.fb = Math.max(-1, Math.min(1, -dBeta / MAX_TILT))
    })

    setPhase('hint')
    setTimeout(() => {
      setPhase('painting')
      startSending()
      startPhysics()
    }, 3000)
  }, [startSending, startPhysics])

  const setIsDrawing = useCallback((value: boolean) => {
    drawingRef.current = value
    setDrawing(value)
  }, [])

  // Desktop mouse fallback — mouse position directly steers tilt
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
    tiltRef.current.lr = nx
    tiltRef.current.fb = ny
  }, [])

  // Start physics for desktop too when painting starts without motion sensor
  useEffect(() => {
    if (phase === 'painting' && !hasMotionSensor() && !animFrameRef.current) {
      startPhysics()
    }
    return () => {
      if (phase !== 'painting') stopPhysics()
    }
  }, [phase, startPhysics, stopPhysics])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopSending()
      stopPhysics()
    }
  }, [stopSending, stopPhysics])

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
    headingIndicator: {
      position: 'absolute' as const,
      top: 20,
      right: 20,
      fontSize: '0.8rem',
      opacity: 0.5,
      fontFamily: 'monospace',
    },
  }

  if (phase === 'loading') {
    return <div style={styles.container}><div style={styles.title}>Connecting...</div></div>
  }

  if (phase === 'join') {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Collective Canvas 3D</div>
        <div style={styles.subtitle}>Pilot your brush through 3D space!<br/>Tilt to steer, touch to paint.</div>
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
          Get ready to pilot your brush through 3D.
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
        <div style={{ fontSize: '4rem', animation: 'tiltAnim 1.5s ease-in-out infinite' }}>✈️</div>
        <div style={{ ...styles.subtitle, marginTop: '1rem' }}>
          Your brush flies forward automatically.<br />
          Tilt to steer — touch to paint!
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
        <div style={{
          position: 'absolute' as const,
          top: 10, left: 10,
          fontSize: '0.65rem',
          fontFamily: 'monospace',
          opacity: 0.7,
          lineHeight: 1.5,
          pointerEvents: 'none' as const,
          textShadow: '0 0 4px rgba(0,0,0,0.8)',
        }}>
          pos: {debug.x.toFixed(2)}, {debug.y.toFixed(2)}, {debug.z.toFixed(2)}<br/>
          hdg: {(debug.h * 180 / Math.PI).toFixed(0)}° pit: {(debug.p * 180 / Math.PI).toFixed(0)}°<br/>
          tilt: LR={debug.tLR.toFixed(2)} FB={debug.tFB.toFixed(2)}<br/>
          raw: a={debug.rawA.toFixed(0)} b={debug.rawB.toFixed(0)} g={debug.rawG.toFixed(0)}
        </div>
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
