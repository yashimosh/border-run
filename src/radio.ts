// Radio — playable in-cabin audio. Ships with empty stations (just static)
// because shipping copyrighted songs would be illegal and shipping CC0 music
// I picked would override your taste. Drop your own MP3s in public/radio/
// and list them in DEFAULT_STATIONS below.

export interface RadioStation {
  name: string;
  url?: string;        // relative path, e.g. "/radio/track1.mp3"
  procedural?: boolean; // if true, generate synth instead of playing a file
}

export const DEFAULT_STATIONS: RadioStation[] = [
  // First station ships working out of the box: a procedurally generated
  // shortwave-drift drone. No licensing, no taste-imposition. Honest fit.
  { name: "longwave / dawn drift", procedural: true },
  // The rest are placeholders — drop files in public/radio/ and add urls here.
  { name: "qandil fm", url: undefined },
  { name: "تهران ۱", url: undefined },
];

export class Radio {
  private ctx: AudioContext;
  private master: GainNode;
  private filter: BiquadFilterNode;
  private outGain: GainNode;
  private staticBuf: AudioBufferSourceNode | null = null;
  private staticGain: GainNode;
  private audioEl: HTMLAudioElement | null = null;
  private mediaSrc: MediaElementAudioSourceNode | null = null;
  private procedural: ProceduralPlayer | null = null;
  private stations: RadioStation[];
  private currentIdx = -1;
  private volume = 0.55;
  private hudEl: HTMLElement | null;

  constructor(ctx: AudioContext, master: GainNode, stations: RadioStation[]) {
    this.ctx = ctx;
    this.master = master;
    this.stations = stations;
    this.hudEl = document.getElementById("hud-radio");

    // AM-radio character: bandpass, slightly resonant.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "bandpass";
    this.filter.frequency.value = 1600;
    this.filter.Q.value = 0.55;
    this.outGain = ctx.createGain();
    this.outGain.gain.value = this.volume;
    this.filter.connect(this.outGain).connect(master);

    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    this.staticGain.connect(this.filter);

    this.updateHud();
  }

  toggle() {
    if (this.currentIdx === -1) this.tune(0);
    else this.off();
  }

  next() {
    if (this.stations.length === 0) return;
    const next = this.currentIdx === -1 ? 0 : (this.currentIdx + 1) % this.stations.length;
    this.tune(next);
  }

  prev() {
    if (this.stations.length === 0) return;
    const prev = this.currentIdx === -1 ? 0 : (this.currentIdx - 1 + this.stations.length) % this.stations.length;
    this.tune(prev);
  }

  off() {
    this.currentIdx = -1;
    this.stopAll();
    this.updateHud();
  }

  private stopAll() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = "";
      this.audioEl = null;
    }
    if (this.mediaSrc) {
      try { this.mediaSrc.disconnect(); } catch {}
      this.mediaSrc = null;
    }
    if (this.staticBuf) {
      try { this.staticBuf.stop(); } catch {}
      this.staticBuf = null;
    }
    this.staticGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if (this.procedural) { this.procedural.stop(); this.procedural = null; }
  }

  private tune(i: number) {
    this.stopAll();
    this.currentIdx = i;
    const s = this.stations[i];
    if (s.procedural) {
      this.procedural = new ProceduralPlayer(this.ctx, this.filter);
      this.procedural.start();
      this.updateHud();
      this.flashTuneIndicator();
      return;
    }
    if (s.url) {
      const el = new Audio(s.url);
      el.crossOrigin = "anonymous";
      el.loop = true;
      el.volume = 1.0;
      el.preload = "auto";
      el.addEventListener("error", () => {
        // Fallback to static if the file is missing.
        this.fadeInStatic();
      });
      el.play().catch(() => this.fadeInStatic());
      try {
        const src = this.ctx.createMediaElementSource(el);
        src.connect(this.filter);
        this.mediaSrc = src;
      } catch {
        // Already a source — fall back to static.
        this.fadeInStatic();
      }
      this.audioEl = el;
    } else {
      this.fadeInStatic();
    }
    this.updateHud();
    this.flashTuneIndicator();
  }

  private fadeInStatic() {
    const buf = this.ctx.createBufferSource();
    buf.buffer = this.makeNoise(3);
    buf.loop = true;
    buf.connect(this.staticGain);
    buf.start();
    this.staticBuf = buf;
    this.staticGain.gain.setTargetAtTime(0.45, this.ctx.currentTime, 0.18);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    return buf;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.outGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    this.updateHud();
  }

  bumpVolume(d: number) { this.setVolume(this.volume + d); }

  private updateHud() {
    if (!this.hudEl) return;
    if (this.currentIdx === -1) {
      this.hudEl.textContent = "off";
    } else {
      const s = this.stations[this.currentIdx];
      const status = s.url ? s.name : `${s.name} · static`;
      this.hudEl.textContent = `${status} · vol ${Math.round(this.volume * 100)}`;
    }
  }

  private flashTuneIndicator() {
    if (!this.hudEl) return;
    this.hudEl.classList.add("tuning");
    setTimeout(() => this.hudEl?.classList.remove("tuning"), 320);
  }
}

// — ProceduralPlayer: a procedurally-generated "station" that drifts.
// Drone bass + sparse plucks on A pentatonic minor + slow noise wash.
// Routes its own internal mix to a single output that hangs off Radio's
// AM-character bandpass, so it gets the same dusty-radio treatment.
class ProceduralPlayer {
  private ctx: AudioContext;
  private dest: AudioNode;
  private out: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private droneLFO: OscillatorNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padLFO: OscillatorNode | null = null;
  private pluckTimer: number | null = null;
  private alive = false;

  // A pentatonic minor in two octaves. Hz values.
  private notes = [
    110.00, 130.81, 146.83, 164.81, 196.00,         // A2 C3 D3 E3 G3
    220.00, 261.63, 293.66, 329.63, 392.00, 440.00, // A3 C4 D4 E4 G4 A4
  ];

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.dest = dest;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  start() {
    this.alive = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Drone: A1 (55Hz) + E2 (82.4Hz, perfect 5th) + slow detune wobble.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 700;
    droneFilter.Q.value = 0.5;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.13;
    droneFilter.connect(droneGain).connect(this.out);

    for (const [hz, level, detune] of [[55, 0.7, 0], [82.4, 0.5, 0], [110, 0.25, -3]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(droneFilter);
      o.start();
      this.droneOscs.push(o);
    }

    // Drone LFO: slow detune drift on the bass for the "tube radio breathing" feel.
    this.droneLFO = ctx.createOscillator();
    this.droneLFO.type = "sine";
    this.droneLFO.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 4;
    this.droneLFO.connect(lfoDepth);
    for (const o of this.droneOscs) lfoDepth.connect(o.detune);
    this.droneLFO.start();

    // Noise pad: pink noise through a slow-LFO bandpass — the "drift in/out".
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = makePink(ctx, 6);
    this.noiseSrc.loop = true;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "bandpass";
    this.padFilter.frequency.value = 800;
    this.padFilter.Q.value = 0.9;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.09;
    this.noiseSrc.connect(this.padFilter).connect(padGain).connect(this.out);
    this.noiseSrc.start();

    this.padLFO = ctx.createOscillator();
    this.padLFO.type = "sine";
    this.padLFO.frequency.value = 0.05;
    const padLfoDepth = ctx.createGain();
    padLfoDepth.gain.value = 600;
    this.padLFO.connect(padLfoDepth).connect(this.padFilter.frequency);
    this.padLFO.start();

    // Fade in.
    this.out.gain.setTargetAtTime(0.85, t, 0.6);

    // Pluck loop: schedule sparse melodic gestures on irregular intervals.
    this.scheduleNextPluck(2.5);
  }

  private scheduleNextPluck(delaySec: number) {
    this.pluckTimer = window.setTimeout(() => {
      if (!this.alive) return;
      // Sometimes a single note, sometimes two-note phrase, occasionally a triplet.
      const phraseLen = Math.random() < 0.55 ? 1 : Math.random() < 0.85 ? 2 : 3;
      let stepDelay = 0;
      let lastIdx = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < phraseLen; i++) {
        const stepIdx = Math.max(0, Math.min(this.notes.length - 1, lastIdx + (Math.floor(Math.random() * 5) - 2)));
        lastIdx = stepIdx;
        const noteHz = this.notes[stepIdx];
        this.pluck(noteHz, stepDelay);
        stepDelay += 0.35 + Math.random() * 0.3;
      }
      // Next phrase: 4–11 seconds away. Sparse on purpose.
      const next = 4 + Math.random() * 7;
      this.scheduleNextPluck(next);
    }, delaySec * 1000);
  }

  private pluck(freq: number, delaySec: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(2400, t);
    filt.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(filt).connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.85);
  }

  stop() {
    this.alive = false;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.15);
    if (this.pluckTimer !== null) {
      clearTimeout(this.pluckTimer);
      this.pluckTimer = null;
    }
    // Stop everything after a short fade.
    setTimeout(() => {
      try { this.droneLFO?.stop(); } catch {}
      try { this.padLFO?.stop(); } catch {}
      try { this.noiseSrc?.stop(); } catch {}
      for (const o of this.droneOscs) { try { o.stop(); } catch {} }
      try { this.out.disconnect(); } catch {}
    }, 400);
  }
}

function makePink(ctx: AudioContext, seconds: number): AudioBuffer {
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
