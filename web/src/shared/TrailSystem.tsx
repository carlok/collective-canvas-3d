import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ParticipantSnapshot } from './types'

/*
 * Graph-style trail: NODES (spheres) + EDGES (cylinders) connecting them.
 * Looks like a connected 3D graph/skeleton, not disconnected dots.
 */

const MAX_NODES = 40000
const MAX_EDGES = 40000
const TRAIL_LIFETIME = 14.0 // seconds
const SCALE_FACTOR = 3.0
const NODE_RADIUS = 0.035
const EDGE_RADIUS = 0.012

interface TrailSystemProps {
  snapshotRef: React.MutableRefObject<ParticipantSnapshot[]>
}

interface BrushTrail {
  x: number; y: number; z: number
  tx: number; ty: number; tz: number
  drawing: boolean
  wasDrawing: boolean
  color: string
  lastNodeSlot: number // index of last emitted node for edge connection
}

export function TrailSystem({ snapshotRef }: TrailSystemProps) {
  const nodesRef = useRef<THREE.InstancedMesh>(null)
  const edgesRef = useRef<THREE.InstancedMesh>(null)
  const nextNode = useRef(0)
  const nextEdge = useRef(0)
  const brushes = useRef<Map<string, BrushTrail>>(new Map())

  // Node data
  const nodeData = useMemo(() => ({
    ages: new Float32Array(MAX_NODES).fill(TRAIL_LIFETIME + 1),
    positions: new Float32Array(MAX_NODES * 3),
    colors: new Float32Array(MAX_NODES * 3),
  }), [])

  // Edge data
  const edgeData = useMemo(() => ({
    ages: new Float32Array(MAX_EDGES).fill(TRAIL_LIFETIME + 1),
    colors: new Float32Array(MAX_EDGES * 3),
  }), [])

  const tmpMatrix = useMemo(() => new THREE.Matrix4(), [])
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const tmpVec = useMemo(() => new THREE.Vector3(), [])
  const tmpQuat = useMemo(() => new THREE.Quaternion(), [])
  const tmpScale = useMemo(() => new THREE.Vector3(), [])
  const upVec = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const zeroScale = useMemo(() => {
    const m = new THREE.Matrix4()
    m.makeScale(0, 0, 0)
    return m
  }, [])

  // Initialize all instances invisible
  useEffect(() => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    if (!nodes || !edges) return
    const m = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_NODES; i++) nodes.setMatrixAt(i, m)
    for (let i = 0; i < MAX_EDGES; i++) edges.setMatrixAt(i, m)
    nodes.instanceMatrix.needsUpdate = true
    edges.instanceMatrix.needsUpdate = true
  }, [])

  function emitNode(x: number, y: number, z: number, color: string): number {
    const slot = nextNode.current % MAX_NODES
    nextNode.current++

    const pi = slot * 3
    nodeData.positions[pi] = x
    nodeData.positions[pi + 1] = y
    nodeData.positions[pi + 2] = z

    tmpColor.set(color)
    nodeData.colors[pi] = tmpColor.r
    nodeData.colors[pi + 1] = tmpColor.g
    nodeData.colors[pi + 2] = tmpColor.b

    tmpMatrix.makeTranslation(x, y, z)
    const nodes = nodesRef.current
    if (nodes) {
      nodes.setMatrixAt(slot, tmpMatrix)
      nodes.setColorAt(slot, tmpColor)
    }
    nodeData.ages[slot] = 0
    return slot
  }

  function emitEdge(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: string) {
    const slot = nextEdge.current % MAX_EDGES
    nextEdge.current++

    const dx = x2 - x1
    const dy = y2 - y1
    const dz = z2 - z1
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (length < 0.0001) return

    // Midpoint
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const mz = (z1 + z2) / 2

    // Orient cylinder from up-axis to direction
    tmpVec.set(dx / length, dy / length, dz / length)
    tmpQuat.setFromUnitVectors(upVec, tmpVec)
    tmpScale.set(1, length, 1) // stretch along Y (cylinder height axis)

    tmpMatrix.compose(
      new THREE.Vector3(mx, my, mz),
      tmpQuat,
      tmpScale
    )

    tmpColor.set(color)
    const ci = slot * 3
    edgeData.colors[ci] = tmpColor.r
    edgeData.colors[ci + 1] = tmpColor.g
    edgeData.colors[ci + 2] = tmpColor.b

    const edges = edgesRef.current
    if (edges) {
      edges.setMatrixAt(slot, tmpMatrix)
      edges.setColorAt(slot, tmpColor)
    }
    edgeData.ages[slot] = 0
  }

  // Reusable vectors for compose (avoid alloc in fade loop)
  const fadePos = useMemo(() => new THREE.Vector3(), [])
  const fadeQuat = useMemo(() => new THREE.Quaternion(), [])
  const fadeScale = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const snapshot = snapshotRef.current
    const states = brushes.current
    const nodes = nodesRef.current
    const edges = edgesRef.current
    if (!nodes || !edges) return

    const activeIds = new Set<string>()
    for (const p of snapshot) {
      activeIds.add(p.id)
      const sx = p.x * SCALE_FACTOR
      const sy = p.y * SCALE_FACTOR
      const sz = p.z * SCALE_FACTOR
      let state = states.get(p.id)
      if (!state) {
        state = {
          x: sx, y: sy, z: sz,
          tx: sx, ty: sy, tz: sz,
          drawing: p.drawing, wasDrawing: false,
          color: p.color, lastNodeSlot: -1,
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

    // Lerp and emit graph elements
    const lerpSpeed = 8.0
    const MIN_NODE_SPACING = 0.03 // minimum distance between nodes

    for (const state of states.values()) {
      const prevX = state.x
      const prevY = state.y
      const prevZ = state.z

      state.x += (state.tx - state.x) * Math.min(1, lerpSpeed * delta)
      state.y += (state.ty - state.y) * Math.min(1, lerpSpeed * delta)
      state.z += (state.tz - state.z) * Math.min(1, lerpSpeed * delta)

      if (state.drawing) {
        if (!state.wasDrawing) {
          // First point of a stroke — emit node, no edge
          state.lastNodeSlot = emitNode(state.x, state.y, state.z, state.color)
        } else {
          // Check distance from last node
          const li = state.lastNodeSlot * 3
          const lx = nodeData.positions[li]
          const ly = nodeData.positions[li + 1]
          const lz = nodeData.positions[li + 2]
          const dx = state.x - lx
          const dy = state.y - ly
          const dz = state.z - lz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

          if (dist >= MIN_NODE_SPACING) {
            // Emit edge from last node to current position
            emitEdge(lx, ly, lz, state.x, state.y, state.z, state.color)
            // Emit new node
            state.lastNodeSlot = emitNode(state.x, state.y, state.z, state.color)
          }
        }
      } else {
        state.lastNodeSlot = -1
      }

      state.wasDrawing = state.drawing
    }

    // Fade nodes
    let nodeColorDirty = false
    for (let i = 0; i < MAX_NODES; i++) {
      if (nodeData.ages[i] <= TRAIL_LIFETIME) {
        nodeData.ages[i] += delta
        const life = 1.0 - nodeData.ages[i] / TRAIL_LIFETIME

        if (life <= 0) {
          nodes.setMatrixAt(i, zeroScale)
        } else {
          const fade = life * life
          const scale = 0.4 + fade * 0.6
          const pi = i * 3
          fadePos.set(nodeData.positions[pi], nodeData.positions[pi + 1], nodeData.positions[pi + 2])
          fadeQuat.identity()
          fadeScale.set(scale, scale, scale)
          tmpMatrix.compose(fadePos, fadeQuat, fadeScale)
          nodes.setMatrixAt(i, tmpMatrix)

          tmpColor.setRGB(
            nodeData.colors[pi] * fade,
            nodeData.colors[pi + 1] * fade,
            nodeData.colors[pi + 2] * fade
          )
          nodes.setColorAt(i, tmpColor)
          nodeColorDirty = true
        }
      }
    }

    // Fade edges
    let edgeColorDirty = false
    for (let i = 0; i < MAX_EDGES; i++) {
      if (edgeData.ages[i] <= TRAIL_LIFETIME) {
        edgeData.ages[i] += delta
        const life = 1.0 - edgeData.ages[i] / TRAIL_LIFETIME

        if (life <= 0) {
          edges.setMatrixAt(i, zeroScale)
        } else {
          const fade = life * life
          // Shrink edge radius but keep length — decompose, rescale X/Z only
          edges.getMatrixAt(i, tmpMatrix)
          tmpMatrix.decompose(fadePos, fadeQuat, fadeScale)
          const yLen = fadeScale.y // preserve original length
          const radScale = 0.3 + fade * 0.7
          fadeScale.set(radScale, yLen, radScale)
          tmpMatrix.compose(fadePos, fadeQuat, fadeScale)
          edges.setMatrixAt(i, tmpMatrix)

          const ci = i * 3
          tmpColor.setRGB(
            edgeData.colors[ci] * fade,
            edgeData.colors[ci + 1] * fade,
            edgeData.colors[ci + 2] * fade
          )
          edges.setColorAt(i, tmpColor)
          edgeColorDirty = true
        }
      }
    }

    nodes.instanceMatrix.needsUpdate = true
    edges.instanceMatrix.needsUpdate = true
    if (nodeColorDirty && nodes.instanceColor) nodes.instanceColor.needsUpdate = true
    if (edgeColorDirty && edges.instanceColor) edges.instanceColor.needsUpdate = true
  })

  const nodeGeo = useMemo(() => new THREE.SphereGeometry(NODE_RADIUS, 8, 6), [])
  // Cylinder: radius at top/bottom, height=1 (scaled per edge), segments
  const edgeGeo = useMemo(() => new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, 1, 5, 1), [])

  return (
    <>
      {/* Nodes */}
      <instancedMesh
        ref={nodesRef}
        args={[nodeGeo, undefined, MAX_NODES]}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Edges */}
      <instancedMesh
        ref={edgesRef}
        args={[edgeGeo, undefined, MAX_EDGES]}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  )
}
