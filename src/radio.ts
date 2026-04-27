// Radio — playable in-cabin audio. Ships with empty stations (just static)
// because shipping copyrighted songs would be illegal and shipping CC0 music
// I picked would override your taste. Drop your own MP3s in public/radio/
// and list them in DEFAULT_STATIONS below.

export type ProceduralMode = "drift" | "song-slow" | "song-mid";

export interface RadioStation {
  name: string;
  url?: string;        // relative path, e.g. "/radio/track1.mp3"
  procedural?: ProceduralMode; // if set, generate synth instead of playing a file
}

export const DEFAULT_STATIONS: RadioStation[] = [
  // Three working procedural stations. Drop MP3s in public/radio/ and replace
  // the procedural fields with url fields when you have music to ship.
  { name: "longwave / dawn drift", procedural: "song-slow" },
  { name: "qandil fm", procedural: "song-mid" },
  { name: "تهران ۱", procedural: "drift" },
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
      this.procedural = new ProceduralPlayer(this.ctx, this.filter, s.procedural);
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
  private out: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private droneLFO: OscillatorNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padLFO: OscillatorNode | null = null;
  private pluckTimer: number | null = null;
  private barTimer: number | null = null;
  private alive = false;
  private mode: ProceduralMode;
  private barCount = 0;

  // A natural minor scale (Hz, two octaves).
  private scale = [
    110.00, 123.47, 130.81, 146.83, 164.81, 174.61, 196.00, // A2..G3
    220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00,
  ];

  // 4-chord progression in A minor: i - VI - III - VII (Am - F - C - G).
  // Each entry: [bass Hz, triad Hz × 3].
  private progression = [
    { bass: 55.00, chord: [220.00, 261.63, 329.63] }, // Am
    { bass: 43.65, chord: [174.61, 220.00, 261.63] }, // F
    { bass: 32.70, chord: [261.63, 329.63, 392.00] }, // C
    { bass: 49.00, chord: [196.00, 246.94, 293.66] }, // G
  ];

  constructor(ctx: AudioContext, dest: AudioNode, mode: ProceduralMode) {
    this.ctx = ctx;
    this.mode = mode;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  start() {
    if (this.mode === "drift") this.startDrift();
    else this.startSong();
  }

  private startSong() {
    this.alive = true;
    this.out.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.6);
    this.scheduleNextBar();
  }

  private scheduleNextBar() {
    if (!this.alive) return;
    const bpm = this.mode === "song-slow" ? 64 : 92;
    const barSec = (60 / bpm) * 4; // 4 beats per bar
    const t0 = this.ctx.currentTime + 0.05;

    const chordIdx = this.barCount % this.progression.length;
    const chord = this.progression[chordIdx];

    // Bass on beat 1 (and beat 3 in song-mid for momentum).
    this.bassNote(chord.bass, t0, barSec * 0.9);
    if (this.mode === "song-mid") this.bassNote(chord.bass, t0 + barSec * 0.5, barSec * 0.45);

    // Pad: triad sustained for the bar.
    for (const hz of chord.chord) this.padNote(hz, t0, barSec);

    // Melody: 1–3 sparse notes per bar from the scale, biased toward the chord tones.
    const motes = this.mode === "song-mid" ? 3 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < motes; i++) {
      const at = t0 + (i / motes) * barSec + (Math.random() - 0.3) * barSec * 0.15;
      // 60% chord tone, 40% scale note.
      const hz = Math.random() < 0.6
        ? chord.chord[Math.floor(Math.random() * chord.chord.length)] * (Math.random() < 0.4 ? 2 : 1)
        : this.scale[7 + Math.floor(Math.random() * 7)];
      this.melodyNote(hz, at);
    }

    // Drums in song-mid only — soft kick on 1 and 3, hat on every beat.
    if (this.mode === "song-mid") {
      const beat = barSec / 4;
      this.kick(t0);
      this.kick(t0 + beat * 2);
      for (let b = 0; b < 4; b++) this.hat(t0 + beat * b + beat * 0.5);
    }

    this.barCount++;
    this.barTimer = window.setTimeout(() => this.scheduleNextBar(), barSec * 1000 - 30);
  }

  private bassNote(hz: number, t: number, dur: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 320;
    filt.Q.value = 0.4;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18, t + 0.02);
    env.gain.setValueAtTime(0.18, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt).connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private padNote(hz: number, t: number, dur: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz;
    osc.detune.value = (Math.random() - 0.5) * 8; // slight chorus
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 1200;
    filt.Q.value = 0.5;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.06, t + 0.4);
    env.gain.setValueAtTime(0.06, t + dur - 0.4);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt).connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private melodyNote(hz: number, t: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(2400, t);
    filt.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.13, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(filt).connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.85);
  }

  private kick(t: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private hat(t: number) {
    const buf = this.ctx.createBufferSource();
    buf.buffer = this.makeShortNoise();
    const filt = this.ctx.createBiquadFilter();
    filt.type = "highpass";
    filt.frequency.value = 4000;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.045, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    buf.connect(filt).connect(env).connect(this.out);
    buf.start(t);
    buf.stop(t + 0.1);
  }

  private makeShortNoise(): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * 0.1);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private startDrift() {
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
        const stepIdx = Math.max(0, Math.min(this.scale.length - 1, lastIdx + (Math.floor(Math.random() * 5) - 2)));
        lastIdx = stepIdx;
        const noteHz = this.scale[stepIdx];
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
    if (this.pluckTimer !== null) { clearTimeout(this.pluckTimer); this.pluckTimer = null; }
    if (this.barTimer !== null) { clearTimeout(this.barTimer); this.barTimer = null; }
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
