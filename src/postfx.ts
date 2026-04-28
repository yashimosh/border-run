// Postfx — bloom + vignette + tone mapping. Light touch, dawn-appropriate.
// Bloom catches headlight/brake-light/horizon emissives; vignette focuses
// attention on the truck without dimming the dawn sky.

import * as THREE from "three";
import {
  EffectComposer, EffectPass, RenderPass, BloomEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, KernelSize,
  DepthOfFieldEffect,
} from "postprocessing";

export interface PostFx {
  composer: EffectComposer;
  bloom: BloomEffect;
  vignette: VignetteEffect;
  dof: DepthOfFieldEffect;
  setSize: (w: number, h: number) => void;
  render: (dt: number) => void;
}

export function createPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): PostFx {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.45,
    luminanceThreshold: 0.78, // only bloom the truly bright (emissive lights, sun)
    luminanceSmoothing: 0.22,
    kernelSize: KernelSize.MEDIUM,
    mipmapBlur: true,
  });

  const vignette = new VignetteEffect({
    darkness: 0.7,
    offset: 0.32,
  });

  // Depth-of-field — subtle, mid-distance focus. Drives the "diorama" feel:
  // the truck and immediate surroundings are sharp, distant ridges soften.
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 0.012,    // normalized — ~mid-distance focus point
    focalLength: 0.06,
    bokehScale: 2.2,
  });

  const toneMap = new ToneMappingEffect({
    mode: ToneMappingMode.AGX,
  });

  composer.addPass(new EffectPass(camera, bloom, dof, vignette, toneMap));

  return {
    composer,
    bloom,
    vignette,
    dof,
    setSize: (w, h) => composer.setSize(w, h),
    render: (dt) => composer.render(dt),
  };
}
