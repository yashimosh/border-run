// Postfx — bloom + vignette + tone mapping. Light touch, dawn-appropriate.
// Bloom catches headlight/brake-light/horizon emissives; vignette focuses
// attention on the truck without dimming the dawn sky.
//
// Mobile path skips SSAO + NormalPass + DOF + color-grade to keep 60fps
// on mid-range phones. The visual difference is subtle outdoors in daylight.

import * as THREE from "three";
import {
  EffectComposer, EffectPass, RenderPass, BloomEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, KernelSize,
  DepthOfFieldEffect, SSAOEffect, NormalPass,
  HueSaturationEffect, BrightnessContrastEffect,
} from "postprocessing";

export interface PostFx {
  composer: EffectComposer;
  bloom: BloomEffect;
  vignette: VignetteEffect;
  dof: DepthOfFieldEffect;
  setSize: (w: number, h: number) => void;
  render: (dt: number) => void;
}

export interface PostFxOptions {
  /** Mobile quality: skip SSAO + NormalPass + DOF + color-grade, smaller bloom kernel. */
  mobile?: boolean;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: PostFxOptions = {},
): PostFx {
  const mobile = opts.mobile ?? false;

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  // ── Desktop path ──────────────────────────────────────────────────────────
  if (!mobile) {
    // Normal pass — feeds SSAO.
    const normalPass = new NormalPass(scene, camera);
    composer.addPass(normalPass);

    // SSAO — subtle ambient occlusion. Sample count halved for perf (16→8).
    const ssao = new SSAOEffect(camera, normalPass.texture, {
      samples: 8,
      rings: 3,
      distanceThreshold: 0.5,
      distanceFalloff: 0.08,
      rangeThreshold: 0.0015,
      rangeFalloff: 0.001,
      luminanceInfluence: 0.4,
      radius: 10,
      intensity: 0.9,
      bias: 0.04,
    });

    const bloom = new BloomEffect({
      intensity: 0.45,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.22,
      kernelSize: KernelSize.MEDIUM,
      mipmapBlur: true,
    });

    const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });

    const dof = new DepthOfFieldEffect(camera, {
      focusDistance: 0.02,
      focalLength: 0.20,
      bokehScale: 0.6,
    });

    // Color grading — slight cool shift in shadows, warm in highlights.
    const hueSat = new HueSaturationEffect({ saturation: 0.12 });
    const briCon = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });

    const toneMap = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    // Order: SSAO → DOF → color grade → bloom → vignette → tone.
    composer.addPass(new EffectPass(camera, ssao, dof, hueSat, briCon, bloom, vignette, toneMap));

    return {
      composer, bloom, vignette, dof,
      setSize: (w, h) => composer.setSize(w, h),
      render:  (dt)   => composer.render(dt),
    };
  }

  // ── Mobile path: bloom + vignette + tone only ─────────────────────────────
  // Skips SSAO, NormalPass, DOF, HueSat, BriCon — ~2× faster on mobile GPUs.
  const bloom = new BloomEffect({
    intensity: 0.35,
    luminanceThreshold: 0.82,
    luminanceSmoothing: 0.18,
    kernelSize: KernelSize.SMALL,
    mipmapBlur: true,
  });

  const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });

  // Stub DOF so the PostFx interface stays consistent (not used in mobile pass).
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 0.02,
    focalLength: 0.20,
    bokehScale: 0.0, // effectively disabled
  });

  const toneMap = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  composer.addPass(new EffectPass(camera, bloom, vignette, toneMap));

  return {
    composer, bloom, vignette, dof,
    setSize: (w, h) => composer.setSize(w, h),
    render:  (dt)   => composer.render(dt),
  };
}
