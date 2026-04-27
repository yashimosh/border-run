// Radio — playable in-cabin audio. Ships with empty stations (just static)
// because shipping copyrighted songs would be illegal and shipping CC0 music
// I picked would override your taste. Drop your own MP3s in public/radio/
// and list them in DEFAULT_STATIONS below.

export interface RadioStation {
  name: string;
  url?: string; // relative to /, e.g. "/radio/track1.mp3". Undefined = static.
}

export const DEFAULT_STATIONS: RadioStation[] = [
  // Edit these. Drop files in public/radio/ and reference them here.
  { name: "longwave", url: undefined }, // → static
  { name: "تهران ۱", url: undefined },
  { name: "qandil fm", url: undefined },
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
  }

  private tune(i: number) {
    this.stopAll();
    this.currentIdx = i;
    const s = this.stations[i];
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
