/**
 * The receptionist slot: a supplied character if there is one, the generated
 * one otherwise.
 *
 * The important part is that *neither path is privileged*. Both are probed for
 * what they can actually do, both are driven by the same animation controller
 * and the same lip-sync driver, and both report their capability upwards so the
 * interface can say plainly what the visitor is looking at. A supplied model
 * that turns out to have no viseme shapes gets captions, exactly as the
 * generated one would if its face were removed.
 *
 * The loader is code-split, so a lobby with no character model never downloads
 * GLTFLoader at all.
 */
import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AnimationMixer } from 'three'
import type { AnimationClip, Group, Mesh, Object3D } from 'three'

import type { AssetSlot } from '../assets/assetConfig'
import { createReceptionAnimationController } from '../reception/animationController'
import { NO_CHARACTER, describeGltfCharacter } from '../reception/capability'
import type { CharacterCapability } from '../reception/capability'
import { EXPRESSION_RATE, STATE_EXPRESSIONS, approachPose, emptyPose } from '../reception/expressions'
import { createMorphFaceRig } from '../reception/faceRig'
import { sampleLipSync, sampleNativeVisemes } from '../reception/lipSync'
import type { ReceptionSignal } from '../reception/signal'
import { FACE_CONTROLS } from '../reception/visemes'
import { ProceduralReceptionist } from './Receptionist'

interface Props {
  slot: AssetSlot
  signal: ReceptionSignal
  reducedMotion: boolean
  onCapability?: (capability: CharacterCapability) => void
}

interface Loaded {
  scene: Group
  clips: AnimationClip[]
}

const DEG_TO_RAD = Math.PI / 180

export function ReceptionistSlot({ slot, signal, reducedMotion, onCapability }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    setLoaded(null)
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
      } catch {
        // A character that cannot load leaves the generated one standing. An
        // empty space behind the counter would be a worse failure.
        if (!cancelled) setLoaded(null)
      }
    })()

    return () => {
      cancelled = true
      if (model) disposeTree(model)
    }
  }, [slot.url])

  if (!loaded) {
    return (
      <ProceduralReceptionist signal={signal} reducedMotion={reducedMotion} onCapability={onCapability} />
    )
  }

  return (
    <SuppliedCharacter
      slot={slot}
      loaded={loaded}
      signal={signal}
      reducedMotion={reducedMotion}
      onCapability={onCapability}
    />
  )
}

function SuppliedCharacter({
  slot,
  loaded,
  signal,
  reducedMotion,
  onCapability,
}: Props & { loaded: Loaded }) {
  const capability = useMemo(
    () => describeGltfCharacter(loaded.scene, loaded.clips, slot.animations, slot.url ?? 'character'),
    [loaded, slot.animations, slot.url],
  )

  const mixer = useMemo(() => new AnimationMixer(loaded.scene), [loaded])

  const controller = useMemo(
    () =>
      createReceptionAnimationController({
        capability,
        mixer,
        clips: loaded.clips,
        reducedMotion,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capability, mixer, loaded.clips],
  )

  const faceRig = useMemo(() => {
    const meshes: Mesh[] = []
    loaded.scene.traverse((child: Object3D) => {
      const mesh = child as Mesh & { morphTargetDictionary?: Record<string, number> }
      if (mesh.isMesh && mesh.morphTargetDictionary) meshes.push(mesh)
    })
    return createMorphFaceRig(meshes)
  }, [loaded])

  const useNative = capability.face.nativeVisemes.length >= 8

  useEffect(() => {
    controller.setReducedMotion(reducedMotion)
  }, [controller, reducedMotion])

  // Same as the procedural character: unmounting is a capability change too.
  useEffect(() => {
    onCapability?.(capability)
    return () => onCapability?.(NO_CHARACTER)
  }, [capability, onCapability])

  useEffect(() => () => controller.dispose(), [controller])

  const scratch = useMemo(
    () => ({ expression: emptyPose(), applied: emptyPose(), lastRevision: -1 }),
    [],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    if (signal.stateRevision !== scratch.lastRevision) {
      scratch.lastRevision = signal.stateRevision
      controller.setState(signal.state)
    }
    controller.update(dt)

    if (faceRig.controls.length === 0) return

    approachPose(scratch.expression, STATE_EXPRESSIONS[signal.state], EXPRESSION_RATE, dt)
    const applied = scratch.applied as Record<string, number>
    for (const control of FACE_CONTROLS) applied[control] = scratch.expression[control]

    if (!reducedMotion) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const mouth = useNative ? sampleNativeVisemes(signal, now) : sampleLipSync(signal, now)
      for (const [key, value] of Object.entries(mouth)) {
        const total = (applied[key] ?? 0) + (value ?? 0)
        applied[key] = total > 1 ? 1 : total
      }
    }

    faceRig.apply(applied)
  })

  const { position, rotationDegrees, scale } = slot.transform
  const scaleTuple: [number, number, number] = typeof scale === 'number' ? [scale, scale, scale] : scale

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
