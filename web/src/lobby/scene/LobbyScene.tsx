/**
 * Everything inside the Canvas, assembled.
 *
 * Each replaceable part is wrapped in <OptionalModel>, so the procedural
 * geometry underneath is the fallback rather than the design: supply art for
 * one slot and the rest of the room carries on unchanged.
 */
import { useFrame } from '@react-three/fiber'

import type { LobbyAssets } from '../assets/assetConfig'
import type { NavigationController } from '../navigation/controller'
import { Furnishings } from './Furnishings'
import { Lighting } from './Lighting'
import { OptionalModel } from './OptionalModel'
import { PlaceholderReceptionist } from './Receptionist'
import { ReceptionDesk } from './ReceptionDesk'
import { Room } from './Room'
import { Signage } from './Signage'
import { WaitingLounge } from './WaitingLounge'

interface Props {
  controller: NavigationController
  assets: LobbyAssets
  reducedMotion: boolean
  shadows: boolean
  onOpenServices: () => void
}

export function LobbyScene({ controller, assets, reducedMotion, shadows, onOpenServices }: Props) {
  return (
    <>
      <Lighting shadows={shadows} />

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

      <OptionalModel slot={assets.receptionist} reducedMotion={reducedMotion}>
        <PlaceholderReceptionist reducedMotion={reducedMotion} />
      </OptionalModel>

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
