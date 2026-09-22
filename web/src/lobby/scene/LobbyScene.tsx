/**
 * Everything inside the Canvas, assembled.
 *
 * Each replaceable part is wrapped in <OptionalModel>, so the procedural
 * geometry underneath is the fallback rather than the design: supply art for one
 * slot and the rest of the room carries on unchanged.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

import type { LobbyAssets } from '../assets/assetConfig'
import { RECEPTIONIST_SPOT } from '../layout'
import type { NavigationController } from '../navigation/controller'
import type { LobbyQuality } from '../quality'
import type { CharacterCapability } from '../reception/capability'
import type { CharacterMode } from '../reception/measure'
import type { ReceptionSignal } from '../reception/signal'
import type { TextureLoadReport } from './textureSet'
import { Furnishings } from './Furnishings'
import { Lighting } from './Lighting'
import { OptionalModel } from './OptionalModel'
import { ReceptionDesk } from './ReceptionDesk'
import { ReceptionistSlot } from './ReceptionistSlot'
import { Room } from './Room'
import { SceneResources } from './SceneResources'
import { Signage } from './Signage'
import { WaitingLounge } from './WaitingLounge'

interface Props {
  controller: NavigationController
  assets: LobbyAssets
  reducedMotion: boolean
  quality: LobbyQuality
  /** Shared with the reception conversation; read every frame, never rendered. */
  signal: ReceptionSignal
  /** `off` leaves the character out entirely, for the avatar cost measurement. */
  characterMode?: CharacterMode
  onOpenServices: () => void
  onTexturesSettled?: (report: TextureLoadReport) => void
  onCharacterCapability?: (capability: CharacterCapability) => void
  /** Fired when the visitor arrives at the counter, and again on a return visit. */
  onApproachReception?: () => void
}

export function LobbyScene({
  controller,
  assets,
  reducedMotion,
  quality,
  signal,
  characterMode = 'idle',
  onOpenServices,
  onTexturesSettled,
  onCharacterCapability,
  onApproachReception,
}: Props) {
  return (
    <>
      <SceneResources quality={quality} onTexturesSettled={onTexturesSettled} />
      <Lighting quality={quality} />

      <OptionalModel slot={assets.room} reducedMotion={reducedMotion}>
        <Room />
      </OptionalModel>

      <OptionalModel slot={assets.receptionDesk} reducedMotion={reducedMotion}>
        <ReceptionDesk
          controller={controller}
          onOpenServices={onOpenServices}
          reducedMotion={reducedMotion}
        />
      </OptionalModel>

      <OptionalModel slot={assets.loungeSeating} reducedMotion={reducedMotion}>
        <WaitingLounge />
      </OptionalModel>

      {characterMode === 'off' ? null : (
        <ReceptionistSlot
          slot={assets.receptionist}
          signal={signal}
          reducedMotion={reducedMotion}
          onCapability={onCharacterCapability}
        />
      )}

      <Furnishings />
      <Signage />

      <ApproachWatcher onApproach={onApproachReception} />

      <CameraDriver controller={controller} />
    </>
  )
}

/**
 * Fires once when the visitor reaches the counter.
 *
 * Hysteresis rather than a plain threshold: standing at 4.0 m and shifting
 * weight would otherwise re-greet a visitor several times a second. It re-arms
 * only once they have gone properly away, which is also what makes a second
 * greeting on a second visit feel right rather than forgetful.
 */
function ApproachWatcher({ onApproach }: { onApproach?: () => void }) {
  const armed = useRef(true)

  useFrame((state) => {
    if (!onApproach) return
    const distance = Math.hypot(
      state.camera.position.x - RECEPTIONIST_SPOT.x,
      state.camera.position.z - RECEPTIONIST_SPOT.z,
    )
    // 5 m rather than 4: the "Reception" destination lands 4.40 m from the
    // character, and the most obvious way to walk up to reception has to be one
    // that counts as walking up to reception.
    if (armed.current && distance < 5) {
      armed.current = false
      onApproach()
    } else if (!armed.current && distance > 8) {
      armed.current = true
    }
  })

  return null
}

/**
 * The one place the camera is written to.
 *
 * The controller owns the pose and every input that changes it; this just hands
 * it the frame delta and the camera to apply it to.
 */
function CameraDriver({ controller }: { controller: NavigationController }) {
  useFrame((state, delta) => {
    controller.update(delta, state.camera)
  })
  return null
}
