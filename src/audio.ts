// Audio — fully procedural via the Web Audio API.
// No samples, no licensing, no asset pipeline. Every sound is synthesized at runtime.
// The register is diegetic: engine, wind, tire-on-gravel. No music.

import type { VehicleKind } from "./vehicle";

interface AudioConfig {
  idleHz: number;
  throttleSweep: number;
  speedHz: number;
  roughness: number;
  filterMin: number;
  filterMax: number;
  // How deep the chug AM goes (0..1). Diesels chug more than gas.
  chugDepth: number;
  // Engine-mount wobble depth in Hz (random/LFO modulation on fundamental).
  wobbleHz: number;
}

const PROFILES: Record<VehicleKind, AudioConfig> = {
  // FJ40: 2F gas engine — warm, slightly wheezy, no whine.
  fj40: { idleHz: 72, throttleSweep: 110, speedHz: 1.4, roughness: 0.10, filterMin: 320, filterMax: 1400, chugDepth: 0.10, wobbleHz: 1.4 },
  // HJ75: B-series diesel — fuller body, slower chug, more bass.
  hj75: { idleHz: 50, throttleSweep: 90, speedHz: 1.1, roughness: 0.16, filterMin: 240, filterMax: 1150, chugDepth: 0.16, wobbleHz: 0.9 },
};

export class AudioSystem {
  ctx: AudioContext;
  master: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private osc3!: OscillatorNode;
  private engineNoiseGain!: GainNode;
  private engineNoise!: AudioBufferSourceNode;
  private chugLFO!: OscillatorNode;
  private chugDepth!: GainNode;
  private chugBias!: ConstantSourceNode;
  private chugAM!: GainNode;
  private wobbleLFO!: OscillatorNode;
  private wobbleDepth!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private wind!: AudioBufferSourceNode;
  private tireGain!: GainNode;
  private tireFilter!: BiquadFilterNode;
  private tire!: AudioBufferSourceNode;
  private profile: AudioConfig;
  private muted = false;
  private throttleSmoothed = 0;
  private speedSmoothed = 0;

  constructor(kind: VehicleKind) {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.profile = PROFILES[kind];

    this.buildEngine();
    this.buildWind();
    this.buildTire();
  }

  private buildEngine() {
    const { ctx, profile } = this;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = profile.filterMin;
    this.engineFilter.Q.value = 0.6;

    // Engine layers: sub (body) + fundamental (warm) + a tiny shimmer harmonic
    // that only contributes under throttle. Triangle waves throughout for warmth;
    // no square — that was the source of the previous "whine".
    this.osc1 = ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc1.frequency.value = profile.idleHz;
    const g1 = ctx.createGain(); g1.gain.value = 0.45;

    this.osc2 = ctx.createOscillator();
    this.osc2.type = "triangle"; // was square — too harsh
    this.osc2.frequency.value = profile.idleHz * 1.5; // 5th-ish, not the buzzy octave
    this.osc2.detune.value = -7;
    const g2 = ctx.createGain(); g2.gain.value = 0.08; // much quieter

    this.osc3 = ctx.createOscillator();
    this.osc3.type = "sawtooth";
    this.osc3.frequency.value = profile.idleHz * 0.5;
    this.osc3.detune.value = 4;
    const g3 = ctx.createGain(); g3.gain.value = 0.32; // beefier sub for body

    this.osc1.connect(g1).connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.osc3.connect(g3).connect(this.engineFilter);

    // Engine-mount wobble: slow LFO modulating the fundamental ±wobbleHz.
    // Sells the "tired old motor that has seen things" character.
    this.wobbleLFO = ctx.createOscillator();
    this.wobbleLFO.type = "sine";
    this.wobbleLFO.frequency.value = profile.wobbleHz;
    this.wobbleDepth = ctx.createGain();
    this.wobbleDepth.gain.value = 1.8; // ±1.8 Hz wobble at idle
    this.wobbleLFO.connect(this.wobbleDepth);
    this.wobbleDepth.connect(this.osc1.frequency);
    this.wobbleDepth.connect(this.osc2.frequency);

    // Chug tremolo: AM at engine_hz/4. Gives the actual putt-putt-putt rhythm.
    // Implementation: chugAM.gain = chugBias + chugLFO * chugDepth, then route audio through chugAM.
    this.chugLFO = ctx.createOscillator();
    this.chugLFO.type = "sine";
    this.chugLFO.frequency.value = profile.idleHz / 4;
    this.chugDepth = ctx.createGain();
    this.chugDepth.gain.value = profile.chugDepth;
    this.chugBias = ctx.createConstantSource();
    this.chugBias.offset.value = 1 - profile.chugDepth;
    this.chugAM = ctx.createGain();
    this.chugAM.gain.value = 0; // start silent; bias + LFO will set it
    this.chugBias.connect(this.chugAM.gain);
    this.chugLFO.connect(this.chugDepth).connect(this.chugAM.gain);

    // Brown noise layer for mechanical roughness.
    this.engineNoise = ctx.createBufferSource();
    this.engineNoise.buffer = makeBrownNoise(ctx, 2);
    this.engineNoise.loop = true;
    this.engineNoiseGain = ctx.createGain();
    this.engineNoiseGain.gain.value = profile.roughness;
    this.engineNoise.connect(this.engineNoiseGain).connect(this.engineFilter);

    // Route engine through chug AM, then steady gain, then master.
    this.engineFilter.connect(this.chugAM).connect(this.engineGain).connect(this.master);

    this.osc1.start();
    this.osc2.start();
    this.osc3.start();
    this.engineNoise.start();
    this.wobbleLFO.start();
    this.chugLFO.start();
    this.chugBias.start();
  }

  private buildWind() {
    const { ctx } = this;
    this.wind = ctx.createBufferSource();
    this.wind.buffer = makePinkNoise(ctx, 4);
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.04; // base wind
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();
  }

  private buildTire() {
    const { ctx } = this;
    this.tire = ctx.createBufferSource();
    this.tire.buffer = makeWhiteNoise(ctx, 3);
    this.tire.loop = true;
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = "bandpass";
    this.tireFilter.frequency.value = 1800;
    this.tireFilter.Q.value = 1.2;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0.0;
    this.tire.connect(this.tireFilter).connect(this.tireGain).connect(this.master);
    this.tire.start();
  }

  // Called once per frame from main tick.
  // throttle: -1..1 (positive = forward), speed: m/s, onTrack: bool
  update(dt: number, throttle: number, speed: number, onTrack: boolean) {
    // Smooth inputs so engine doesn't snap.
    const k = Math.min(1, dt * 5);
    this.throttleSmoothed += (Math.abs(throttle) - this.throttleSmoothed) * k;
    this.speedSmoothed += (speed - this.speedSmoothed) * Math.min(1, dt * 3);

    const { profile } = this;
    // Engine pitch: idle + throttle sweep + speed component.
    const targetHz = profile.idleHz + this.throttleSmoothed * profile.throttleSweep + this.speedSmoothed * profile.speedHz;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(targetHz, t, 0.04);
    this.osc2.frequency.setTargetAtTime(targetHz * 2, t, 0.04);
    this.osc3.frequency.setTargetAtTime(targetHz * 0.5, t, 0.04);

    // Chug rhythm: cylinder firing rate. Idle = pulses you hear as putt-putt;
    // higher RPM = pitched drone, so the chug AM should fade out — otherwise
    // it buzzes annoyingly at speed.
    const chugFreq = targetHz / 4;
    this.chugLFO.frequency.setTargetAtTime(chugFreq, t, 0.06);
    const chugFade = 1 - Math.min(1, this.throttleSmoothed * 1.5); // gone above ~67% throttle
    this.chugDepth.gain.setTargetAtTime(profile.chugDepth * chugFade, t, 0.06);
    this.chugBias.offset.setTargetAtTime(1 - profile.chugDepth * chugFade, t, 0.06);
    // Wobble eases off under throttle — motor smooths when working hard.
    this.wobbleDepth.gain.setTargetAtTime((1.8 - this.throttleSmoothed * 1.4), t, 0.1);

    // Engine filter opens up with throttle.
    const cutoff = profile.filterMin + this.throttleSmoothed * (profile.filterMax - profile.filterMin);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.05);

    // Engine gain — quieter overall (was overpowering). Idle is whispery,
    // full throttle has body without dominating.
    const engineGain = 0.10 + this.throttleSmoothed * 0.18;
    this.engineGain.gain.setTargetAtTime(engineGain, t, 0.05);

    // Wind: atmospheric, much quieter than before. Was the "sand-like noise"
    // the user complained about. Cap at 0.08 (was 0.18); slow LFO for breathiness.
    const windAmt = Math.min(0.08, 0.012 + this.speedSmoothed * 0.005);
    this.windGain.gain.setTargetAtTime(windAmt, t, 0.15);
    const windCutoff = 320 + this.speedSmoothed * 5;
    this.windFilter.frequency.setTargetAtTime(windCutoff, t, 0.25);

    // Tire: subtle, only really audible at speed. Was previously dominant.
    const speedFactor = Math.min(1, this.speedSmoothed / 18);
    const tireAmt = speedFactor * speedFactor * (onTrack ? 0.04 : 0.08);
    this.tireGain.gain.setTargetAtTime(tireAmt, t, 0.08);
    this.tireFilter.frequency.setTargetAtTime(onTrack ? 1200 : 1900, t, 0.18);
  }

  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.04);
    return this.muted;
  }
}

// — Noise buffer helpers.

function makeWhiteNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makePinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  // Voss-McCartney approximation — cheap and sounds right.
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

function makeBrownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}
