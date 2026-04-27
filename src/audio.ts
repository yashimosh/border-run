// Audio — fully procedural via the Web Audio API.
// No samples, no licensing, no asset pipeline. Every sound is synthesized at runtime.
// The register is diegetic: engine, wind, tire-on-gravel. No music.

import type { VehicleKind } from "./vehicle";

interface AudioConfig {
  // Engine fundamental at idle, in Hz.
  idleHz: number;
  // Hz added at full throttle on top of idle.
  throttleSweep: number;
  // Hz added per (m/s) of road speed (mechanical-coupled).
  speedHz: number;
  // Engine roughness amount (brown-noise layer level).
  roughness: number;
  // Lowpass cutoff at idle / max throttle. (Hz)
  filterMin: number;
  filterMax: number;
}

const PROFILES: Record<VehicleKind, AudioConfig> = {
  fj40: { idleHz: 78, throttleSweep: 130, speedHz: 1.8, roughness: 0.18, filterMin: 380, filterMax: 1700 },
  hj75: { idleHz: 56, throttleSweep: 100, speedHz: 1.4, roughness: 0.32, filterMin: 280, filterMax: 1300 },
};

export class AudioSystem {
  private ctx: AudioContext;
  private master: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private osc3!: OscillatorNode;
  private engineNoiseGain!: GainNode;
  private engineNoise!: AudioBufferSourceNode;
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

    // Three oscillators stacked: fundamental + 2nd harmonic (firing) + 3rd (rough).
    this.osc1 = ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc1.frequency.value = profile.idleHz;
    const g1 = ctx.createGain(); g1.gain.value = 0.5;

    this.osc2 = ctx.createOscillator();
    this.osc2.type = "square";
    this.osc2.frequency.value = profile.idleHz * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;

    this.osc3 = ctx.createOscillator();
    this.osc3.type = "sawtooth";
    this.osc3.frequency.value = profile.idleHz * 0.5; // sub-octave for diesel chug
    const g3 = ctx.createGain(); g3.gain.value = 0.22;

    this.osc1.connect(g1).connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.osc3.connect(g3).connect(this.engineFilter);

    // Brown noise layer for mechanical roughness.
    this.engineNoise = ctx.createBufferSource();
    this.engineNoise.buffer = makeBrownNoise(ctx, 2);
    this.engineNoise.loop = true;
    this.engineNoiseGain = ctx.createGain();
    this.engineNoiseGain.gain.value = profile.roughness;
    this.engineNoise.connect(this.engineNoiseGain).connect(this.engineFilter);

    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.osc1.start();
    this.osc2.start();
    this.osc3.start();
    this.engineNoise.start();
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

    // Engine filter opens up with throttle.
    const cutoff = profile.filterMin + this.throttleSmoothed * (profile.filterMax - profile.filterMin);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.05);

    // Engine gain — present at idle, louder under throttle.
    const engineGain = 0.18 + this.throttleSmoothed * 0.32;
    this.engineGain.gain.setTargetAtTime(engineGain, t, 0.05);

    // Wind: scales with speed.
    const windAmt = Math.min(0.18, 0.03 + this.speedSmoothed * 0.012);
    this.windGain.gain.setTargetAtTime(windAmt, t, 0.1);
    // Wind filter sharpens slightly at speed.
    const windCutoff = 380 + this.speedSmoothed * 8;
    this.windFilter.frequency.setTargetAtTime(windCutoff, t, 0.2);

    // Tire: gated by speed, brighter off-track.
    const speedFactor = Math.min(1, this.speedSmoothed / 14);
    const tireAmt = speedFactor * (onTrack ? 0.09 : 0.16);
    this.tireGain.gain.setTargetAtTime(tireAmt, t, 0.06);
    this.tireFilter.frequency.setTargetAtTime(onTrack ? 1500 : 2200, t, 0.15);
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
