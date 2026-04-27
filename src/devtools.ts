// Devtools — debug GUI (lil-gui) + FPS overlay (stats.js).
// Hidden by default, toggled with `~` (backtick) key. Production-friendly.

import GUI from "lil-gui";
import Stats from "stats.js";

export interface TunableState {
  // Physics
  engineForceMultiplier: number;
  brakeMultiplier: number;
  frictionSlip: number;
  // Visuals
  fogNear: number;
  fogFar: number;
  sunIntensity: number;
  hemiIntensity: number;
  // Camera
  cameraHeight: number;
  cameraDistance: number;
  // Postfx
  bloomIntensity: number;
  vignetteDarkness: number;
}

export const DEFAULT_TUNABLES: TunableState = {
  engineForceMultiplier: 1.0,
  brakeMultiplier: 1.0,
  frictionSlip: 2.2,
  fogNear: 100,
  fogFar: 320,
  sunIntensity: 0.8,
  hemiIntensity: 0.7,
  cameraHeight: 5.6,
  cameraDistance: 10,
  bloomIntensity: 0.55,
  vignetteDarkness: 0.7,
};

export function createDevtools() {
  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.style.display = "none";
  stats.dom.style.position = "fixed";
  stats.dom.style.left = "12px";
  stats.dom.style.bottom = "60px";
  stats.dom.style.top = "auto";
  document.body.appendChild(stats.dom);

  const tunables: TunableState = { ...DEFAULT_TUNABLES };
  const gui = new GUI({ title: "border run · debug" });
  gui.close(); // collapsed by default
  gui.domElement.style.display = "none";

  const physics = gui.addFolder("physics");
  physics.add(tunables, "engineForceMultiplier", 0.3, 2.5, 0.05);
  physics.add(tunables, "brakeMultiplier", 0.2, 3.0, 0.05);
  physics.add(tunables, "frictionSlip", 0.6, 4.0, 0.1);

  const visuals = gui.addFolder("visuals");
  visuals.add(tunables, "fogNear", 20, 200, 5);
  visuals.add(tunables, "fogFar", 100, 600, 10);
  visuals.add(tunables, "sunIntensity", 0, 2, 0.05);
  visuals.add(tunables, "hemiIntensity", 0, 2, 0.05);

  const camera = gui.addFolder("camera");
  camera.add(tunables, "cameraHeight", 2, 12, 0.1);
  camera.add(tunables, "cameraDistance", 5, 20, 0.1);

  const postfx = gui.addFolder("postfx");
  postfx.add(tunables, "bloomIntensity", 0, 2, 0.05);
  postfx.add(tunables, "vignetteDarkness", 0, 1.5, 0.05);

  let visible = false;
  const toggle = () => {
    visible = !visible;
    stats.dom.style.display = visible ? "block" : "none";
    gui.domElement.style.display = visible ? "block" : "none";
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote") { toggle(); e.preventDefault(); }
  });

  return {
    stats,
    gui,
    tunables,
    begin: () => stats.begin(),
    end: () => stats.end(),
  };
}
