/**
 * Can this browser render the lobby at all?
 *
 * Checked before the Canvas mounts, so an unsupported browser goes straight to
 * Standard View instead of watching a renderer fail. The probe context is
 * released immediately: browsers cap how many live WebGL contexts a page may
 * hold, and a leaked one costs the real canvas its slot.
 */
export type WebglSupport = 'supported' | 'unsupported'

export function detectWebglSupport(): WebglSupport {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'unsupported'

  try {
    const canvas = document.createElement('canvas')
    const context =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')

    if (!context) return 'unsupported'

    const lose = (context as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()

    return 'supported'
  } catch {
    return 'unsupported'
  }
}
