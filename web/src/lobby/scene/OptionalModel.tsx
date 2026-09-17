/**
 * Renders a glTF for an asset slot, or the procedural placeholder passed as
 * children when there is no model — which is the shipped state.
 *
 * The loader is code-split: a lobby with no manifest never downloads GLTFLoader
 * at all. A model that fails to load falls back to the placeholder rather than
 * leaving a hole in the room.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { AnimationMixer, LoopRepeat } from 'three'
import type { AnimationClip, Group, Mesh, Object3D } from 'three'

import type { AssetSlot } from '../assets/assetConfig'

interface Loaded {
  scene: Group
  clips: AnimationClip[]
}

interface Props {
  slot: AssetSlot
  reducedMotion: boolean
  /** The procedural geometry this slot replaces. */
  children: ReactNode
  /** Called once a model is in place, so the interface can say so. */
  onLoaded?: (slotId: string) => void
}

const DEG_TO_RAD = Math.PI / 180

export function OptionalModel({ slot, reducedMotion, children, onLoaded }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const mixer = useRef<AnimationMixer | null>(null)

  useEffect(() => {
    setLoaded(null)
    mixer.current = null

    const url = slot.url
    if (!url) return

    let cancelled = false
    let model: Group | null = null

    void (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const gltf = await new GLTFLoader().loadAsync(url)
        if (cancelled) {
          disposeTree(gltf.scene)
          return
        }
        model = gltf.scene
        model.traverse((child: Object3D) => {
          const mesh = child as Mesh
          if (mesh.isMesh) {
            mesh.castShadow = true
            mesh.receiveShadow = true
          }
        })
        setLoaded({ scene: model, clips: gltf.animations ?? [] })
        onLoaded?.(slot.id)
      } catch {
        // A slot that cannot load keeps its placeholder. Leaving a gap in the
        // room would be a worse failure than shipping the stand-in.
        if (!cancelled) setLoaded(null)
      }
    })()

    return () => {
      cancelled = true
      mixer.current?.stopAllAction()
      mixer.current = null
      if (model) disposeTree(model)
    }
  }, [slot.url, slot.id, onLoaded])

  // Drive the idle clip. Phase 1 plays exactly one animation; the other roles in
  // the mapping are declared for the character brief, not yet triggered.
  useEffect(() => {
    if (!loaded || loaded.clips.length === 0) {
      mixer.current = null
      return
    }

    const wanted = slot.animations.idle
    const clip =
      (wanted && loaded.clips.find((c) => c.name === wanted)) ?? loaded.clips[0] ?? null
    if (!clip) return

    const nextMixer = new AnimationMixer(loaded.scene)
    const action = nextMixer.clipAction(clip)
    action.setLoop(LoopRepeat, Infinity)
    action.play()
    if (reducedMotion) {
      // Hold the first frame: the character is posed, not animated.
      nextMixer.update(0)
      action.paused = true
    }
    mixer.current = nextMixer

    return () => {
      nextMixer.stopAllAction()
      if (mixer.current === nextMixer) mixer.current = null
    }
  }, [loaded, slot.animations.idle, reducedMotion])

  useFrame((_, delta) => {
    if (reducedMotion) return
    mixer.current?.update(Math.min(delta, 0.05))
  })

  if (!loaded) return <>{children}</>

  const { position, rotationDegrees, scale } = slot.transform
  const scaleTuple: [number, number, number] =
    typeof scale === 'number' ? [scale, scale, scale] : scale

  return (
    <primitive
      object={loaded.scene}
      position={position}
      rotation={[
        rotationDegrees[0] * DEG_TO_RAD,
        rotationDegrees[1] * DEG_TO_RAD,
        rotationDegrees[2] * DEG_TO_RAD,
      ]}
      scale={scaleTuple}
    />
  )
}

/** Release GPU memory for a model we are done with. */
function disposeTree(root: Object3D): void {
  root.traverse((child: Object3D) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((mat) => mat.dispose())
    else material?.dispose()
  })
}
