import { Grid } from '@react-three/drei'

export function SceneHelpers() {
  return (
    <>
      <Grid
        args={[10, 10]}
        cellSize={0.5}
        cellColor="#333"
        sectionSize={1}
        sectionColor="#555"
        fadeDistance={15}
        position={[0, -2, 0]}
      />
      <axesHelper args={[2]} />
      <ambientLight intensity={0.1} />
    </>
  )
}
