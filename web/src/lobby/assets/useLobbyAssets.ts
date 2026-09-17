/**
 * Reads the optional asset manifest once per mount.
 *
 * Returns the shipped procedural configuration immediately, then swaps in any
 * manifest overrides, so the room never waits on a file that usually is not
 * there.
 */
import { useEffect, useState } from 'react'

import { DEFAULT_ASSETS } from './assetConfig'
import { loadAssetManifest } from './manifest'
import type { AssetManifestResult } from './manifest'

const INITIAL: AssetManifestResult = { assets: DEFAULT_ASSETS, overridden: [], note: null }

export function useLobbyAssets(): AssetManifestResult {
  const [result, setResult] = useState<AssetManifestResult>(INITIAL)

  useEffect(() => {
    const abort = new AbortController()
    let cancelled = false

    void loadAssetManifest(abort.signal).then((loaded) => {
      if (!cancelled) setResult(loaded)
    })

    return () => {
      cancelled = true
      abort.abort()
    }
  }, [])

  return result
}
