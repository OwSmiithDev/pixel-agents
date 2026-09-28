import * as THREE from 'three';

import { THREE_ALPHA_TEST, THREE_AMBIENT_INTENSITY } from '../../../constants.js';

// Unit quad anchored at its bottom-center, so scale = card size in world units.
const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

/**
 * Same fill as SpriteLayer: cards face the camera so the key light (behind)
 * never reaches their front. An emissive fill with the card's own texture
 * tops ambient up to 1.0, so the art keeps its 2D brightness whatever the
 * light angle.
 */
export const CARD_FILL = Math.max(0, 1 - THREE_AMBIENT_INTENSITY);

/**
 * A billboard quad for orbit view: characters/pets/bubbles (Task 6) and,
 * later, furniture cards (Task 8). No actor-specific logic — callers set
 * position/rotation/texture/material state per frame.
 */
export function createCard(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> {
  const material = new THREE.MeshLambertMaterial({
    alphaTest: THREE_ALPHA_TEST,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: CARD_FILL,
  });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: THREE_ALPHA_TEST,
  });
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
