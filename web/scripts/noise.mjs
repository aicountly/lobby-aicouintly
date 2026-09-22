/**
 * Deterministic, tiling noise for the lobby texture generator.
 *
 * Every function is periodic on an integer lattice, so a texture generated at
 * period P tiles seamlessly at P. Nothing here uses Math.random: the same
 * commit always produces byte-identical PNGs, which is what makes the generated
 * assets reviewable in a diff.
 */

function hash2(ix, iy, seed, period) {
  const x = ((ix % period) + period) % period
  const y = ((iy % period) + period) % period
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const smooth = (t) => t * t * (3 - 2 * t)

export function valueNoise(x, y, period, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = smooth(fx)
  const v = smooth(fy)
  const a = hash2(ix, iy, seed, period)
  const b = hash2(ix + 1, iy, seed, period)
  const c = hash2(ix, iy + 1, seed, period)
  const d = hash2(ix + 1, iy + 1, seed, period)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

/** Fractal sum. Period scales with frequency so every octave still tiles. */
export function fbm(x, y, period, seed, octaves = 4, gain = 0.5) {
  let sum = 0
  let norm = 0
  let amp = 1
  let freq = 1
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(x * freq, y * freq, period * freq, seed + o * 101)
    norm += amp
    amp *= gain
    freq *= 2
  }
  return sum / norm
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const mix = (a, b, t) => a + (b - a) * t

/** #rrggbb -> [r, g, b] in 0..255. */
export function hex(value) {
  const n = parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Tangent-space normal map from a height field, wrapping at the edges so the
 * result tiles with the height field it came from.
 *
 * Green is +Y (OpenGL convention), which is what three.js expects.
 */
export function normalFromHeight(height, size, strength) {
  const out = new Uint8Array(size * size * 3)
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const nx = -dx
      const ny = -dy
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      const i = (y * size + x) * 3
      out[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      out[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      out[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255)
    }
  }
  return out
}

/** Pack a 0..1 float field into an 8-bit greyscale buffer. */
export function greyscale(field, size) {
  const out = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i += 1) out[i] = Math.round(clamp01(field[i]) * 255)
  return out
}
