/**
 * Everything inside the Canvas, assembled.
 *
 * Each replaceable part is wrapped in <OptionalModel>, so the procedural
 * geometry underneath is the fallback rather than the design: supply art for one
 * slot and the rest of the room carries on unchanged.
 */
import { useFrame } from '@react-three/fiber'

import type { LobbyAssets } from '../assets/assetConfig'
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

      <CameraDriver controller={controller} />
    </>
  )
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
