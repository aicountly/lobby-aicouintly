/**
 * Generates the Aicountly Lobby PBR texture set.
 *
 *   npm run textures          (from web/)
 *
 * Writes seamless base-colour, normal and roughness maps to
 * public/lobby-assets/textures/. Output is deterministic — no Math.random, no
 * timestamps — so re-running on the same commit reproduces byte-identical
 * files and a texture change shows up as a reviewable diff.
 *
 * These are generated rather than downloaded on purpose: this build has no
 * network route to an asset library, and generated textures carry no licence or
 * redistribution question for a public web bundle. Provenance: docs/lobby/ASSETS.md.
 *
 * Every surface is authored in UV space with frequencies in cycles-per-tile, so
 * resolution is a free parameter and every map still tiles. That is what lets
 * normal and roughness ship at half the base-colour resolution: they carry the
 * low-frequency structure, and halving them costs nothing visible while saving
 * most of the transfer budget (high-frequency noise is what PNG cannot deflate).
 *
 * Colour space belongs to the consumer, not the file: base colour is authored as
 * sRGB, normal and roughness as linear data. scene/textures.ts sets
 * texture.colorSpace to match.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { encodePng } from './png.mjs'
import { clamp01, fbm, greyscale, hex, mix, normalFromHeight, valueNoise } from './noise.mjs'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'lobby-assets', 'textures')
const written = []

function write(name, size, channels, pixels) {
  const buffer = encodePng(size, size, channels, pixels)
  writeFileSync(join(OUT_DIR, name), buffer)
  written.push({ name, size, channels, bytes: buffer.length })
}

/** Sample `fn(u, v)` over a size×size grid. u and v run 0..1 across the tile. */
function sample(size, fn) {
  const out = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) out.push(fn((x + 0.5) / size, (y + 0.5) / size))
  }
  return out
}

function rgbBuffer(size, fn) {
  const out = new Uint8Array(size * size * 3)
  let i = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = fn((x + 0.5) / size, (y + 0.5) / size)
      out[i++] = r
      out[i++] = g
      out[i++] = b
    }
  }
  return out
}

function floatBuffer(size, fn) {
  const out = new Float32Array(size * size)
  let i = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) out[i++] = fn((x + 0.5) / size, (y + 0.5) / size)
  }
  return out
}

const tint = (base, factor) => base.map((c) => Math.round(Math.max(0, Math.min(255, c * factor))))

/**
 * Emit one surface.
 *
 * `colour`, `height` and `rough` are all functions of (u, v), so the three maps
 * describe the same surface at whatever resolution each is rendered at.
 */
function surface(name, { size, mapSize, colour, height, rough, normalStrength }) {
  write(`${name}-basecolor.png`, size, 3, rgbBuffer(size, colour))
  if (height) {
    const field = floatBuffer(mapSize, height)
    write(`${name}-normal.png`, mapSize, 3, normalFromHeight(field, mapSize, normalStrength))
  }
  if (rough) {
    write(`${name}-roughness.png`, mapSize, 1, greyscale(floatBuffer(mapSize, rough), mapSize))
  }
}

// ---------------------------------------------------------------------------
// Oak flooring — engineered board, satin lacquer.
//
// One tile is 2.4 m square holding 12 boards, so a board reads ~200 mm wide,
// which is what a contemporary office floor uses. Board ends are staggered so
// the eye cannot pick out the repeat.
// ---------------------------------------------------------------------------
const BOARDS = 12
const BOARDS_ALONG = 3

/** Shared per-pixel oak evaluation, so colour/height/roughness stay in step. */
function oakAt(u, v) {
  const row = Math.floor(v * BOARDS)
  const offset = (row * 0.37) % 1
  const along = (u + offset) % 1
  const boardIndex = Math.floor(along * BOARDS_ALONG)
  const seed = row * 31 + boardIndex * 7

  const boardTone = 0.88 + valueNoise(seed * 3.1, seed * 1.7, 64, 11) * 0.26
  const grain = fbm(u * 24, v * BOARDS * 18, 24, 3 + seed, 4)
  const ray = Math.pow(fbm(u * 6, v * BOARDS * 30, 6, 900 + seed, 3), 3)
  const fleck = Math.pow(valueNoise(u * 220, v * 220, 220, 77), 12) * 0.35

  // Board seams: a soft line, never a deep gap.
  const vInBoard = (v * BOARDS) % 1
  const seamAcross = clamp01(1 - Math.min(vInBoard, 1 - vInBoard) * BOARDS * 24)
  const uInBoard = (along * BOARDS_ALONG) % 1
  const seamAlong = clamp01(1 - Math.min(uInBoard, 1 - uInBoard) * BOARDS_ALONG * 60)
  const seam = Math.max(seamAcross, seamAlong)

  return { boardTone, grain, ray, fleck, seam }
}

const OAK_FLOOR = hex('#b0977a')

surface('oak-floor', {
  size: 1024,
  mapSize: 512,
  normalStrength: 14,
  colour: (u, v) => {
    const { boardTone, grain, ray, fleck, seam } = oakAt(u, v)
    const shade = boardTone * mix(0.94, 1.06, grain) * (1 - ray * 0.14) - fleck * 0.05
    return tint(OAK_FLOOR, shade * (1 - seam * 0.28))
  },
  height: (u, v) => {
    const { grain, ray, seam } = oakAt(u, v)
    return -seam * 0.6 + grain * 0.06 + ray * 0.03
  },
  // Satin, not gloss. This is the fix for the mirror-like floor: roughness
  // never drops below 0.5, and the grain modulates it just enough to break up
  // the specular sweep that ran down the middle of the room.
  rough: (u, v) => {
    const { grain, ray, seam } = oakAt(u, v)
    return 0.52 + grain * 0.14 + ray * 0.1 + seam * 0.1
  },
})

// ---------------------------------------------------------------------------
// Oak veneer — desk body and furniture. Calmer figure than the floor.
// ---------------------------------------------------------------------------
const OAK_VENEER = hex('#a68a68')
const veneerAt = (u, v) => ({
  grain: fbm(u * 14, v * 140, 14, 21, 4),
  ray: Math.pow(fbm(u * 5, v * 220, 5, 55, 3), 3),
})

surface('oak-veneer', {
  size: 512,
  mapSize: 256,
  normalStrength: 6,
  colour: (u, v) => {
    const { grain, ray } = veneerAt(u, v)
    return tint(OAK_VENEER, mix(0.93, 1.07, grain) * (1 - ray * 0.12))
  },
  height: (u, v) => {
    const { grain, ray } = veneerAt(u, v)
    return grain * 0.1 + ray * 0.05
  },
  rough: (u, v) => {
    const { grain, ray } = veneerAt(u, v)
    return 0.44 + grain * 0.12 + ray * 0.08
  },
})

// ---------------------------------------------------------------------------
// Ivory plaster — walls. Deliberately almost featureless: subtle at close
// range, never dirty or mottled.
// ---------------------------------------------------------------------------
const IVORY = hex('#e8e0d3')

surface('plaster', {
  size: 512,
  mapSize: 256,
  normalStrength: 3,
  colour: (u, v) => {
    const trowel = fbm(u * 5, v * 5, 5, 5, 4)
    const fine = fbm(u * 40, v * 40, 40, 9, 2)
    // A 4% swing, no more. Stronger than this reads as a stained wall.
    return tint(IVORY, mix(0.98, 1.02, trowel) * mix(0.99, 1.01, fine))
  },
  height: (u, v) => fbm(u * 5, v * 5, 5, 5, 4) * 0.7 + fbm(u * 20, v * 20, 20, 9, 2) * 0.3,
})

// ---------------------------------------------------------------------------
// Woven upholstery — sofa and chairs. A real warp/weft grid, so it catches
// light like cloth rather than plastic.
// ---------------------------------------------------------------------------
const CREAM = hex('#c7bba6')
const THREADS = 64

function weaveAt(u, v) {
  const cx = Math.floor(u * THREADS)
  const cy = Math.floor(v * THREADS)
  const over = (cx + cy) % 2 === 0
  const warp = Math.sin(Math.PI * ((u * THREADS) % 1))
  const weft = Math.sin(Math.PI * ((v * THREADS) % 1))
  return { thread: over ? warp : weft, slub: fbm(u * 8, v * 8, 8, 300, 3) }
}

surface('fabric', {
  size: 512,
  mapSize: 256,
  normalStrength: 5,
  colour: (u, v) => {
    const { thread, slub } = weaveAt(u, v)
    return tint(CREAM, mix(0.9, 1.08, thread) * mix(0.96, 1.04, slub))
  },
  height: (u, v) => {
    const { thread, slub } = weaveAt(u, v)
    return thread * 0.7 + slub * 0.3
  },
  // Cloth is uniformly matte; only the slubs vary it. No plastic highlights.
  rough: (u, v) => {
    const { thread, slub } = weaveAt(u, v)
    return 0.88 + slub * 0.08 - thread * 0.04
  },
})

// ---------------------------------------------------------------------------
// Honed limestone — reception counter top. Restrained drifts and fine grain,
// no dramatic marble veining.
// ---------------------------------------------------------------------------
const STONE = hex('#d4cdc1')
const stoneAt = (u, v) => ({
  drift: fbm(u * 3, v * 3, 3, 41, 4),
  grain: fbm(u * 60, v * 60, 60, 63, 2),
})

surface('stone', {
  size: 1024,
  mapSize: 256,
  normalStrength: 2.5,
  colour: (u, v) => {
    const { drift, grain } = stoneAt(u, v)
    const speck = Math.pow(valueNoise(u * 380, v * 380, 380, 88), 9) * 0.5
    return tint(STONE, mix(0.95, 1.05, drift) * mix(0.985, 1.015, grain) - speck * 0.02)
  },
  height: (u, v) => stoneAt(u, v).grain * 0.35,
  // Honed, not polished: matte with only a slight sheen.
  rough: (u, v) => 0.48 + stoneAt(u, v).grain * 0.08,
})

// ---------------------------------------------------------------------------
// Wool rug — the lounge. Short dense pile.
// ---------------------------------------------------------------------------
const WOOL = hex('#cdc5b5')
const rugAt = (u, v) => ({
  pile: fbm(u * 90, v * 90, 90, 131, 2),
  tuft: fbm(u * 12, v * 12, 12, 17, 3),
})

surface('rug', {
  size: 512,
  mapSize: 256,
  normalStrength: 4,
  colour: (u, v) => {
    const { pile, tuft } = rugAt(u, v)
    return tint(WOOL, mix(0.9, 1.1, pile) * mix(0.96, 1.04, tuft))
  },
  height: (u, v) => {
    const { pile, tuft } = rugAt(u, v)
    return pile * 0.8 + tuft * 0.2
  },
  rough: (u, v) => 0.93 + rugAt(u, v).pile * 0.05,
})

mkdirSync(OUT_DIR, { recursive: true })

let total = 0
console.log('Generated lobby textures:\n')
for (const t of [...written].sort((a, b) => b.bytes - a.bytes)) {
  total += t.bytes
  console.log(
    `  ${(t.bytes / 1024).toFixed(0).padStart(6)} KB  ${String(t.size).padStart(4)}px  ` +
      `${t.channels === 1 ? 'grey' : 'rgb '}  ${t.name}`,
  )
}
console.log(`\n  ${(total / 1024 / 1024).toFixed(2)} MB total across ${written.length} files`)
