/**
 * Shared materials for the lobby.
 *
 * The room is roughly two hundred meshes and almost all of them are one of a
 * dozen surfaces, so the materials are built once and handed out by reference.
 * Building them per mesh would upload the same shader program over and over.
 *
 * They are created lazily on first use, because the procedural textures need a
 * DOM canvas and this module is imported by code that also runs before paint.
 */
import * as THREE from 'three'

import { PALETTE } from '../theme'
import { oakFloorRoughness, oakFloorTexture, plasterTexture, rugTexture } from './textures'

export interface LobbyMaterials {
  floor: THREE.MeshStandardMaterial
  wall: THREE.MeshStandardMaterial
  ceiling: THREE.MeshStandardMaterial
  /** The shallow frame around each lighting coffer. */
  ceilingReveal: THREE.MeshStandardMaterial
  skirting: THREE.MeshStandardMaterial
  oak: THREE.MeshStandardMaterial
  oakLight: THREE.MeshStandardMaterial
  oakDark: THREE.MeshStandardMaterial
  graphite: THREE.MeshStandardMaterial
  graphiteSoft: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  emerald: THREE.MeshStandardMaterial
  emeraldGlow: THREE.MeshStandardMaterial
  upholstery: THREE.MeshStandardMaterial
  upholsteryDeep: THREE.MeshStandardMaterial
  rug: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  lightPanel: THREE.MeshStandardMaterial
  foliage: THREE.MeshStandardMaterial
  foliageDeep: THREE.MeshStandardMaterial
  pot: THREE.MeshStandardMaterial
  /** The placeholder receptionist, deliberately not skin-toned. */
  placeholderBody: THREE.MeshStandardMaterial
  placeholderAccent: THREE.MeshStandardMaterial
  /** Pale inset for the recessed wall panels. */
  ivoryPanel: THREE.MeshStandardMaterial
  /** Dark backing behind the oak slat wall. */
  oakDeepPanel: THREE.MeshStandardMaterial
  /** Paving visible through the entrance glazing. */
  exterior: THREE.MeshStandardMaterial
  /** Unlit bright backdrop standing in for daylight outside the doors. */
  daylight: THREE.MeshBasicMaterial
}

let cache: LobbyMaterials | null = null

export function getMaterials(): LobbyMaterials {
  if (cache) return cache

  const floorMap = oakFloorTexture()
  const floorRoughness = oakFloorRoughness()
  const plaster = plasterTexture()

  cache = {
    floor: new THREE.MeshStandardMaterial({
      map: floorMap,
      roughnessMap: floorRoughness,
      // The boards are drawn at full oak saturation; this tint pulls them back
      // to a floor you would actually specify rather than a varnished orange.
      color: '#bfb6a6',
      roughness: 0.62,
      metalness: 0.02,
    }),
    wall: new THREE.MeshStandardMaterial({
      map: plaster,
      color: PALETTE.ivory,
      roughness: 0.94,
      metalness: 0,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      color: PALETTE.ivoryPale,
      roughness: 0.96,
      metalness: 0,
    }),
    ceilingReveal: new THREE.MeshStandardMaterial({
      color: '#d8d0c2',
      roughness: 0.95,
      metalness: 0,
    }),
    skirting: new THREE.MeshStandardMaterial({
      color: PALETTE.graphite,
      roughness: 0.5,
      metalness: 0.08,
    }),
    oak: new THREE.MeshStandardMaterial({ color: PALETTE.oak, roughness: 0.55, metalness: 0.03 }),
    oakLight: new THREE.MeshStandardMaterial({
      color: PALETTE.oakLight,
      roughness: 0.52,
      metalness: 0.03,
    }),
    oakDark: new THREE.MeshStandardMaterial({
      color: PALETTE.oakDark,
      roughness: 0.6,
      metalness: 0.03,
    }),
    graphite: new THREE.MeshStandardMaterial({
      color: PALETTE.graphite,
      roughness: 0.46,
      metalness: 0.12,
    }),
    graphiteSoft: new THREE.MeshStandardMaterial({
      color: PALETTE.graphiteSoft,
      roughness: 0.6,
      metalness: 0.08,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: '#9aa2a8',
      roughness: 0.28,
      metalness: 0.85,
    }),
    emerald: new THREE.MeshStandardMaterial({
      color: PALETTE.emerald,
      roughness: 0.4,
      metalness: 0.15,
    }),
    emeraldGlow: new THREE.MeshStandardMaterial({
      color: PALETTE.emeraldBright,
      emissive: PALETTE.emeraldBright,
      emissiveIntensity: 0.85,
      roughness: 0.5,
    }),
    upholstery: new THREE.MeshStandardMaterial({
      color: '#cbb9a0',
      roughness: 0.92,
      metalness: 0,
    }),
    upholsteryDeep: new THREE.MeshStandardMaterial({
      color: '#4e5861',
      roughness: 0.9,
      metalness: 0,
    }),
    rug: new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.98, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: PALETTE.glass,
      transparent: true,
      opacity: 0.22,
      roughness: 0.06,
      metalness: 0,
      transmission: 0,
      side: THREE.DoubleSide,
    }),
    lightPanel: new THREE.MeshStandardMaterial({
      color: '#fff6e8',
      emissive: '#fff1dc',
      emissiveIntensity: 0.95,
      roughness: 1,
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: PALETTE.foliage,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    foliageDeep: new THREE.MeshStandardMaterial({
      color: PALETTE.foliageDeep,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    pot: new THREE.MeshStandardMaterial({ color: '#8d8578', roughness: 0.8, metalness: 0.04 }),
    placeholderBody: new THREE.MeshStandardMaterial({
      color: '#5d666e',
      roughness: 0.72,
      metalness: 0.04,
    }),
    placeholderAccent: new THREE.MeshStandardMaterial({
      color: PALETTE.emerald,
      roughness: 0.6,
      metalness: 0.06,
    }),
    ivoryPanel: new THREE.MeshStandardMaterial({
      color: PALETTE.ivoryPale,
      roughness: 0.9,
      metalness: 0,
    }),
    oakDeepPanel: new THREE.MeshStandardMaterial({
      color: PALETTE.oakDeep,
      roughness: 0.7,
      metalness: 0.02,
    }),
    exterior: new THREE.MeshStandardMaterial({
      color: '#d6d0c4',
      roughness: 0.95,
      metalness: 0,
    }),
    daylight: new THREE.MeshBasicMaterial({ color: '#f6eddd' }),
  }

  return cache
}
