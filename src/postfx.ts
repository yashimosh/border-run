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

  // setSize takes already-scaled CSS pixel dimensions (caller manages render scale).
  const makeSetSize = (c: EffectComposer) =>
    (w: number, h: number) => c.setSize(Math.floor(w), Math.floor(h));

  // HalfFloat gives true HDR intermediate buffers (better bloom on desktop).
  // On mobile, the EXT_color_buffer_half_float path can be significantly slower
  // on Chrome/Brave Android vs Samsung Internet due to GPU sandbox overhead.
  // UnsignedByte is universally fast; bloom is computed from LDR values but the
  // visual difference on a phone screen is not perceptible.
  const composer = new EffectComposer(renderer, {
    frameBufferType: mobile ? THREE.UnsignedByteType : THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const smaa = new SMAAEffect();

  // ── High quality: SSAO + NormalPass + DOF + color grade ───────────────────
  // NormalPass re-draws the entire scene a second time. Desktop-only: mobile
  // GPUs have too little bandwidth for the extra geometry pass.
  if (!mobile && quality === "high") {
    const normalPass = new NormalPass(scene, camera);
    composer.addPass(normalPass);

    const ssao = new SSAOEffect(camera, normalPass.texture, {
      samples: 8, rings: 3,
      distanceThreshold: 0.5, distanceFalloff: 0.08,
      rangeThreshold: 0.0015, rangeFalloff: 0.001,
      luminanceInfluence: 0.4, radius: 10, intensity: 0.9, bias: 0.04,
    });

    const bloom    = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, kernelSize: KernelSize.MEDIUM, mipmapBlur: true });
    const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
    const dof      = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: 0.6 });
    const hueSat   = new HueSaturationEffect({ saturation: 0.12 });
    const briCon   = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    const toneMap  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    composer.addPass(new EffectPass(camera, ssao, dof, hueSat, briCon, bloom, vignette, toneMap));
    composer.addPass(new EffectPass(camera, smaa));
    return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
  }

  // ── Medium quality: DOF + color grade + bloom, no SSAO ────────────────────
  // Single scene render. Works for high-end mobile and mid-range desktop.
  // DOF bokeh is halved on mobile to save bandwidth; color grade is cheap either way.
  if (quality === "medium") {
    const bloom    = new BloomEffect({ intensity: 0.42, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, kernelSize: KernelSize.MEDIUM, mipmapBlur: true });
    const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
    const dof      = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: mobile ? 0.3 : 0.6 });
    const hueSat   = new HueSaturationEffect({ saturation: 0.12 });
    const briCon   = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    const toneMap  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    composer.addPass(new EffectPass(camera, dof, hueSat, briCon, bloom, vignette, toneMap));
    composer.addPass(new EffectPass(camera, smaa));
    return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
  }

  // ── Low quality: bloom + vignette + tone + SMAA ───────────────────────────
  // Minimum viable path. Used for: Brave (shields throttle WebGL ops),
  // budget mobile, weak desktop GPUs, adaptive fallback.
  const bloom    = new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.82, luminanceSmoothing: 0.18, kernelSize: KernelSize.SMALL, mipmapBlur: true });
  const vignette = new VignetteEffect({ darkness: 0.7, offset: 0.32 });
  const dof      = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.20, bokehScale: 0.0 }); // stub
  const toneMap  = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  composer.addPass(new EffectPass(camera, bloom, vignette, toneMap));
  composer.addPass(new EffectPass(camera, smaa));
  return { composer, bloom, vignette, dof, smaa, setSize: makeSetSize(composer), render: (dt) => composer.render(dt) };
}
