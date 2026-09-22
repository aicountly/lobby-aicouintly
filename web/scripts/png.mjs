/**
 * A minimal PNG encoder, built on node:zlib alone.
 *
 * The lobby's textures are generated rather than downloaded, so the build needs
 * to write PNGs without pulling an image library into the toolchain. This
 * handles exactly the two colour types the generator emits: 8-bit greyscale and
 * 8-bit RGB.
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} channels 1 (greyscale) or 3 (RGB)
 * @param {Uint8Array} pixels row-major, `channels` bytes per pixel
 */
export function encodePng(width, height, channels, pixels) {
  if (channels !== 1 && channels !== 3) throw new Error(`unsupported channels: ${channels}`)

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 1 ? 0 : 2 // colour type: greyscale | truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per scanline. Filter 1 (Sub) predicts each byte from its
  // left neighbour, which is what makes smooth gradients compress well.
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 1
    for (let x = 0; x < stride; x += 1) {
      const value = pixels[y * stride + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      raw[rowStart + 1 + x] = (value - left) & 0xff
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
