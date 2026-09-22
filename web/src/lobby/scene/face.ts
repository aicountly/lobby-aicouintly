/**
 * A procedural face with real morph targets.
 *
 * Phase 2A shipped a featureless head, and said so. It could say so because
 * nothing drove it. Driving a mouth from a viseme schedule needs a mouth, and
 * the character capability assessment found no licensed rigged human obtainable
 * in this build — so the face is generated here, the same way the room's
 * textures are, rather than declared in a manifest and left missing.
 *
 * Two mechanisms, one interface:
 *
 * - The **head shell** carries seventeen genuine glTF-style morph targets, ARKit
 *   named, built as vertex deltas over a parametric skull. These are the ones a
 *   supplied character would also provide, so the lip-sync driver is exercising
 *   the same code path either way.
 * - **Eyelids, brows, gaze and the mouth aperture** are small meshes moved by
 *   transform. A blendshape that rotates an eyelid is a worse way to rotate an
 *   eyelid, and the rig interface hides the difference.
 *
 * What this is *not*: a scanned or sculpted human. It is a stylised figure,
 * built from an ellipsoid and a handful of patches, and it is labelled as such
 * in the room. Nothing here should be read as photoreal art.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three'

import type { FaceRig } from '../reception/faceRig'
import { combineFaceRigs, createMorphFaceRig } from '../reception/faceRig'
import { getMaterials } from './materials'

// Grid resolution of the head shell. 32x24 is 1,536 triangles — enough that the
// silhouette is smooth at conversational distance and the morph deltas have
// somewhere to land, small enough that seventeen of them cost 170 KB.
const SEG_U = 32
const SEG_V = 24

/** Where the features sit, in the shell's own (u, v) parameter space. */
const MOUTH_V = 0.705
const UPPER_LIP_V = 0.672
const LOWER_LIP_V = 0.738
const EYE_V = 0.44
const BROW_V = 0.408
const EYE_THETA = 0.32
const CORNER_THETA = 0.3

const RX = 0.086
const RY = 0.117
const RZ = 0.094

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function gauss(x: number, mu: number, sigma: number): number {
  const d = x - mu
  return Math.exp(-(d * d) / (2 * sigma * sigma))
}

/** A point on the skull, for `v` down from the crown and `theta` around from the face. */
function headPoint(v: number, theta: number, out: Vector3): Vector3 {
  const phi = v * Math.PI
  const sp = Math.sin(phi)
  const cp = Math.cos(phi)
  const ct = Math.cos(theta)
  const front = Math.max(0, ct)
  const back = Math.max(0, -ct)

  // Below the eye line the skull narrows into a jaw. Squared, so the cheekbones
  // stay wide and the narrowing happens over the last third.
  const below = smoothstep(0.46, 1, v)
  const taper = 1 - 0.3 * below * below
  const cheek = gauss(v, 0.56, 0.1) * front

  const rx = RX * taper * (1 + 0.045 * cheek)
  const rz = RZ * (1 + 0.07 * back) * (1 - 0.05 * front * (1 - below))

  const brow = gauss(v, 0.4, 0.045) * front
  const chin = gauss(v, 0.8, 0.07) * front

  return out.set(
    rx * sp * Math.sin(theta),
    RY * cp,
    rz * sp * ct + 0.006 * brow + 0.016 * chin,
  )
}

/** Weights that say how much of a vertex belongs to each feature. */
interface Region {
  mouth: number
  jaw: number
  upper: number
  lower: number
  cornerLeft: number
  cornerRight: number
  cheekLeft: number
  cheekRight: number
}

/** How far around the face a weight reaches. */
function frontFall(theta: number, width: number): number {
  return Math.exp(-(theta * theta) / (width * width))
}

function regionAt(v: number, theta: number): Region {
  return {
    mouth: gauss(v, MOUTH_V, 0.05) * frontFall(theta, 0.62),
    jaw: smoothstep(0.6, 0.95, v) * frontFall(theta, 1.1),
    upper: gauss(v, UPPER_LIP_V, 0.028) * frontFall(theta, 0.58),
    lower: gauss(v, LOWER_LIP_V, 0.03) * frontFall(theta, 0.58),
    // The character faces +Z, so its own left is +X, which is theta > 0.
    cornerLeft: gauss(v, MOUTH_V, 0.055) * gauss(theta, CORNER_THETA, 0.15),
    cornerRight: gauss(v, MOUTH_V, 0.055) * gauss(theta, -CORNER_THETA, 0.15),
    cheekLeft: gauss(v, 0.58, 0.075) * gauss(theta, 0.44, 0.2),
    cheekRight: gauss(v, 0.58, 0.075) * gauss(theta, -0.44, 0.2),
  }
}

type Delta = (x: number, y: number, z: number, r: Region) => [number, number, number]

/**
 * The seventeen shapes, in millimetres of skin.
 *
 * Amplitudes are small on purpose: a face this size is 23 cm tall, a real jaw
 * drops about 30 mm at full open, and anything larger reads as a puppet. They
 * were chosen from those proportions rather than by eye, which is also why
 * `jawOpen` at 1.0 is 34 mm and not 60.
 */
const MORPHS: { name: string; delta: Delta }[] = [
  { name: 'jawOpen', delta: (_x, _y, _z, r) => [0, -0.034 * r.jaw - 0.012 * r.lower, -0.008 * r.jaw] },
  { name: 'mouthClose', delta: (_x, _y, _z, r) => [0, 0.005 * r.lower - 0.005 * r.upper, 0.002 * (r.upper + r.lower)] },
  { name: 'mouthFunnel', delta: (x, _y, _z, r) => [-0.3 * x * r.mouth, 0.003 * r.upper - 0.003 * r.lower, 0.013 * r.mouth] },
  { name: 'mouthPucker', delta: (x, _y, _z, r) => [-0.46 * x * r.mouth, -0.002 * r.upper + 0.002 * r.lower, 0.019 * r.mouth] },
  { name: 'mouthSmileLeft', delta: (_x, _y, _z, r) => [0.006 * r.cornerLeft, 0.011 * r.cornerLeft + 0.005 * r.cheekLeft, -0.002 * r.cornerLeft] },
  { name: 'mouthSmileRight', delta: (_x, _y, _z, r) => [-0.006 * r.cornerRight, 0.011 * r.cornerRight + 0.005 * r.cheekRight, -0.002 * r.cornerRight] },
  { name: 'mouthFrownLeft', delta: (_x, _y, _z, r) => [0, -0.01 * r.cornerLeft, 0] },
  { name: 'mouthFrownRight', delta: (_x, _y, _z, r) => [0, -0.01 * r.cornerRight, 0] },
  { name: 'mouthStretchLeft', delta: (_x, _y, _z, r) => [0.012 * r.cornerLeft, -0.002 * r.cornerLeft, 0] },
  { name: 'mouthStretchRight', delta: (_x, _y, _z, r) => [-0.012 * r.cornerRight, -0.002 * r.cornerRight, 0] },
  { name: 'mouthPressLeft', delta: (_x, _y, _z, r) => [-0.004 * r.cornerLeft, 0, -0.002 * r.cornerLeft] },
  { name: 'mouthPressRight', delta: (_x, _y, _z, r) => [0.004 * r.cornerRight, 0, -0.002 * r.cornerRight] },
  { name: 'mouthShrugUpper', delta: (_x, _y, _z, r) => [0, 0.006 * r.upper, 0.004 * r.upper] },
  { name: 'mouthRollLower', delta: (_x, _y, _z, r) => [0, 0.004 * r.lower, -0.008 * r.lower] },
  { name: 'mouthRollUpper', delta: (_x, _y, _z, r) => [0, -0.004 * r.upper, -0.007 * r.upper] },
  { name: 'cheekSquintLeft', delta: (_x, _y, _z, r) => [0, 0.005 * r.cheekLeft, 0.003 * r.cheekLeft] },
  { name: 'cheekSquintRight', delta: (_x, _y, _z, r) => [0, 0.005 * r.cheekRight, 0.003 * r.cheekRight] },
]

/** The names the head shell contributes to the rig. */
export const HEAD_MORPH_NAMES: readonly string[] = MORPHS.map((morph) => morph.name)

/** Controls the procedural face drives with transforms rather than morphs. */
export const TRANSFORM_CONTROLS: readonly string[] = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'browInnerUp', 'browDownLeft', 'browDownRight', 'browOuterUpLeft', 'browOuterUpRight',
]

/**
 * Build the skull, with a morph attribute per shape.
 *
 * Deltas are relative (`morphTargetsRelative`), which is both what glTF uses and
 * what makes them additive: a smile and an "oh" are then the same arithmetic
 * here as they would be on a supplied character.
 */
export function buildHeadGeometry(): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const deltas: number[][] = MORPHS.map(() => [])

  const point = new Vector3()

  for (let j = 0; j <= SEG_V; j += 1) {
    const v = j / SEG_V
    for (let i = 0; i <= SEG_U; i += 1) {
      const u = i / SEG_U
      // theta 0 is the front of the face, and the seam falls at the back.
      const theta = (u - 0.5) * Math.PI * 2
      headPoint(v, theta, point)
      positions.push(point.x, point.y, point.z)
      uvs.push(u, 1 - v)

      const region = regionAt(v, theta)
      for (let m = 0; m < MORPHS.length; m += 1) {
        const [dx, dy, dz] = MORPHS[m].delta(point.x, point.y, point.z, region)
        deltas[m].push(dx, dy, dz)
      }
    }
  }

  const stride = SEG_U + 1
  for (let j = 0; j < SEG_V; j += 1) {
    for (let i = 0; i < SEG_U; i += 1) {
      const a = j * stride + i
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  geometry.morphAttributes.position = deltas.map((values, index) => {
    const attribute: BufferAttribute = new Float32BufferAttribute(values, 3)
    // three.js reads `Mesh.morphTargetDictionary` from these names, which is
    // exactly what it does for a glTF's extras.targetNames.
    attribute.name = MORPHS[index].name
    return attribute
  })
  geometry.morphTargetsRelative = true

  return geometry
}

/**
 * Hair, built on the skull rather than over it.
 *
 * The obvious construction — a sphere cap on the crown — puts the hairline the
 * same distance down the front of the head as the back, which lands it across
 * the eyes. Tilting that cap back fixes the front and breaks the fit, because a
 * non-uniformly scaled ellipsoid rotated away from the skull's axes intersects
 * it. So the hair is sampled from `headPoint` itself, offset outwards by its own
 * thickness, with the hairline a function of which way the vertex faces: high at
 * the brow, lower at the temples, down over the nape.
 */
function buildHairGeometry(): BufferGeometry {
  const segU = 32
  const segV = 14
  const thickness = 1.045

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new Vector3()

  for (let j = 0; j <= segV; j += 1) {
    for (let i = 0; i <= segU; i += 1) {
      const u = i / segU
      const theta = (u - 0.5) * Math.PI * 2
      const facing = Math.cos(theta)
      const front = Math.max(0, facing)
      const back = Math.max(0, -facing)
      // Brow is at v 0.408 and the eye line at 0.44, so 0.30 at the front keeps
      // the hairline clear of both with a forehead in between.
      const edge = 0.3 + 0.14 * (1 - front) + 0.27 * back
      const v = (j / segV) * edge
      headPoint(v, theta, point).multiplyScalar(thickness)
      positions.push(point.x, point.y, point.z)
      uvs.push(u, 1 - j / segV)
    }
  }

  const stride = segU + 1
  for (let j = 0; j < segV; j += 1) {
    for (let i = 0; i < segU; i += 1) {
      const a = j * stride + i
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A small curved quad lying on a sphere of `radius`, centred on its own origin.
 *
 * Lips and brows on a flat plane sink into a curved face at the corners; a
 * patch of the same sphere the face is built from does not. Scaling it in y
 * then opens the mouth without lifting the corners off the skin.
 */
export function patchGeometry(
  radius: number,
  halfWidth: number,
  halfHeight: number,
  segX = 8,
  segY = 5,
): BufferGeometry {
  const halfA = Math.asin(Math.min(0.9, halfWidth / radius))
  const halfB = Math.asin(Math.min(0.9, halfHeight / radius))
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let j = 0; j <= segY; j += 1) {
    const tb = (j / segY - 0.5) * 2
    const b = tb * halfB
    for (let i = 0; i <= segX; i += 1) {
      const ta = (i / segX - 0.5) * 2
      const a = ta * halfA
      const cb = Math.cos(b)
      positions.push(radius * cb * Math.sin(a), radius * Math.sin(b), radius * cb * Math.cos(a) - radius)
      uvs.push(i / segX, j / segY)
    }
  }

  // Wound the opposite way round to the head, because this grid runs *up* the
  // face (y increases with j) while the head's runs down it. Copying the head's
  // order here points every patch's normal into the skull, and a lip you cannot
  // see because it is back-facing looks exactly like a lip that is not there.
  const stride = segX + 1
  for (let j = 0; j < segY; j += 1) {
    for (let i = 0; i < segX; i += 1) {
      const p = j * stride + i
      indices.push(p, p + 1, p + stride, p + stride, p + 1, p + stride + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export interface ProceduralFace {
  /** Parent this at the neck; the skull's centre is its origin. */
  group: Group
  rig: FaceRig
  /** Head turn, in radians, relative to the body. Clamped by the caller. */
  look(yaw: number, pitch: number): void
  /** Eyes only, for a glance that does not move the head. */
  gaze(yaw: number, pitch: number): void
  triangles: number
  morphTargetCount: number
  dispose(): void
}

/**
 * Build the head and the rig that drives it.
 *
 * Imperative rather than JSX because `Mesh.updateMorphTargets()` runs in the
 * constructor: a geometry attached afterwards, as R3F would, leaves the mesh
 * with no `morphTargetInfluences` and a face that cannot move.
 */
export function createProceduralFace(): ProceduralFace {
  const m = getMaterials()
  const group = new Group()
  const disposables: { dispose(): void }[] = []

  const headGeometry = buildHeadGeometry()
  disposables.push(headGeometry)
  const head = new Mesh(headGeometry, m.skin)
  head.castShadow = true
  group.add(head)

  // Where the features sit on the shell, measured from the shell itself rather
  // than guessed, so moving a feature line moves everything that belongs to it.
  const at = (v: number, theta: number) => headPoint(v, theta, new Vector3())
  const mouthAt = at(MOUTH_V, 0)
  const mouthRadius = mouthAt.length()

  // --- Mouth: a lip patch with a darker aperture patch just in front of it.
  //
  // Two groups, not one. `mouthAnchor` carries the placement — out at the mouth
  // point and turned to face along the skull's normal there — and never moves
  // again; `mouth` is what the rig drives. Driving the anchor directly, as an
  // earlier pass did, meant every frame overwrote the placement with the
  // identity and left the whole mouth sitting at the centre of the head, inside
  // it, invisible.
  const mouthAnchor = new Group()
  mouthAnchor.position.copy(mouthAt)
  mouthAnchor.lookAt(mouthAt.clone().multiplyScalar(2))
  group.add(mouthAnchor)

  const mouth = new Group()
  mouthAnchor.add(mouth)

  const lipGeometry = patchGeometry(mouthRadius, 0.019, 0.0058)
  const apertureGeometry = patchGeometry(mouthRadius, 0.0152, 0.005)
  disposables.push(lipGeometry, apertureGeometry)
  const lip = new Mesh(lipGeometry, m.lip)
  // Both patches are centred on their own origin, so depth is set here rather
  // than by their radius: the aperture has to draw in front of the lip.
  lip.position.z = 0.0013
  const aperture = new Mesh(apertureGeometry, m.mouthInterior)
  aperture.position.z = 0.0024
  mouth.add(lip, aperture)

  // --- Eyes.
  const eyeballGeometry = new SphereGeometry(0.0135, 18, 14)
  // Caps of the same sphere, a hair larger, so the iris sits on the eye rather
  // than intersecting it — a flat disc on a sphere always shows its edge.
  const irisGeometry = new SphereGeometry(0.01355, 16, 10, 0, Math.PI * 2, 0, 0.44)
  const pupilGeometry = new SphereGeometry(0.0136, 12, 8, 0, Math.PI * 2, 0, 0.21)
  const lidGeometry = new SphereGeometry(0.0143, 16, 10, 0, Math.PI * 2, 0, 0.62)
  const browGeometry = patchGeometry(at(BROW_V, EYE_THETA).length(), 0.016, 0.0029, 6, 2)
  disposables.push(eyeballGeometry, irisGeometry, pupilGeometry, lidGeometry, browGeometry)

  interface Eye {
    pivot: Group
    lid: Mesh
    brow: Mesh
    browRest: number
    side: 1 | -1
  }

  const eyes: Eye[] = []

  for (const side of [1, -1] as const) {
    const surface = at(EYE_V, side * EYE_THETA)
    // Pulled back into the skull so only a lens of eyeball shows through: the
    // skin around it is what forms the eye opening, which is why there is no
    // separate socket geometry.
    const centre = surface.clone().multiplyScalar(0.86)

    const pivot = new Group()
    pivot.position.copy(centre)
    group.add(pivot)

    const eyeball = new Mesh(eyeballGeometry, m.eyeWhite)
    const iris = new Mesh(irisGeometry, m.iris)
    iris.rotation.x = Math.PI / 2
    const pupil = new Mesh(pupilGeometry, m.mouthInterior)
    pupil.rotation.x = Math.PI / 2
    const lid = new Mesh(lidGeometry, m.skin)
    lid.rotation.x = LID_OPEN
    pivot.add(eyeball, iris, pupil, lid)

    // Same two-group split as the mouth, for the same reason: the pivot holds
    // the placement against the skull, the mesh is what the rig moves. 2 % of
    // the local radius is ~2 mm of clearance — at 0.4 %, the ends of the brow
    // sank into the skin and only its middle showed.
    const browSurface = at(BROW_V, side * EYE_THETA)
    const browPivot = new Group()
    browPivot.position.copy(browSurface).multiplyScalar(1.02)
    browPivot.lookAt(browSurface.clone().multiplyScalar(2))
    group.add(browPivot)

    const brow = new Mesh(browGeometry, m.hair)
    brow.rotation.z = side * 0.07
    browPivot.add(brow)

    eyes.push({ pivot, lid, brow, browRest: 0, side })
  }

  // --- Nose.
  const noseGeometry = new SphereGeometry(0.0115, 14, 12)
  disposables.push(noseGeometry)
  const nose = new Mesh(noseGeometry, m.skin)
  const noseAt = at(0.585, 0)
  nose.position.set(0, noseAt.y + 0.002, noseAt.z - 0.004)
  nose.scale.set(0.92, 1.45, 1.15)
  nose.castShadow = true
  group.add(nose)

  // --- Hair.
  const hairGeometry = buildHairGeometry()
  disposables.push(hairGeometry)
  const hair = new Mesh(hairGeometry, m.hair)
  hair.castShadow = true
  group.add(hair)

  const morphRig = createMorphFaceRig([head])

  /** Eyelids, brows and the mouth aperture: moved, not morphed. */
  const transformRig: FaceRig = {
    controls: TRANSFORM_CONTROLS,
    apply(pose) {
      for (const eye of eyes) {
        const left = eye.side === 1
        const blink = clamp01(pose[left ? 'eyeBlinkLeft' : 'eyeBlinkRight'] ?? 0)
        const squint = clamp01(pose[left ? 'eyeSquintLeft' : 'eyeSquintRight'] ?? 0)
        const wide = clamp01(pose[left ? 'eyeWideLeft' : 'eyeWideRight'] ?? 0)
        // Squint closes the lid part way; wide opens it further than rest.
        const closed = Math.min(1, blink + squint * 0.45)
        const open = LID_OPEN - wide * 0.22
        eye.lid.rotation.x = open + (LID_CLOSED - open) * closed

        const innerUp = clamp01(pose.browInnerUp ?? 0)
        const outerUp = clamp01(pose[left ? 'browOuterUpLeft' : 'browOuterUpRight'] ?? 0)
        const down = clamp01(pose[left ? 'browDownLeft' : 'browDownRight'] ?? 0)
        eye.brow.position.y = eye.browRest + 0.0055 * (innerUp * 0.45 + outerUp * 0.55) - 0.005 * down
        // Raising the inner end of a brow tilts it; which way depends on which
        // side of the face it is on, because "inner" swaps with the side.
        eye.brow.rotation.z = eye.side * 0.07 + eye.side * (outerUp * 0.24 - innerUp * 0.28)
      }

      const jaw = clamp01(pose.jawOpen ?? 0)
      const pucker = clamp01(pose.mouthPucker ?? 0)
      const funnel = clamp01(pose.mouthFunnel ?? 0)
      const stretch = (clamp01(pose.mouthStretchLeft ?? 0) + clamp01(pose.mouthStretchRight ?? 0)) / 2
      const smile = (clamp01(pose.mouthSmileLeft ?? 0) + clamp01(pose.mouthSmileRight ?? 0)) / 2
      const close = clamp01(pose.mouthClose ?? 0)

      const width = 1 - pucker * 0.34 - funnel * 0.18 + stretch * 0.22 + smile * 0.06
      const openness = Math.max(0, jaw - close * 0.8) + (funnel + pucker) * 0.12

      // A closed mouth still has lips: 1.25 of the patch is a ~15 mm band,
      // which is what a real lip line measures. Scaling it down to nothing at
      // rest, as an earlier pass did, left a face with a nose and no mouth.
      lip.scale.set(width, 1.45 + openness * 2.8, 1)
      // Never fully closed: a real mouth line is visible at rest, and an aperture
      // that vanishes leaves a face with a nose and nothing below it.
      aperture.scale.set(width * 0.9, 0.3 + openness * 2.3, 1)
      // Anchor the opening at the upper lip: a jaw drops, it does not grow
      // symmetrically about the mouth line.
      mouth.position.set(0, -openness * 0.009, 0)
    },
  }

  const rig = combineFaceRigs([morphRig, transformRig])
  rig.apply({})

  const triangles = countTriangles(group)

  return {
    group,
    rig,
    look(yaw, pitch) {
      group.rotation.set(pitch, yaw, 0)
    },
    gaze(yaw, pitch) {
      for (const eye of eyes) eye.pivot.rotation.set(pitch, yaw, 0)
    },
    triangles,
    morphTargetCount: MORPHS.length,
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

/** Lid rotation about X: back inside the skull when open, forward when shut. */
const LID_OPEN = -0.95
const LID_CLOSED = 1.35

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function countTriangles(group: Group): number {
  let total = 0
  group.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry as BufferGeometry
    const index = geometry.getIndex()
    total += index ? index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3
  })
  return Math.round(total)
}
