/**
 * Aicountly Lobby — the visitor experience.
 *
 * Holds the three things the rest of the lobby is built around: which view the
 * visitor is in (3D or Standard), the single navigation controller that owns the
 * camera, and the single reception conversation. Everything else is handed one
 * or more of them.
 *
 * The conversation lives here rather than in the panel so that the figure behind
 * the counter and the panel are always the same exchange: closing the panel,
 * switching to Standard View and coming back does not start a second one, and
 * cannot leave the character mid-sentence with nothing driving it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { CONVERSATION_VIEW } from './layout'
import { LOBBY_DISPLAY_NAME } from './lobbyConfig'
import { NavigationController } from './navigation/controller'
import { LobbyCanvas } from './scene/LobbyCanvas'
import { useLobbyAssets } from './assets/useLobbyAssets'
import { detectCharacterMode, driveMeasurement } from './reception/measure'
import { rememberVoiceOutput } from './reception/speech'
import { useReception } from './reception/useReception'
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
  const reception = useReception({ adapter, reducedMotion })

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
  const [characterMode] = useState(detectCharacterMode)
  const [openOnService, setOpenOnService] = useState<'booking' | 'enquiry' | 'team' | null>(null)

  const sceneRef = useRef<HTMLDivElement>(null)

  // Opening reception should put you at reception. From the entrance the
  // character is twelve metres away and behind the panel, which is how a
  // talking receptionist ends up looking like one that does nothing.
  const openServices = useCallback(() => {
    controller.travelToPose({ ...CONVERSATION_VIEW })
    setOpenOnService(null)
    setServicesOpen(true)
  }, [controller])

  /**
   * Talk, from the room itself.
   *
   * Voice was reachable only three levels down — Reception services, then Speak
   * to our team, then Talk — which from a visitor's point of view meant it did
   * not exist. Pressing this opens the microphone directly and leaves the
   * character on screen, with the captions carrying the words. A browser with
   * no speech recognition lands in the conversation instead, where the panel
   * says why.
   */
  const talk = useCallback(() => {
    if (reception.snapshot.voice.listening) {
      reception.conversation.stopVoice()
      return
    }
    if (reception.snapshot.voice.inputAvailable) {
      controller.travelToPose({ ...CONVERSATION_VIEW })
      void reception.conversation.startVoice()
      return
    }
    controller.travelToPose({ ...CONVERSATION_VIEW })
    setOpenOnService('team')
    setServicesOpen(true)
  }, [controller, reception.conversation, reception.snapshot.voice])

  const toggleSpeech = useCallback(
    (enabled: boolean) => {
      reception.conversation.setVoiceOutput(enabled)
      rememberVoiceOutput(enabled)
    },
    [reception.conversation],
  )

  // Walking up to the counter is how you greet someone in a lobby. Before this,
  // the character stood there in silence until a panel was opened.
  const onApproachReception = useCallback(() => {
    reception.conversation.greet(true)
  }, [reception.conversation])

  const chooseQuality = useCallback((next: LobbyQuality) => {
    setQuality(next)
    rememberQuality(next)
  }, [])

  // Textures, materials, geometry caches and the environment map are shared for
  // the lifetime of the page rather than the canvas, so that toggling Standard
  // View does not re-decode 2 MB of PNG. They are released once, here, when the
  // lobby itself goes away.
  useEffect(() => releaseSceneResources, [])

  // Only does anything when ?lobbyCharacter=speaking is set; see measure.ts.
  useEffect(() => driveMeasurement(reception.signal, characterMode), [reception.signal, characterMode])

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

  // Standard View has no room to walk through, so opening it is the arrival.
  useEffect(() => {
    if (view === 'standard') reception.conversation.greet()
  }, [view, reception.conversation])

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

  const binding = {
    conversation: reception.conversation,
    snapshot: reception.snapshot,
    capability: reception.capability,
    mode: reception.mode,
    capabilities: reception.capabilities,
  }

  const standard = (
    <StandardView
      adapter={adapter}
      reception={binding}
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
            characterMode={characterMode}
            reducedMotion={reducedMotion}
            quality={quality}
            signal={reception.signal}
            onOpenServices={openServices}
            onContextLost={onContextLost}
            onTexturesSettled={setTextureReport}
            onCharacterCapability={reception.reportCapability}
            onApproachReception={onApproachReception}
          />
          <LobbyHud
            controller={controller}
            reducedMotion={reducedMotion}
            quality={quality}
            onQualityChange={chooseQuality}
            textureReport={textureReport}
            receptionState={reception.snapshot.state}
            reception={reception.snapshot}
            onTalk={talk}
            onPlayBlocked={() => void reception.conversation.playBlockedAudio()}
            onToggleSpeech={toggleSpeech}
            actions={actions}
            onOpenServices={openServices}
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
        reception={binding}
        initialService={openOnService}
        onClose={() => setServicesOpen(false)}
      />
    </div>
  )
}
