import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ParticipantSnapshot } from './types'

const MAX_PARTICLES = 100000
const PARTICLE_LIFETIME = 2.0
const SCALE_FACTOR = 3.0 // wider world space

interface ParticleSystemProps {
  snapshotRef: React.MutableRefObject<ParticipantSnapshot[]>
}

interface BrushState {
  // Previous emit position (for line emission)
  px: number; py: number; pz: number
  // Current interpolated position
  x: number; y: number; z: number
  // Target from snapshot
  tx: number; ty: number; tz: number
  color: string
  drawing: boolean
  wasDrawing: boolean
}

export function ParticleSystem({ snapshotRef }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const nextSlot = useRef(0)
  const brushes = useRef<Map<string, BrushState>>(new Map())

  const { positions, colors, sizes, ages } = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3)
    const colors = new Float32Array(MAX_PARTICLES * 3)
    const sizes = new Float32Array(MAX_PARTICLES)
    const ages = new Float32Array(MAX_PARTICLES).fill(PARTICLE_LIFETIME + 1)
    return { positions, colors, sizes, ages }
  }, [])

  const tmpColor = useMemo(() => new THREE.Color(), [])

  function emitAt(x: number, y: number, z: number, color: THREE.Color) {
    const slot = nextSlot.current % MAX_PARTICLES
    nextSlot.current++
    const jitter = 0.02
    positions[slot * 3] = x + (Math.random() - 0.5) * jitter
    positions[slot * 3 + 1] = y + (Math.random() - 0.5) * jitter
    positions[slot * 3 + 2] = z + (Math.random() - 0.5) * jitter
    colors[slot * 3] = color.r
    colors[slot * 3 + 1] = color.g
    colors[slot * 3 + 2] = color.b
    sizes[slot] = 0.4 + Math.random() * 0.2
    ages[slot] = 0
  }

  useFrame((_, delta) => {
    const snapshot = snapshotRef.current
    const states = brushes.current

    // Update targets
    const activeIds = new Set<string>()
    for (const p of snapshot) {
      activeIds.add(p.id)
      const sx = p.x * SCALE_FACTOR
      const sy = p.y * SCALE_FACTOR
      const sz = p.z * SCALE_FACTOR
      let state = states.get(p.id)
      if (!state) {
        state = {
          px: sx, py: sy, pz: sz,
          x: sx, y: sy, z: sz,
          tx: sx, ty: sy, tz: sz,
          color: p.color, drawing: p.drawing, wasDrawing: false,
        }
        states.set(p.id, state)
      } else {
        state.tx = sx
        state.ty = sy
        state.tz = sz
        state.drawing = p.drawing
        state.color = p.color
      }
    }

    for (const id of states.keys()) {
      if (!activeIds.has(id)) states.delete(id)
    }

    // Lerp and emit
    const lerpSpeed = 8.0
    for (const state of states.values()) {
      // Save previous position before lerp
      const prevX = state.x
      const prevY = state.y
      const prevZ = state.z

      // Interpolate toward target
      state.x += (state.tx - state.x) * Math.min(1, lerpSpeed * delta)
      state.y += (state.ty - state.y) * Math.min(1, lerpSpeed * delta)
      state.z += (state.tz - state.z) * Math.min(1, lerpSpeed * delta)

      if (state.drawing) {
        tmpColor.set(state.color)

        if (!state.wasDrawing) {
          // Just started drawing — emit at current position, set prev
          state.px = state.x
          state.py = state.y
          state.pz = state.z
          emitAt(state.x, state.y, state.z, tmpColor)
        } else {
          // Line emission: emit particles along the line from prev to current
          const dx = state.x - state.px
          const dy = state.y - state.py
          const dz = state.z - state.pz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

          // Emit every ~0.02 world units along the line, minimum 1
          const spacing = 0.005
          const count = Math.max(2, Math.ceil(dist / spacing))

          for (let i = 0; i < count; i++) {
            const t = count === 1 ? 1 : i / (count - 1)
            const ex = state.px + dx * t
            const ey = state.py + dy * t
            const ez = state.pz + dz * t
            emitAt(ex, ey, ez, tmpColor)
          }
        }

        // Update previous position
        state.px = state.x
        state.py = state.y
        state.pz = state.z
      }

      state.wasDrawing = state.drawing
    }

    // Age and fade
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] <= PARTICLE_LIFETIME) {
        ages[i] += delta
        const life = 1.0 - ages[i] / PARTICLE_LIFETIME
        if (life <= 0) {
          sizes[i] = 0
        } else {
          sizes[i] = life * (1.0 + Math.random() * 0.2)
          positions[i * 3 + 1] += delta * 0.015
        }
      }
    }

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
            gl_PointSize = size * (30.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor, alpha * 0.35);
          }
        `}
      />
    </points>
  )
}
