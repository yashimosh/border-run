// Postfx — bloom + vignette + tone mapping + SMAA + render scale.
// Bloom catches headlight/brake-light/horizon emissives; vignette focuses
// attention on the truck without dimming the dawn sky.
//
// Anti-aliasing: SMAA (Subpixel Morphological AA) runs as a dedicated final
// pass after tone mapping — it needs LDR input for correct edge detection.
// SMAA is the best practical AA for WebGL: no TAA reprojection ghosts, no
// FXAA blur, and unlike MSAA it handles the postprocessing chain cleanly.
//
// Render scale: the composer renders internally at (w * renderScale) ×
// (h * renderScale) and the GPU bilinear-upscales the result to the canvas.
// 0.75 gives ~44% fewer pixels with barely visible softening at arm's length.
// The canvas CSS size is unchanged — the user sees a full-screen image.
//
// Mobile path skips SSAO + NormalPass + DOF + color-grade to keep 60fps
// on mid-range phones. The visual difference is subtle outdoors in daylight.

import * as THREE from "three";
import {
  EffectComposer, EffectPass, RenderPass, BloomEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, KernelSize,
  DepthOfFieldEffect, SSAOEffect, NormalPass,
  HueSaturationEffect, BrightnessContrastEffect,
  SMAAEffect,
} from "postprocessing";

export interface PostFx {
  composer: EffectComposer;
  bloom: BloomEffect;
  vignette: VignetteEffect;
  dof: DepthOfFieldEffect;
  smaa: SMAAEffect;
  setSize: (w: number, h: number) => void;
  render: (dt: number) => void;
}

export interface PostFxOptions {
  /** Mobile quality: skip SSAO + NormalPass + DOF + color-grade, smaller bloom kernel. */
  mobile?: boolean;
  /**
   * Render scale factor 0.5–1.0 (default 1.0 = native resolution).
   * The composer renders internally at this fraction of the canvas size;
   * the GPU upscales the result. 0.75 saves ~44% fill rate; 0.85 saves ~28%.
   */
  renderScale?: number;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: PostFxOptions = {},
): PostFx {
  const mobile = opts.mobile ?? false;
  const renderScale = Math.max(0.25, Math.min(1.0, opts.renderScale ?? 1.0));

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  // Shared SMAA instance — same quality preset works for both paths.
  const smaa = new SMAAEffect();

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

    // Pass 1 — scene effects: SSAO → DOF → color grade → bloom → vignette → tone.
    composer.addPass(new EffectPass(camera, ssao, dof, hueSat, briCon, bloom, vignette, toneMap));
    // Pass 2 — SMAA: spatial edge-detect + blend in LDR space, after tone mapping.
    composer.addPass(new EffectPass(camera, smaa));

    return {
      composer, bloom, vignette, dof, smaa,
      setSize: (w, h) => {
        // Canvas stays at w × h (set by renderer.setSize in main.ts).
        // Composer renders internally at scaled resolution; GPU upscales on blit.
        composer.setSize(Math.floor(w * renderScale), Math.floor(h * renderScale));
      },
      render: (dt) => composer.render(dt),
    };
  }

  // ── Mobile path: bloom + vignette + tone + SMAA ───────────────────────────
  // Skips SSAO, NormalPass, DOF, HueSat, BriCon — ~2× faster on mobile GPUs.
  // SMAA is cheap enough to keep: it visibly reduces shimmer on foliage/wires.
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

  // Pass 1 — scene effects.
  composer.addPass(new EffectPass(camera, bloom, vignette, toneMap));
  // Pass 2 — SMAA in LDR space.
  composer.addPass(new EffectPass(camera, smaa));

  return {
    composer, bloom, vignette, dof, smaa,
    setSize: (w, h) => {
      composer.setSize(Math.floor(w * renderScale), Math.floor(h * renderScale));
    },
    render: (dt) => composer.render(dt),
  };
}
