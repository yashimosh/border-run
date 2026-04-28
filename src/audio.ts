// Audio — sample-based. Real engine loops (6 RPMs, crossfaded), real
// desert wind (Atacama, CC0), real tires-on-gravel. All CC0; no attribution
// required but acknowledged in /CREDITS.md.
//
// The synthesized version that lived here before hit a ceiling — engine
// noise is the kind of thing samples just do better.

import type { VehicleKind } from "./vehicle";

const ENGINE_URLS = [
  "/sfx/engine/loop_0.wav",
  "/sfx/engine/loop_1_0.wav",
  "/sfx/engine/loop_2_0.wav",
  "/sfx/engine/loop_3_0.wav",
  "/sfx/engine/loop_4_0.wav",
  "/sfx/engine/loop_5_0.wav",
];
const WIND_URL = "/sfx/wind_desert.mp3";
const TIRE_URL = "/sfx/tires_gravel.mp3";

export class AudioSystem {
  ctx: AudioContext;
  master: GainNode;
  private engine: SampleEngine | null = null;
  private wind: SampleLoop | null = null;
  private tire: SampleLoop | null = null;
  private kind: VehicleKind;
  private ready = false;
  private muted = false;

  constructor(kind: VehicleKind) {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.kind = kind;
    this.loadAll();
  }

  private async loadAll() {
    try {
      const [engineBuffers, windBuf, tireBuf] = await Promise.all([
        Promise.all(ENGINE_URLS.map((u) => this.loadBuffer(u))),
        this.loadBuffer(WIND_URL),
        this.loadBuffer(TIRE_URL),
      ]);
      this.engine = new SampleEngine(this.ctx, this.master, engineBuffers, this.kind);
      this.wind = new SampleLoop(this.ctx, this.master, windBuf);
      this.tire = new SampleLoop(this.ctx, this.master, tireBuf);
      this.ready = true;
    } catch (err) {
      console.error("[audio] failed to load samples:", err);
    }
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const data = await res.arrayBuffer();
    return this.ctx.decodeAudioData(data);
  }

  // Called once per frame. throttle: -1..1 (signed). speed: m/s. onTrack: bool.
  update(dt: number, throttle: number, speed: number, onTrack: boolean) {
    if (!this.ready) return;
    this.engine!.update(dt, throttle, speed);

    // Wind: scales with speed. Atmospheric base.
    const windAmt = Math.min(0.32, 0.04 + speed * 0.014);
    this.wind!.setGain(windAmt);

    // Tire: quadratic in speed; brighter off-track. Pitch eases up with speed.
    const sf = Math.min(1, speed / 16);
    const tireAmt = sf * sf * (onTrack ? 0.22 : 0.4);
    this.tire!.setGain(tireAmt);
    this.tire!.setPlaybackRate(0.85 + sf * 0.55);
  }

  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}

// — Engine: 6 sample loops at different RPMs, all playing continuously,
// crossfaded by an RPM proxy. Pitched per vehicle (HJ75 a touch lower).
class SampleEngine {
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private throttleSmoothed = 0;
  private speedSmoothed = 0;
  private basePlaybackRate: number;

  constructor(ctx: AudioContext, dest: AudioNode, buffers: AudioBuffer[], kind: VehicleKind) {
    // HJ75 (diesel) pitched lower than FJ40 (gas). Subtle.
    this.basePlaybackRate = kind === "hj75" ? 0.78 : 0.95;
    for (let i = 0; i < buffers.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffers[i];
      src.loop = true;
      src.playbackRate.value = this.basePlaybackRate;
      const g = ctx.createGain();
      // First loop quietly audible at idle, others silent. Crossfade brings them in.
      g.gain.value = i === 0 ? 0.4 : 0;
      src.connect(g).connect(dest);
      src.start();
      this.sources.push(src);
      this.gains.push(g);
    }
  }

  update(dt: number, throttle: number, speed: number) {
    // Smoothed RPM proxy.
    this.throttleSmoothed += (Math.abs(throttle) - this.throttleSmoothed) * Math.min(1, dt * 5);
    this.speedSmoothed += (speed - this.speedSmoothed) * Math.min(1, dt * 3);
    const rpm = Math.min(1, this.throttleSmoothed * 0.55 + Math.min(this.speedSmoothed / 24, 0.6));

    // Crossfade adjacent loops based on rpm.
    const idx = rpm * (this.sources.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.min(this.sources.length - 1, lower + 1);
    const t = idx - lower;
    const ctx = this.sources[0].context;
    const now = ctx.currentTime;
    // Total volume rises with throttle so idle is whispery, full throttle has body.
    const totalGain = 0.32 + this.throttleSmoothed * 0.42;
    for (let i = 0; i < this.sources.length; i++) {
      let g = 0;
      if (i === lower) g = (1 - t) * totalGain;
      else if (i === upper) g = t * totalGain;
      this.gains[i].gain.setTargetAtTime(g, now, 0.06);
    }

    // Subtle pitch nudge with throttle so the engine "leans in" when revving.
    const playRate = this.basePlaybackRate * (1 + this.throttleSmoothed * 0.08);
    for (const s of this.sources) s.playbackRate.setTargetAtTime(playRate, now, 0.08);
  }
}

// — A single looping sample with controllable gain + playback rate.
class SampleLoop {
  private src: AudioBufferSourceNode;
  private gain: GainNode;

  constructor(ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer) {
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.gain).connect(dest);
    this.src.start();
  }

  setGain(v: number) {
    this.gain.gain.setTargetAtTime(v, this.src.context.currentTime, 0.1);
  }

  setPlaybackRate(r: number) {
    this.src.playbackRate.setTargetAtTime(r, this.src.context.currentTime, 0.1);
  }
}
