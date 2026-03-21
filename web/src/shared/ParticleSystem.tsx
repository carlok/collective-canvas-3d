import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ParticipantSnapshot } from './types'

const MAX_PARTICLES = 30000
const PARTICLE_LIFETIME = 5.0
const SCALE_FACTOR = 2.0

interface ParticleSystemProps {
  snapshotRef: React.MutableRefObject<ParticipantSnapshot[]>
}

// Interpolated position per participant for smooth trails
interface LerpState {
  x: number; y: number; z: number       // current interpolated position
  tx: number; ty: number; tz: number     // target position from latest snapshot
  color: string
  drawing: boolean
}

export function ParticleSystem({ snapshotRef }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const nextSlot = useRef(0)
  const lerpStates = useRef<Map<string, LerpState>>(new Map())
  const logTimer = useRef(0)

  const { positions, colors, sizes, ages } = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3)
    const colors = new Float32Array(MAX_PARTICLES * 3)
    const sizes = new Float32Array(MAX_PARTICLES)
    const ages = new Float32Array(MAX_PARTICLES).fill(PARTICLE_LIFETIME + 1)
    return { positions, colors, sizes, ages }
  }, [])

  const tmpColor = useMemo(() => new THREE.Color(), [])

  useFrame((_, delta) => {
    const snapshot = snapshotRef.current
    const states = lerpStates.current

    // Update targets from latest snapshot
    const activeIds = new Set<string>()
    for (const p of snapshot) {
      activeIds.add(p.id)
      let state = states.get(p.id)
      if (!state) {
        // New participant — snap to position
        state = {
          x: p.x * SCALE_FACTOR, y: p.y * SCALE_FACTOR, z: p.z * SCALE_FACTOR,
          tx: p.x * SCALE_FACTOR, ty: p.y * SCALE_FACTOR, tz: p.z * SCALE_FACTOR,
          color: p.color,
          drawing: p.drawing,
        }
        states.set(p.id, state)
      } else {
        state.tx = p.x * SCALE_FACTOR
        state.ty = p.y * SCALE_FACTOR
        state.tz = p.z * SCALE_FACTOR
        state.drawing = p.drawing
        state.color = p.color
      }
    }

    // Remove stale participants
    for (const id of states.keys()) {
      if (!activeIds.has(id)) states.delete(id)
    }

    // Lerp positions and emit particles
    const lerpSpeed = 12.0 // higher = snappier following
    for (const state of states.values()) {
      // Smooth interpolation toward target
      state.x += (state.tx - state.x) * Math.min(1, lerpSpeed * delta)
      state.y += (state.ty - state.y) * Math.min(1, lerpSpeed * delta)
      state.z += (state.tz - state.z) * Math.min(1, lerpSpeed * delta)

      if (state.drawing) {
        // Emit 1 particle per frame per participant (not 4)
        const slot = nextSlot.current % MAX_PARTICLES
        nextSlot.current++

        const jitter = 0.03
        positions[slot * 3] = state.x + (Math.random() - 0.5) * jitter
        positions[slot * 3 + 1] = state.y + (Math.random() - 0.5) * jitter
        positions[slot * 3 + 2] = state.z + (Math.random() - 0.5) * jitter

        tmpColor.set(state.color)
        colors[slot * 3] = tmpColor.r
        colors[slot * 3 + 1] = tmpColor.g
        colors[slot * 3 + 2] = tmpColor.b

        sizes[slot] = 6.0 + Math.random() * 3.0
        ages[slot] = 0
      }
    }

    // Debug log
    logTimer.current += delta
    if (logTimer.current > 3) {
      logTimer.current = 0
      const drawingCount = Array.from(states.values()).filter(s => s.drawing).length
      if (states.size > 0) {
        console.log(`[particles] ${states.size} participants, ${drawingCount} drawing, ${nextSlot.current} total emitted`)
      }
    }

    // Age and fade particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] <= PARTICLE_LIFETIME) {
        ages[i] += delta
        const life = 1.0 - ages[i] / PARTICLE_LIFETIME
        if (life <= 0) {
          sizes[i] = 0
        } else {
          sizes[i] = life * (6.0 + Math.random() * 0.5)
          // Slight upward drift for smoke effect
          positions[i * 3 + 1] += delta * 0.02
        }
      }
    }

    // Update GPU buffers
    const points = pointsRef.current
    if (points) {
      const geom = points.geometry
      geom.attributes.position.needsUpdate = true
      geom.attributes.color.needsUpdate = true
      geom.attributes.size.needsUpdate = true
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={MAX_PARTICLES}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={MAX_PARTICLES}
          array={colors}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={MAX_PARTICLES}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          attribute float size;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor, alpha * 0.9);
          }
        `}
      />
    </points>
  )
}
