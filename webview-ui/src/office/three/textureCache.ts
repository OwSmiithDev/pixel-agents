import * as THREE from 'three';

import { getCachedSprite } from '../sprites/spriteCache.js';
import type { SpriteData } from '../types.js';

const textures = new WeakMap<SpriteData, THREE.CanvasTexture>();

export function configurePixelTexture<T extends THREE.Texture>(texture: T): T {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Crisp (nearest-filtered) texture for a sprite, cached per SpriteData identity. */
export function spriteTexture(sprite: SpriteData): THREE.CanvasTexture {
  let texture = textures.get(sprite);
  if (!texture) {
    texture = configurePixelTexture(new THREE.CanvasTexture(getCachedSprite(sprite, 1)));
    textures.set(sprite, texture);
  }
  return texture;
}
