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
import { composeFacePose, createMorphFaceRig } from '../reception/faceRig'
import { sampleLipSync, sampleNativeVisemes } from '../reception/lipSync'
import { createSkeletonPoser } from '../reception/skeletonPoser'
import type { ReceptionSignal } from '../reception/signal'
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
      } catch (error) {
        // A character that cannot load leaves the generated one standing. An
        // empty space behind the counter would be a worse failure.
        //
        // But it says so. Failing silently here means a manifest pointing at a
        // real file that the loader cannot read is indistinguishable from a
        // manifest pointing at nothing, and the room looks identical either
        // way — which cost real time to diagnose once already.
        if (!cancelled) {
          console.warn(`[lobby] character ${url} could not be loaded; keeping the generated one.`, error)
          setLoaded(null)
        }
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

  /**
   * A character that supplied no clips is posed in code instead.
   *
   * Without this it stands in its bind pose — arms straight out — for the whole
   * visit, which reads as a scarecrow rather than a receptionist. The poser is
   * built only when there is nothing to play, so a properly authored character
   * is never second-guessed by it.
   */
  const poser = useMemo(
    () => (capability.rolesProvided.length === 0 ? createSkeletonPoser(loaded.scene) : null),
    [capability.rolesProvided.length, loaded.scene],
  )

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

    if (poser?.usable) {
      poser.apply({
        role: controller.role,
        roleElapsed: controller.roleElapsed,
        time: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
        reducedMotion,
      })
    }

    if (faceRig.controls.length === 0) return

    approachPose(scratch.expression, STATE_EXPRESSIONS[signal.state], EXPRESSION_RATE, dt)

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const mouth = reducedMotion
      ? null
      : useNative
        ? sampleNativeVisemes(signal, now)
        : sampleLipSync(signal, now)

    const applied = composeFacePose(scratch.applied as Record<string, number>, scratch.expression, mouth)

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
