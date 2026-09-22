/**
 * Aicountly Lobby — the visitor experience.
 *
 * Holds the two things the rest of the lobby is built around: which view the
 * visitor is in (3D or Standard), and the single navigation controller that
 * owns the camera. Everything else is handed one or both.
 *
 * Standard View is a choice the visitor can make and also the landing place
 * when 3D is not possible, so the switch is in one place with one reason
 * attached.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { LOBBY_DISPLAY_NAME } from './lobbyConfig'
import { NavigationController } from './navigation/controller'
import { LobbyCanvas } from './scene/LobbyCanvas'
import { useLobbyAssets } from './assets/useLobbyAssets'
import { getLobbyServices } from './services/registry'
import { useReducedMotion } from './useReducedMotion'
import { detectInitialQuality, rememberQuality } from './quality'
import type { LobbyQuality } from './quality'
import { releaseSceneResources } from './scene/resources'
import type { TextureLoadReport } from './scene/textureSet'
import { detectWebglSupport } from './webgl'
import { SceneErrorBoundary } from './ui/ErrorBoundary'
import { LobbyHud } from './ui/LobbyHud'
import { ServiceDialog } from './ui/ServiceDialog'
import { StandardView } from './ui/StandardView'
import './lobby.css'

type View = '3d' | 'standard'

interface Props {
  /** Overlay chrome the host page owns, e.g. the cross-product app launcher. */
  children?: ReactNode
  /** Host controls shown alongside the lobby's own buttons, e.g. Log out. */
  actions?: ReactNode
}

export function LobbyExperience({ children, actions }: Props) {
  const adapter = useMemo(getLobbyServices, [])
  const controller = useMemo(() => new NavigationController(), [])
  const reducedMotion = useReducedMotion()
  const { assets } = useLobbyAssets()

  // Probed once, before the first render of the canvas, so an unsupported
  // browser never mounts a renderer it cannot use.
  const [supported] = useState(() => detectWebglSupport() === 'supported')
  const [view, setView] = useState<View>(supported ? '3d' : 'standard')
  const [fallbackReason, setFallbackReason] = useState<string | null>(
    supported ? null : 'This browser cannot run WebGL, so the 3D lobby is unavailable here.',
  )
  const [servicesOpen, setServicesOpen] = useState(false)
  const [quality, setQuality] = useState<LobbyQuality>(detectInitialQuality)
  const [textureReport, setTextureReport] = useState<TextureLoadReport | null>(null)

  const sceneRef = useRef<HTMLDivElement>(null)

  const chooseQuality = useCallback((next: LobbyQuality) => {
    setQuality(next)
    rememberQuality(next)
  }, [])

  // Textures, materials, geometry caches and the environment map are shared for
  // the lifetime of the page rather than the canvas, so that toggling Standard
  // View does not re-decode 2 MB of PNG. They are released once, here, when the
  // lobby itself goes away.
  useEffect(() => releaseSceneResources, [])

  useEffect(() => {
    const element = sceneRef.current
    if (view !== '3d' || !element) return
    return controller.attach(element)
  }, [controller, view])

  // Movement stops while the service panel is open, and the controller drops
  // anything currently held. Leaving 3D does the same by way of the teardown.
  useEffect(() => {
    controller.setSuspended(servicesOpen)
  }, [controller, servicesOpen])

  useEffect(() => {
    controller.setReducedMotion(reducedMotion)
  }, [controller, reducedMotion])

  const failTo2d = useCallback((message: string) => {
    setFallbackReason(message)
    setView('standard')
  }, [])

  const onSceneError = useCallback(
    (message: string) => {
      failTo2d(`The 3D lobby could not be rendered on this device (${message}). Standard View is shown instead.`)
    },
    [failTo2d],
  )

  const onContextLost = useCallback(() => {
    failTo2d('The browser dropped the 3D graphics context. Standard View is shown instead.')
  }, [failTo2d])

  const standard = (
    <StandardView
      adapter={adapter}
      reason={fallbackReason}
      canUse3d={supported}
      actions={actions}
      onEnter3d={() => {
        setFallbackReason(null)
        setView('3d')
      }}
    />
  )

  if (view === 'standard') {
    return (
      <div className="lobby-root lobby-root-standard">
        {children}
        {standard}
      </div>
    )
  }

  return (
    <div className="lobby-root">
      {children}
      <SceneErrorBoundary onError={onSceneError} fallback={standard}>
        <div
          className="lobby-scene"
          ref={sceneRef}
          tabIndex={0}
          role="application"
          aria-label={`${LOBBY_DISPLAY_NAME}. Drag to look around, W A S D or arrow keys to walk, Q and E to turn. Use the destination buttons to move without walking.`}
        >
          <LobbyCanvas
            controller={controller}
            assets={assets}
            reducedMotion={reducedMotion}
            quality={quality}
            onOpenServices={() => setServicesOpen(true)}
            onContextLost={onContextLost}
            onTexturesSettled={setTextureReport}
          />
          <LobbyHud
            controller={controller}
            reducedMotion={reducedMotion}
            quality={quality}
            onQualityChange={chooseQuality}
            textureReport={textureReport}
            actions={actions}
            onOpenServices={() => setServicesOpen(true)}
            onStandardView={() => {
              setFallbackReason(null)
              setView('standard')
            }}
          />
        </div>
      </SceneErrorBoundary>

      <ServiceDialog
        open={servicesOpen}
        adapter={adapter}
        onClose={() => setServicesOpen(false)}
      />
    </div>
  )
}
