/**
 * One interface over two very different faces.
 *
 * A supplied glTF moves its face by writing morph-target influences. The
 * lobby's own character moves part of its face the same way and the rest —
 * eyelids, brows, gaze, the mouth aperture — by moving small meshes, because a
 * blendshape for "the eyelid rotates" is a worse way to rotate an eyelid.
 *
 * Everything upstream of here works in ARKit control names and does not know
 * or care which is which. What a rig cannot move, it does not list in
 * `controls`, and `capability.ts` reads that list rather than a manifest — so a
 * control that does not exist is never driven and never claimed.
 */
import type { Mesh } from 'three'

import type { FaceControl } from './visemes'
import { FACE_CONTROLS } from './visemes'

export interface FaceRig {
  /** Controls this rig can actually move. */
  readonly controls: readonly string[]
  /** Apply a complete pose. Anything absent is treated as zero. */
  apply(pose: Readonly<Record<string, number>>): void
}

type MorphTargetMesh = Mesh & {
  morphTargetDictionary?: Record<string, number>
  morphTargetInfluences?: number[]
}

/**
 * A rig over whatever morph targets a loaded model turned out to have.
 *
 * Names come from `morphTargetDictionary`, which three.js fills from the glTF's
 * `extras.targetNames`. A model without those names reaches here with an empty
 * dictionary and produces a rig with no controls, which is the correct answer:
 * the shapes exist but nothing can say which is which.
 */
export function createMorphFaceRig(meshes: readonly MorphTargetMesh[]): FaceRig {
  const targets = new Map<string, { influences: number[]; index: number }[]>()

  for (const mesh of meshes) {
    const dictionary = mesh.morphTargetDictionary
    const influences = mesh.morphTargetInfluences
    if (!dictionary || !influences) continue
    for (const [name, index] of Object.entries(dictionary)) {
      const list = targets.get(name) ?? []
      list.push({ influences, index })
      targets.set(name, list)
    }
  }

  const controls = [...targets.keys()]

  return {
    controls,
    apply(pose) {
      for (const [name, slots] of targets) {
        const value = pose[name] ?? 0
        for (const slot of slots) slot.influences[slot.index] = value
      }
    },
  }
}

/** A rig that can move nothing. Used when no character is mounted. */
export const NULL_FACE_RIG: FaceRig = {
  controls: [],
  apply() {
    // Nothing to move.
  },
}

/**
 * Combine several rigs into one.
 *
 * The procedural character is built from a morph-target head plus a handful of
 * transform-driven parts; this is what lets it present a single control list.
 */
export function combineFaceRigs(rigs: readonly FaceRig[]): FaceRig {
  const controls = [...new Set(rigs.flatMap((rig) => rig.controls))]
  return {
    controls,
    apply(pose) {
      for (const rig of rigs) rig.apply(pose)
    },
  }
}

/** The ARKit controls in a rig's list, in the order the lobby declares them. */
export function knownControls(rig: FaceRig): FaceControl[] {
  const present = new Set(rig.controls)
  return FACE_CONTROLS.filter((control) => present.has(control))
}
