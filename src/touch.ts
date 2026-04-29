// Mobile touch controls — virtual joystick (left half) + action buttons (right).
// Plugs into the same Keys object used by keyboard input, no physics changes needed.
// Joystick gives analog steering; boolean fwd/back from Y axis.

export interface TouchKeys {
  fwd: boolean; back: boolean;
  left: boolean; right: boolean;
  brake: boolean; handbrake: boolean; boost: boolean;
  steerAnalog: number; // -1..1, read by applyDriveInput for smoother mobile feel
}

export function isMobile(): boolean {
  return navigator.maxTouchPoints > 0;
}

const OUTER_R  = 52;  // outer ring radius in CSS px
const MAX_DISP = 44;  // max knob travel from center
const DEAD_PX  = 8;   // dead zone radius

export function setupTouchControls(
  keys: TouchKeys,
  actions: { reset(): void; radioToggle(): void; }
): () => void {
  if (!isMobile()) return () => {};

  // ── Joystick ──────────────────────────────────────────────────────────────
  const stick = document.createElement("div");
  stick.id = "tc-stick";
  stick.innerHTML = '<div id="tc-knob"></div>';
  document.body.appendChild(stick);
  const knob = document.getElementById("tc-knob")!;

  // ── Button strip ──────────────────────────────────────────────────────────
  const strip = document.createElement("div");
  strip.id = "tc-strip";
  strip.innerHTML = `
    <button id="tc-brake" class="tc-btn tc-big">brake</button>
    <button id="tc-boost" class="tc-btn">boost</button>
    <div class="tc-row">
      <button id="tc-reset" class="tc-btn tc-sm">reset</button>
      <button id="tc-radio" class="tc-btn tc-sm">radio</button>
    </div>
  `;
  document.body.appendChild(strip);

  // ── Portrait warning ──────────────────────────────────────────────────────
  const rotMsg = document.createElement("div");
  rotMsg.id = "tc-rotate";
  rotMsg.textContent = "rotate for best experience";
  document.body.appendChild(rotMsg);
  const checkOrient = () =>
    rotMsg.classList.toggle("show", window.innerHeight > window.innerWidth * 1.1);
  window.addEventListener("resize", checkOrient);
  checkOrient();

  // ── Joystick tracking ─────────────────────────────────────────────────────
  let stickId: number | null = null;

  function moveStick(x: number, y: number) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, MAX_DISP);
    const angle  = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

    const inDead = dist < DEAD_PX;
    const nx =  inDead ? 0 : Math.max(-1, Math.min(1, dx / MAX_DISP));
    const ny =  inDead ? 0 : Math.max(-1, Math.min(1, dy / MAX_DISP));

    keys.steerAnalog = nx;                 // analog for smoother steering
    keys.left  = nx < -0.22;
    keys.right = nx >  0.22;
    keys.fwd   = ny < -0.22;
    keys.back  = ny >  0.22;
  }

  function releaseStick() {
    stickId = null;
    knob.style.transform = "translate(-50%, -50%)";
    keys.steerAnalog = 0;
    keys.left = keys.right = keys.fwd = keys.back = false;
  }

  // Left half of screen → joystick; right half buttons handle themselves
  document.addEventListener("touchstart", (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (stickId === null && t.clientX < window.innerWidth * 0.55) {
        stickId = t.identifier;
        moveStick(t.clientX, t.clientY);
      }
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) moveStick(t.clientX, t.clientY);
    }
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) releaseStick();
    }
  }, { passive: true });

  document.addEventListener("touchcancel", () => releaseStick(), { passive: true });

  // ── Button helpers ────────────────────────────────────────────────────────
  function makeHold(id: string, set: (v: boolean) => void) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
    el.addEventListener("touchend",    () => set(false));
    el.addEventListener("touchcancel", () => set(false));
  }

  // brake button covers both brake + handbrake so it's always useful
  makeHold("tc-brake", v => { keys.brake = v; keys.handbrake = v; });
  makeHold("tc-boost", v => keys.boost = v);

  document.getElementById("tc-reset")?.addEventListener("touchstart", (e) => {
    e.preventDefault(); actions.reset();
  }, { passive: false });

  document.getElementById("tc-radio")?.addEventListener("touchstart", (e) => {
    e.preventDefault(); actions.radioToggle();
  }, { passive: false });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  return () => {
    stick.remove();
    strip.remove();
    rotMsg.remove();
    window.removeEventListener("resize", checkOrient);
  };
}
