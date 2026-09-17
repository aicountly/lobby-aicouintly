/**
 * The lobby's material palette: warm ivory, oak, graphite, restrained emerald.
 *
 * Emerald is an accent and is used as one — a desk reveal, a sign rule, the
 * hotspot ring. It is never a surface.
 */
export const PALETTE = {
  ivory: '#f2ebdf',
  ivoryDeep: '#e6dbc9',
  ivoryPale: '#f8f4ec',

  oak: '#c08f5a',
  oakLight: '#d9b487',
  oakDark: '#8d6236',
  oakDeep: '#6d4a29',

  graphite: '#31363b',
  graphiteSoft: '#474f56',
  graphiteLight: '#6d767d',

  emerald: '#16785a',
  emeraldBright: '#22a279',

  glass: '#b9cfcb',
  foliage: '#3f6b4a',
  foliageDeep: '#2d4f37',
} as const

/** Hex values as numbers, for the places three.js prefers them. */
export const LIGHT_COLORS = {
  /** Daylight through the entrance glazing. */
  daylight: 0xfff8ee,
  /** Warm interior downlights. */
  warm: 0xfff1da,
  /** Bounce from the oak floor. */
  bounce: 0xbaa286,
  emerald: 0x22a279,
} as const
