/**
 * Procedurally drawn textures.
 *
 * Everything the lobby needs is painted into a canvas at runtime: there are no
 * image files to download, nothing to license, and the room renders identically
 * on a fresh clone. Final art replaces these through the asset manifest — see
 * ../assets/assetConfig.ts.
 */
import * as THREE from 'three'

import { PALETTE } from '../theme'

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  return [element, context]
}

function finish(element: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** Deterministic noise, so the room looks the same on every load. */
function seeded(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0xffffffff
  }
}

/** Oak boards, laid along the room's long axis. */
export function oakFloorTexture(): THREE.CanvasTexture {
  const size = 1024
  const [element, ctx] = canvas2d(size, size)
  const random = seeded(20260917)

  ctx.fillStyle = PALETTE.oakDark
  ctx.fillRect(0, 0, size, size)

  const boards = 8
  const boardHeight = size / boards
  for (let row = 0; row < boards; row += 1) {
    // Stagger the joints so the floor does not read as a grid.
    const offset = (row % 2 === 0 ? 0 : 0.5) * size
    const y = row * boardHeight

    for (let plank = 0; plank < 2; plank += 1) {
      const x = (offset + plank * size * 0.5) % size
      const tone = 0.82 + random() * 0.32
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, size * 0.5 - 2, boardHeight - 2)
      ctx.clip()

      ctx.fillStyle = shade(PALETTE.oak, tone)
      ctx.fillRect(x - 2, y - 2, size * 0.5 + 4, boardHeight + 4)

      // Grain.
      ctx.strokeStyle = shade(PALETTE.oakDeep, 0.9 + random() * 0.4)
      ctx.globalAlpha = 0.16
      for (let g = 0; g < 26; g += 1) {
        const gy = y + random() * boardHeight
        ctx.lineWidth = 0.6 + random() * 1.6
        ctx.beginPath()
        ctx.moveTo(x, gy)
        ctx.bezierCurveTo(
          x + size * 0.15,
          gy + (random() - 0.5) * 7,
          x + size * 0.35,
          gy + (random() - 0.5) * 7,
          x + size * 0.5,
          gy + (random() - 0.5) * 4,
        )
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }
  }

  // Board joints.
  ctx.strokeStyle = 'rgba(58,38,20,0.5)'
  ctx.lineWidth = 2
  for (let row = 0; row <= boards; row += 1) {
    const y = row * boardHeight
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }

  const texture = finish(element)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 5)
  return texture
}

/** Matching roughness map: the grain is slightly glossier than the board. */
export function oakFloorRoughness(): THREE.CanvasTexture {
  const size = 512
  const [element, ctx] = canvas2d(size, size)
  const random = seeded(777)
  ctx.fillStyle = '#9a9a9a'
  ctx.fillRect(0, 0, size, size)
  ctx.globalAlpha = 0.35
  for (let i = 0; i < 2400; i += 1) {
    const v = Math.floor(120 + random() * 110)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 2)
  }
  ctx.globalAlpha = 1
  const texture = finish(element, false)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 5)
  return texture
}

/** Lightly troweled plaster, so the walls are not dead flat. */
export function plasterTexture(): THREE.CanvasTexture {
  const size = 512
  const [element, ctx] = canvas2d(size, size)
  const random = seeded(4242)
  ctx.fillStyle = PALETTE.ivory
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 5200; i += 1) {
    const tone = 0.95 + random() * 0.1
    ctx.fillStyle = shade(PALETTE.ivory, tone)
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.ellipse(
      random() * size,
      random() * size,
      2 + random() * 12,
      2 + random() * 8,
      random() * Math.PI,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const texture = finish(element)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 1)
  return texture
}

/** The pile of the lounge rug. */
export function rugTexture(): THREE.CanvasTexture {
  const size = 512
  const [element, ctx] = canvas2d(size, size)
  const random = seeded(90210)
  ctx.fillStyle = PALETTE.ivoryDeep
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 9000; i += 1) {
    ctx.strokeStyle = random() > 0.82 ? shade(PALETTE.graphiteLight, 1.1) : shade(PALETTE.ivoryDeep, 0.9 + random() * 0.2)
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 1
    const x = random() * size
    const y = random() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (random() - 0.5) * 6, y + (random() - 0.5) * 6)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // A restrained emerald border.
  ctx.strokeStyle = PALETTE.emerald
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 8
  ctx.strokeRect(22, 22, size - 44, size - 44)
  ctx.globalAlpha = 1
  return finish(element)
}

export interface SignOptions {
  /** Small line above the main text. */
  eyebrow?: string
  background?: string
  color?: string
  accent?: string
  width?: number
  height?: number
  fontSize?: number
  align?: 'left' | 'center'
  /** Draw an emerald rule under the text. */
  rule?: boolean
}

/**
 * Wall signage and desk lettering.
 *
 * Text is drawn with the browser's own font stack rather than a loaded webfont:
 * one less asset, and nothing to fail at runtime.
 */
export function signTexture(text: string, options: SignOptions = {}): THREE.CanvasTexture {
  const {
    eyebrow,
    background = 'rgba(0,0,0,0)',
    color = PALETTE.graphite,
    accent = PALETTE.emerald,
    width = 1024,
    height = 256,
    fontSize = 108,
    align = 'center',
    rule = false,
  } = options

  const [element, ctx] = canvas2d(width, height)
  if (background !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  const x = align === 'center' ? width / 2 : width * 0.06
  ctx.textAlign = align === 'center' ? 'center' : 'left'
  ctx.textBaseline = 'middle'

  const usable = width * (align === 'center' ? 0.88 : 0.9)

  let baseline = height / 2
  if (eyebrow) {
    baseline = height * 0.6
    ctx.fillStyle = accent
    const tracked = eyebrow.toUpperCase().split('').join(' ')
    ctx.font = fitFont(ctx, tracked, Math.round(fontSize * 0.34), usable)
    ctx.fillText(tracked, x, height * 0.27)
  }

  ctx.fillStyle = color
  ctx.font = fitFont(ctx, text, fontSize, usable)
  ctx.fillText(text, x, baseline)

  if (rule) {
    const metrics = ctx.measureText(text)
    const ruleWidth = Math.min(metrics.width, width * 0.8)
    const ruleX = align === 'center' ? (width - ruleWidth) / 2 : x
    ctx.fillStyle = accent
    ctx.fillRect(ruleX, baseline + fontSize * 0.62, ruleWidth, Math.max(4, fontSize * 0.055))
  }

  return finish(element)
}

/**
 * The name badge worn by the reception character.
 *
 * It says what the figure is, on the figure. The character is generated in code
 * rather than sculpted or scanned, and the room should say so from the visitor's
 * side of the counter rather than only in a document.
 */
export function placeholderBadgeTexture(): THREE.CanvasTexture {
  const [element, ctx] = canvas2d(512, 256)
  ctx.fillStyle = PALETTE.ivoryPale
  ctx.fillRect(0, 0, 512, 256)
  ctx.fillStyle = PALETTE.emerald
  ctx.fillRect(0, 0, 512, 16)
  ctx.fillStyle = PALETTE.graphite
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = "700 60px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.fillText('RECEPTION', 256, 104)
  ctx.font = "500 34px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.fillStyle = PALETTE.graphiteLight
  ctx.fillText('demonstration character', 256, 170)
  return finish(element)
}

/**
 * The largest font that still fits `maxWidth`.
 *
 * A sign is a fixed plane in the room, so the text has to yield rather than run
 * off the edge of it — a wayfinding board that reads "felcom" is worse than one
 * set two points smaller.
 */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  preferred: number,
  maxWidth: number,
): string {
  const face = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  let size = preferred
  while (size > 10) {
    ctx.font = `600 ${size}px ${face}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return `600 ${size}px ${face}`
}

/** Multiply a hex colour by `factor`, clamped. */
function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((value >> 16) & 255) * factor))
  const g = Math.min(255, Math.round(((value >> 8) & 255) * factor))
  const b = Math.min(255, Math.round((value & 255) * factor))
  return `rgb(${r},${g},${b})`
}

/**
 * A soft round gradient, used as the alpha of the contact-shadow pools.
 *
 * Squared falloff rather than linear: a linear gradient reads as a flat grey
 * disc with a visible rim, while the squared curve keeps the centre dark and
 * lets the edge vanish.
 */
export function contactShadowTexture(size = 128): THREE.CanvasTexture {
  const [element, ctx] = canvas2d(size, size)
  const half = size / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(26, 22, 18, 0.85)')
  gradient.addColorStop(0.45, 'rgba(26, 22, 18, 0.42)')
  gradient.addColorStop(0.75, 'rgba(26, 22, 18, 0.12)')
  gradient.addColorStop(1, 'rgba(26, 22, 18, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
