import { useRef, useMemo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ParticipantSnapshot } from './types'

const MAX_PARTICLES = 30000
const PARTICLE_LIFETIME = 5.0 // seconds
const PARTICLES_PER_EMIT = 4
const SCALE_FACTOR = 2.0 // scale normalized coords to world space

interface ParticleSystemProps {
  snapshotRef: React.MutableRefObject<ParticipantSnapshot[]>
}

export function ParticleSystem({ snapshotRef }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const nextSlot = useRef(0)

  const { positions, colors, sizes, ages } = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3)
    const colors = new Float32Array(MAX_PARTICLES * 3)
    const sizes = new Float32Array(MAX_PARTICLES)
    const ages = new Float32Array(MAX_PARTICLES).fill(PARTICLE_LIFETIME + 1) // all dead
    return { positions, colors, sizes, ages }
  }, [])

  const tmpColor = useMemo(() => new THREE.Color(), [])

  const emit = useCallback((x: number, y: number, z: number, color: string) => {
    for (let i = 0; i < PARTICLES_PER_EMIT; i++) {
      const slot = nextSlot.current % MAX_PARTICLES
      nextSlot.current++

      // Position with slight randomness for volume
      const jitter = 0.02
      positions[slot * 3] = x * SCALE_FACTOR + (Math.random() - 0.5) * jitter
      positions[slot * 3 + 1] = y * SCALE_FACTOR + (Math.random() - 0.5) * jitter
      positions[slot * 3 + 2] = z * SCALE_FACTOR + (Math.random() - 0.5) * jitter

      tmpColor.set(color)
      colors[slot * 3] = tmpColor.r
      colors[slot * 3 + 1] = tmpColor.g
      colors[slot * 3 + 2] = tmpColor.b

      sizes[slot] = 3.0 + Math.random() * 2.0
      ages[slot] = 0
    }
  }, [positions, colors, sizes, ages, tmpColor])

  useFrame((_, delta) => {
    // Emit particles from drawing participants
    const snapshot = snapshotRef.current
    for (const p of snapshot) {
      if (p.drawing) {
        emit(p.x, p.y, p.z, p.color)
      }
    }

    // Age particles and update sizes
    let needsUpdate = false
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] <= PARTICLE_LIFETIME) {
        ages[i] += delta
        const life = 1.0 - ages[i] / PARTICLE_LIFETIME
        if (life <= 0) {
          sizes[i] = 0
        } else {
          sizes[i] = life * (3.0 + Math.random() * 0.5)
          // Slight upward drift
          positions[i * 3 + 1] += delta * 0.03
        }
        needsUpdate = true
      }
    }

    const points = pointsRef.current
    if (points && needsUpdate) {
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
            gl_PointSize = size * (200.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.1, d);
            gl_FragColor = vec4(vColor, alpha * 0.8);
          }
        `}
      />
    </points>
  )
}
