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

export type QualityTier =
  | "high"    // SSAO + NormalPass + DOF + color grade + bloom + SMAA. Two scene renders.
  | "medium"  // DOF + color grade + bloom + SMAA. One scene render. Good mid-range default.
  | "low";    // bloom + SMAA only. Matches mobile path. For weak GPUs or Brave shields.

export interface PostFxOptions {
  /** Mobile quality: skip SSAO + NormalPass + DOF + color-grade, smaller bloom kernel. */
  mobile?: boolean;
  /**
   * Quality tier for non-mobile (desktop) path.
   * - "high"   — full effects inc. SSAO (two scene renders; expensive).
   * - "medium" — DOF + color grade + bloom, no SSAO (default; one scene render).
   * - "low"    — bloom + SMAA only; same as mobile path.
   * Ignored when mobile=true.
   */
  quality?: QualityTier;
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
  const mobile  = opts.mobile ?? false;
  const quality = opts.quality ?? "medium";
  const renderScale = Math.max(0.25, Math.min(1.0, opts.renderScale ?? 1.0));

  const makeSetSize = (c: EffectComposer) =>
    (w: number, h: number) => c.setSize(Math.floor(w * renderScale), Math.floor(h * renderScale));

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const smaa = new SMAAEffect();

  // ── Desktop: high quality — SSAO + NormalPass + DOF + color grade ─────────
  // NormalPass re-draws the entire scene a second time to get geometry normals
  // for SSAO. Expensive. Only enable on machines that can afford it.
  if (!mobile && quality === "high") {
    const normalPass = new NormalPass(scene, camera);
    composer.addPass(normalPass);

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

    const bloom   = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, kernelSize: KernelSize.MEDIUM, mipmapBlur: true });
    const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
    const dof     = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: 0.6 });
    const hueSat  = new HueSaturationEffect({ saturation: 0.12 });
    const briCon  = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    const toneMap = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    composer.addPass(new EffectPass(camera, ssao, dof, hueSat, briCon, bloom, vignette, toneMap));
    composer.addPass(new EffectPass(camera, smaa));

    return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
  }

  // ── Desktop: medium quality — DOF + color grade + bloom, no SSAO ──────────
  // Single scene render. Drops the NormalPass entirely. Good default for most
  // desktop GPUs and any browser with shields/throttling (e.g. Brave).
  if (!mobile && quality === "medium") {
    const bloom    = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, kernelSize: KernelSize.MEDIUM, mipmapBlur: true });
    const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
    const dof      = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: 0.6 });
    const hueSat   = new HueSaturationEffect({ saturation: 0.12 });
    const briCon   = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    const toneMap  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    composer.addPass(new EffectPass(camera, dof, hueSat, briCon, bloom, vignette, toneMap));
    composer.addPass(new EffectPass(camera, smaa));

    return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
  }

  // ── Mobile / low quality: bloom + vignette + tone + SMAA ─────────────────
  // Skips SSAO, NormalPass, DOF, HueSat, BriCon.
  // Also used for desktop "low" tier (weak GPU, Brave with heavy shields, etc.).
  const bloom    = new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.82, luminanceSmoothing: 0.18, kernelSize: KernelSize.SMALL, mipmapBlur: true });
  const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
  const dof      = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: 0.0 }); // stub
  const toneMap  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  composer.addPass(new EffectPass(camera, bloom, vignette, toneMap));
  composer.addPass(new EffectPass(camera, smaa));

  return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
}
