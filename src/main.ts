// Border Run — vertical slice.
// Three.js + cannon-es. Heightfield terrain with a baked dirt track,
// RaycastVehicle physics, two pickable Land Cruiser variants.

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoomEnvironment, Sky } from "three-stdlib";
import {
  TERRAIN_SIZE, TERRAIN_RES, BORDER_Z,
  buildHeights, buildHeightfieldBody, buildTerrainMesh, sampleHeight,
  buildWatchtower, buildHut, buildDistantRidges,
  buildRocks, buildScrub, buildBorderPosts, buildBorderLine,
  buildCairn, buildWreck, buildCypress, buildFlagPole,
  classifyZone, ZONE_TRACTION, buildAsphaltRoad,
} from "./world";
import {
  buildLimestoneSlab, buildPersianOak, buildStoneWall, buildStream,
  buildVillage, buildGoat, buildPylon, buildPowerLines,
  buildJuniper, buildBush,
} from "./scenery";
import {
  spawnGoat, spawnBarrel, syncProps, BirdFlock, honk, Prop,
  createGoatBrain, updateGoatBrains, GoatBrain, DustHaze,
} from "./props";
import { SPECS, VehicleKind, buildVehicle, syncVehicleMeshes, Vehicle } from "./vehicle";
import { AudioSystem } from "./audio";
import { Radio, DEFAULT_STATIONS, loadStations } from "./radio";
import { ParticleSystem } from "./particles";
import { spawnCargo, updateCargo, resetCargo, CargoItem } from "./cargo";
import { setupFeedback } from "./feedback";
import { recordSession, fetchStats, formatStats } from "./analytics";
import { createDevtools } from "./devtools";
import { createPostFx } from "./postfx";
import gsap from "gsap";
import { Howl } from "howler";

type Keys = {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  brake: boolean; handbrake: boolean; boost: boolean;
};

// Howler-loaded door-close SFX. Generated as a base64 WAV at build time so
// we don't ship an actual audio file but can still demo the Howler integration.
const DOOR_CLICK_DATAURI = makeDoorClickDataURI();
const doorClickHowl = new Howl({ src: [DOOR_CLICK_DATAURI], format: ["wav"], volume: 0.7 });

function boot() {
  const start = document.getElementById("start") as HTMLButtonElement | null;
  const title = document.getElementById("title");

  const readChoice = (): VehicleKind => {
    const checked = document.querySelector<HTMLInputElement>('input[name="vehicle-choice"]:checked');
    return (checked?.value as VehicleKind) || "fj40";
  };

  start?.addEventListener("click", () => {
    try { doorClickHowl.play(); } catch {}
    // Fade title via CSS transition (defined in index.html). Init immediately —
    // don't wait on GSAP's ticker (which can stall in some autoplay/throttle cases).
    if (title) {
      title.style.transition = "opacity 400ms ease";
      title.style.opacity = "0";
      setTimeout(() => title.classList.add("hidden"), 420);
    }
    init(readChoice());
  }, { once: true });

  // Allow keyboard shortcut: 1 picks FJ40, 2 picks HJ75. Either also dismisses title.
  window.addEventListener("keydown", (e) => {
    if (title?.classList.contains("hidden")) return;
    if (e.code === "Digit1" || e.code === "Digit2") {
      const k: VehicleKind = e.code === "Digit1" ? "fj40" : "hj75";
      title?.classList.add("hidden");
      init(k);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { hideLoader(); setupFeedback(); fillStatsLine(); boot(); });
} else {
  hideLoader();
  setupFeedback();
  fillStatsLine();
  boot();
}

async function fillStatsLine() {
  const el = document.getElementById("hud-stats");
  if (!el) return;
  const s = await fetchStats();
  if (s) el.textContent = formatStats(s);
}

function hideLoader() {
  const loader = document.getElementById("loader");
  if (!loader) return;
  loader.classList.add("hide");
  setTimeout(() => loader.remove(), 600);
}

function init(kind: VehicleKind) {
  // Record this play. Server sets a long-lived cookie on first visit so
  // unique-player counts work without a login.
  recordSession();

  const stage = document.getElementById("stage")!;
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // disabled — we use postprocessing-based smoothing
    powerPreference: "high-performance",
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0b0b0c);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; // postfx ToneMappingEffect handles this
  stage.appendChild(renderer.domElement);

  const dev = createDevtools();

  const scene = new THREE.Scene();

  // — Sky: Preetham atmospheric scattering, sun position drives lighting.
  const sky = new Sky();
  sky.scale.setScalar(15000);
  const skyMat = sky.material as THREE.ShaderMaterial & { uniforms: any };
  skyMat.uniforms.turbidity.value = 4.5;
  skyMat.uniforms.rayleigh.value = 1.6;
  skyMat.uniforms.mieCoefficient.value = 0.006;
  skyMat.uniforms.mieDirectionalG.value = 0.86;
  // Sun position is animated by the day/night cycle below — start at dawn.
  const sunPosition = new THREE.Vector3();
  let dayTime = 0.18; // 0..1 — 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk
  const updateSun = () => {
    // Map dayTime to elevation + azimuth. Dawn at 0.25 brings sun to 14°.
    const elevation = Math.sin(dayTime * Math.PI * 2) * 50; // -50..+50°
    const azimuth = (dayTime * 360 - 90) % 360; // sun moves east → west
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sunPosition.setFromSphericalCoords(1, phi, theta);
    skyMat.uniforms.sunPosition.value.copy(sunPosition);
  };
  updateSun();
  scene.add(sky);

  // Stronger atmospheric depth — Over-the-Hill diorama feel. Fog dissolves
  // distance into a warm dawn haze.
  scene.fog = new THREE.Fog(0xc7b89a, 60, 280);

  // IBL probe for chrome/glass fill. Cheap RoomEnvironment is fine here — the
  // sky shader handles the visible atmosphere, we just need soft reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);

  // Postprocessing — bloom, vignette, tone mapping. Replaces renderer.render.
  const postfx = createPostFx(renderer, scene, camera);

  // Lighting — cold dawn.
  const hemi = new THREE.HemisphereLight(0xc7c0b2, 0x352e22, 0.55);
  scene.add(hemi);
  // Sun light direction follows the sky shader's sun position. Warm dawn color.
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.6);
  sun.position.copy(sunPosition).multiplyScalar(150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);  // perf: 4096² was eating frametime
  sun.shadow.camera.left = -180; sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun);

  // Physics world.
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.2;

  // Terrain.
  const { heights, isTrack } = buildHeights();
  const heightBody = buildHeightfieldBody(heights);
  world.addBody(heightBody);
  const terrainMesh = buildTerrainMesh(heights, isTrack);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Asphalt road — real geometry on top of the terrain.
  scene.add(buildAsphaltRoad(heights));

  // Border + watchtower.
  scene.add(buildBorderLine());
  scene.add(buildBorderPosts());
  const tower = buildWatchtower();
  const towerX = 30;
  tower.position.set(towerX, sampleHeight(towerX, BORDER_Z + 4, heights), BORDER_Z + 4);
  scene.add(tower);

  // Hut on the south side, off the track.
  const hut = buildHut();
  const hutX = -28, hutZ = -10;
  hut.position.set(hutX, sampleHeight(hutX, hutZ, heights), hutZ);
  hut.rotation.y = 0.6;
  scene.add(hut);

  // Scatter detail. Rocks + scrub are instanced (cheap). Trees below are NOT
  // instanced (each is a Group of meshes), so we keep their counts modest.
  scene.add(buildRocks(heights, isTrack, 180));
  scene.add(buildScrub(heights, isTrack, 450));
  scene.add(buildDistantRidges());

  // Track helper for landmark placement.
  const trackXLocal = (z: number) => Math.sin(z / TERRAIN_SIZE * 2.4) * 12 + Math.sin(z / TERRAIN_SIZE * 5.7) * 3;

  // Limestone slabs — clusters at landmarks. Big silhouettes.
  // Approach to canyon (z=-30 area): two large slabs framing the run-in.
  for (const [z, side, scale, rot] of [
    [-32, -1, 1.2, 0.2],
    [-28, 1, 0.9, -0.4],
  ] as const) {
    const slab = buildLimestoneSlab(scale);
    const sx = trackXLocal(z) + side * (12 + Math.random() * 3);
    slab.position.set(sx, sampleHeight(sx, z, heights), z);
    slab.rotation.y = rot;
    scene.add(slab);
  }
  // Border-zone slab cluster — three monocline outcrops north of the line.
  for (const [z, x, scale, rot] of [
    [BORDER_Z + 18, -22, 1.5, 0.6],
    [BORDER_Z + 12, 22, 1.0, -0.3],
    [BORDER_Z + 26, 6, 0.85, 1.1],
  ] as const) {
    const slab = buildLimestoneSlab(scale);
    slab.position.set(x, sampleHeight(x, z, heights), z);
    slab.rotation.y = rot;
    scene.add(slab);
  }

  // Persian oak forest — Kurdistan's signature. Each oak is ~5 meshes (trunk +
  // 3-4 foliage blobs); 600 oaks = 3000 draw calls = real perf cost. Reduced
  // attempts to 600 (~300 placed) — still reads as forest, half the cost.
  for (let i = 0; i < 600; i++) {
    const ox = (Math.random() - 0.5) * (TERRAIN_SIZE - 30);
    const oz = (Math.random() - 0.5) * (TERRAIN_SIZE - 30);
    if (Math.abs(ox - trackXLocal(oz)) < 7) continue;
    const oy = sampleHeight(ox, oz, heights);
    if (oy < 0.5 || oy > 22) continue;
    const oak = buildPersianOak();
    oak.position.set(ox, oy, oz);
    oak.scale.setScalar(0.7 + Math.random() * 0.7);
    oak.rotation.y = Math.random() * Math.PI * 2;
    scene.add(oak);
  }
  // A pair of single oaks near the wreck — markers.
  for (const [ox, oz] of [[-46, -32], [-38, -36]] as const) {
    const oak = buildPersianOak();
    oak.position.set(ox, sampleHeight(ox, oz, heights), oz);
    oak.scale.setScalar(1.2);
    scene.add(oak);
  }

  // Junipers — dense on the high slopes (z > 50, altitude 4-26m).
  for (let i = 0; i < 180; i++) {
    const jx = (Math.random() - 0.5) * (TERRAIN_SIZE - 30);
    const jz = 50 + Math.random() * (TERRAIN_SIZE / 2 - 60);
    if (Math.abs(jx - trackXLocal(jz)) < 7) continue;
    const jy = sampleHeight(jx, jz, heights);
    if (jy < 4 || jy > 26) continue;
    const tree = buildJuniper();
    tree.position.set(jx, jy, jz);
    tree.scale.setScalar(0.7 + Math.random() * 0.6);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
  }

  // Wild bushes — much denser to fill the forest understory.
  for (let i = 0; i < 280; i++) {
    const bx = (Math.random() - 0.5) * (TERRAIN_SIZE - 20);
    const bz = (Math.random() - 0.5) * (TERRAIN_SIZE - 20);
    if (Math.abs(bx - trackXLocal(bz)) < 5) continue;
    const by = sampleHeight(bx, bz, heights);
    if (by > 18) continue;
    const bush = buildBush();
    bush.position.set(bx, by, bz);
    bush.scale.setScalar(0.6 + Math.random() * 0.7);
    bush.rotation.y = Math.random() * Math.PI * 2;
    scene.add(bush);
  }

  // Dry-stone wall ruin — running along the south slope below the oak grove.
  const wall = buildStoneWall(18);
  wall.position.set(-30, sampleHeight(-30, -55, heights), -55);
  wall.rotation.y = -0.3;
  scene.add(wall);
  // Shorter terrace wall higher up the slope.
  const wall2 = buildStoneWall(10);
  wall2.position.set(-44, sampleHeight(-44, -78, heights), -78);
  wall2.rotation.y = -0.5;
  scene.add(wall2);

  // Stream crossing. The track at z = -70 has a small dip; place a stream there.
  const streamZ = -70;
  const stream = buildStream(18, 0.2);
  const streamX = trackXLocal(streamZ);
  stream.position.set(streamX, sampleHeight(streamX, streamZ, heights) - 0.05, streamZ);
  stream.rotation.y = Math.PI / 2; // align E-W across track
  scene.add(stream);

  // Distant village on a ridge to the east.
  const village = buildVillage();
  village.position.set(120, sampleHeight(120, -40, heights) + 4, -40);
  village.rotation.y = -0.4;
  scene.add(village);

  // Dynamic props: goats that ragdoll when hit, barrels that knock over.
  const props: Prop[] = [];

  // Goats grazing on a south-facing slope, off-road.
  for (let i = 0; i < 6; i++) {
    const gx = -55 + Math.random() * 18;
    const gz = -25 + Math.random() * 12;
    const gy = sampleHeight(gx, gz, heights);
    props.push(spawnGoat(world, scene, new THREE.Vector3(gx, gy, gz)));
  }
  // A few extra goats clustered near the dirt track at different points.
  for (const [bx, bz] of [[8, -65], [-12, -40], [16, 18]] as const) {
    const gy = sampleHeight(bx, bz, heights);
    props.push(spawnGoat(world, scene, new THREE.Vector3(bx, gy, bz)));
  }

  // Oil barrels: clusters at the wreck and one near the canyon entrance.
  // Knock them over and they roll.
  const barrelSpots: [number, number][] = [
    [-44, -28], [-46, -30], [-43, -31], // wreck cluster
    [-2, -22], [3, -24],                 // canyon entrance
    [-24, -13],  // near hut (hut is at -28, -10)
  ];
  for (const [bx, bz] of barrelSpots) {
    const by = sampleHeight(bx, bz, heights);
    props.push(spawnBarrel(world, scene, new THREE.Vector3(bx, by, bz)));
  }

  // Birds — bigger flock for sky presence. Lower cruise altitude so they
  // appear above the truck more often, not way overhead.
  const birds = new BirdFlock(scene, TERRAIN_SIZE / 2 + 20, 36);

  // Atmospheric dust haze — drifting low-alpha particles for the dawn corridor feel.
  const dust2 = new DustHaze(scene, TERRAIN_SIZE * 0.9, 80);

  // Goat brains — wander + flee from truck. Map all goat props to brains.
  const goatBrains: GoatBrain[] = props
    .filter(p => p.kind === "goat")
    .map(p => createGoatBrain(p));

  // Stream-splash detection: track when a wheel transitions from above-water
  // to below-water at the stream crossing (z = -70, water y just under terrain).
  let inStream = false;

  // Power line: three pylons marching off the south side, with sagging wires.
  const pylonPositions = [
    new THREE.Vector3(-90, 0, -60),
    new THREE.Vector3(-60, 0, -40),
    new THREE.Vector3(-30, 0, -20),
  ];
  for (const p of pylonPositions) {
    const pylon = buildPylon();
    p.y = sampleHeight(p.x, p.z, heights);
    pylon.position.copy(p);
    pylon.rotation.y = Math.atan2(p.x - pylonPositions[0].x, p.z - pylonPositions[0].z);
    scene.add(pylon);
  }
  // Wires between consecutive pylons, attaching at the crossbar.
  for (let i = 0; i < pylonPositions.length - 1; i++) {
    const a = pylonPositions[i].clone(); a.y += 7;
    const b = pylonPositions[i + 1].clone(); b.y += 7;
    scene.add(buildPowerLines(a, b));
  }

  // Cairns along the track — quiet markers that someone has passed before.
  // Track centerline shorthand reused here (sine curve in x as a function of z).
  const trackXAt = (z: number) => {
    const zNorm = z / TERRAIN_SIZE;
    return Math.sin(zNorm * 2.4) * 12 + Math.sin(zNorm * 5.7) * 3;
  };
  for (const z of [-90, -50, -10, 25, 70]) {
    const cairn = buildCairn();
    const sideOffset = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 2);
    const cx = trackXAt(z) + sideOffset;
    cairn.position.set(cx, sampleHeight(cx, z, heights), z);
    cairn.rotation.y = Math.random() * Math.PI;
    scene.add(cairn);
  }

  // Wrecked truck off the road — a previous run that didn't make it. South side.
  const wreck = buildWreck();
  const wreckZ = -30;
  const wreckX = trackXAt(wreckZ) - 14;
  wreck.position.set(wreckX, sampleHeight(wreckX, wreckZ, heights), wreckZ);
  wreck.rotation.y = -0.7;
  scene.add(wreck);

  // Cypresses near the hut — clustered, the way they actually grow.
  const hutCenter = { x: -28, z: -10 };
  for (let i = 0; i < 7; i++) {
    const tree = buildCypress();
    const r = 4 + Math.random() * 5;
    const a = Math.random() * Math.PI * 2;
    const tx = hutCenter.x + Math.cos(a) * r;
    const tz = hutCenter.z + Math.sin(a) * r;
    tree.position.set(tx, sampleHeight(tx, tz, heights), tz);
    tree.scale.setScalar(0.8 + Math.random() * 0.5);
    scene.add(tree);
  }
  // Two more cypresses near the wreck — they grow where there's water.
  for (let i = 0; i < 2; i++) {
    const tree = buildCypress();
    const tx = wreckX + (Math.random() - 0.5) * 4;
    const tz = wreckZ - 6 + Math.random() * 3;
    tree.position.set(tx, sampleHeight(tx, tz, heights), tz);
    tree.scale.setScalar(0.7 + Math.random() * 0.4);
    scene.add(tree);
  }

  // Memorial flag poles near the border — Kurdish/Iranian custom for marking
  // places where things happened. Three different cloth colors. Quiet detail.
  const flagSpots: [number, number, number][] = [
    [trackXAt(BORDER_Z - 6) + 6, BORDER_Z - 6, 0xc0392b], // red
    [trackXAt(BORDER_Z - 12) - 7, BORDER_Z - 12, 0xe6e3d4], // bone-white
    [trackXAt(BORDER_Z - 3) - 5, BORDER_Z - 3, 0x356a4d], // green
  ];
  for (const [fx, fz, color] of flagSpots) {
    const pole = buildFlagPole(color);
    pole.position.set(fx, sampleHeight(fx, fz, heights), fz);
    pole.rotation.y = Math.random() * Math.PI;
    scene.add(pole);
  }

  // Audio. Init now (Drive click already provided the user gesture for AudioContext).
  const audio = new AudioSystem(kind);
  audio.resume();

  // Radio shares the same audio context. Stations: any real audio files
  // dropped in public/radio/ come first, procedural fallbacks behind.
  let radio = new Radio(audio.ctx, audio.master, DEFAULT_STATIONS);
  loadStations().then(stations => {
    // Replace radio with the loaded stations once available.
    radio = new Radio(audio.ctx, audio.master, stations);
  });

  // Vehicle.
  const spec = SPECS[kind];
  // Spawn at the south end of the track, aligned with the track centerline.
  // Drop from above so the truck lands cleanly on the road, not wedged in
  // a heightfield edge.
  const spawnZ = -135;
  const spawnX = Math.sin((spawnZ / TERRAIN_SIZE) * 2.4) * 12 + Math.sin((spawnZ / TERRAIN_SIZE) * 5.7) * 3;
  const spawnY = sampleHeight(spawnX, spawnZ, heights) + 1.2; // just above the terrain — wheels catch instantly
  const vehicle = buildVehicle(spec, world, new CANNON.Vec3(spawnX, spawnY, spawnZ));
  scene.add(vehicle.chassisMesh);
  for (const w of vehicle.wheelMeshes) scene.add(w);

  // Particle systems: dust under wheels (sandy), exhaust from tailpipe (dark grey).
  const dust = new ParticleSystem(80, 0xb09a82, 1.0);
  const exhaust = new ParticleSystem(40, 0x444444, -0.4); // negative gravity = rises
  scene.add(dust.mesh);
  scene.add(exhaust.mesh);

  // Cargo loop — independent rigid bodies on the truck's platform.
  const cargo: CargoItem[] = spawnCargo(vehicle, world, scene);

  // Contact material: sharper grip on heightfield.
  const wheelGroundContact = new CANNON.ContactMaterial(
    new CANNON.Material(),
    new CANNON.Material({ friction: 0.7 }),
    { friction: 0, restitution: 0, contactEquationStiffness: 1000 }
  );
  world.addContactMaterial(wheelGroundContact);

  // Input.
  const keys: Keys = { fwd: false, back: false, left: false, right: false, brake: false, handbrake: false, boost: false };
  const isTextInput = (el: Element | null) =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable);

  const setKey = (down: boolean) => (e: KeyboardEvent) => {
    // Don't steal keys from text inputs (feedback modal etc).
    if (isTextInput(document.activeElement)) return;
    // Escape is always handled (so user can close modals / pause even from anywhere).
    if (e.code === "Escape" && down) { handleEscape(); e.preventDefault(); return; }
    // When the game is paused, ignore game-control keys entirely.
    if (paused) return;

    let handled = true;
    switch (e.code) {
      case "KeyW": case "ArrowUp": keys.fwd = down; break;
      case "KeyS": case "ArrowDown": keys.back = down; break;
      case "KeyA": case "ArrowLeft": keys.left = down; break;
      case "KeyD": case "ArrowRight": keys.right = down; break;
      case "Space": keys.brake = down; break;
      case "ShiftLeft": case "ShiftRight": keys.handbrake = down; break;
      case "KeyF": keys.boost = down; break;
      case "KeyR": if (down) resetVehicle(); break;
      case "KeyM": if (down) {
        const muted = audio.toggleMute();
        radio.setMuted(muted); // live streams live outside Web Audio — sync separately
        flash(muted ? "muted" : "sound on");
      } break;
      case "KeyB": if (down) radio.toggle(); break;
      case "KeyN": if (down) radio.next(); break;
      case "BracketLeft": if (down) radio.bumpVolume(-0.1); break;
      case "BracketRight": if (down) radio.bumpVolume(0.1); break;
      case "KeyH": if (down) honk(audio.ctx, audio.master); break;
      case "KeyP": if (down) { setPhotoMode(!photoMode); flash(photoMode ? "photo mode" : "drive mode"); } break;
      case "Comma":  if (down) { dayTime = (dayTime - 0.05 + 1) % 1; flash(`time ${(dayTime * 24).toFixed(1)}h`); } break;
      case "Period": if (down) { dayTime = (dayTime + 0.05) % 1; flash(`time ${(dayTime * 24).toFixed(1)}h`); } break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", setKey(true));
  window.addEventListener("keyup", setKey(false));

  // — Pause system. Pause menu mirrors the starter screen visually with
  // context-appropriate verbs. Escape opens/closes; clicking Resume closes.
  let paused = false;
  const pauseMenu = document.getElementById("pause-menu");
  const pmStats = document.getElementById("pm-stats");

  function setPaused(v: boolean) {
    paused = v;
    keys.fwd = keys.back = keys.left = keys.right = keys.brake = keys.handbrake = false;
    // Audio mute is left alone — tick feeds zero throttle/speed when paused.
  }

  async function showPauseMenu() {
    setPaused(true);
    pauseMenu?.classList.add("show");
    if (pmStats) {
      const s = await fetchStats();
      if (s) pmStats.textContent = formatStats(s);
    }
  }
  function hidePauseMenu() {
    pauseMenu?.classList.remove("show");
    setPaused(false);
  }

  // Pause-menu button wiring.
  document.getElementById("pm-resume")?.addEventListener("click", hidePauseMenu);
  document.getElementById("pm-reset")?.addEventListener("click", () => {
    resetVehicle();
    hidePauseMenu();
  });
  document.getElementById("pm-switch")?.addEventListener("click", () => {
    // Reload to the title screen so the user can pick a different truck.
    // Cleanest re-init path; avoids tearing down + rebuilding the scene by hand.
    window.location.reload();
  });
  document.getElementById("pm-feedback")?.addEventListener("click", () => {
    // Open the feedback modal. Game stays paused (modal also pauses on its own).
    pauseMenu?.classList.remove("show");
    document.querySelector<HTMLElement>("[data-fb-open]")?.click();
  });

  // Custom events let other modules trigger pause without a tight import.
  window.addEventListener("game:pause", () => setPaused(true));
  window.addEventListener("game:resume", () => {
    // If the pause menu is also showing, leave it; otherwise unpause.
    if (!pauseMenu?.classList.contains("show")) setPaused(false);
  });
  // When feedback closes, return to pause menu (which is what we came from).
  window.addEventListener("feedback:close", () => {
    if (paused) pauseMenu?.classList.add("show");
  });

  function handleEscape() {
    const fbModal = document.getElementById("fb-modal");
    if (fbModal?.classList.contains("show")) {
      window.dispatchEvent(new CustomEvent("feedback:close"));
      return;
    }
    if (pauseMenu?.classList.contains("show")) {
      hidePauseMenu();
    } else {
      showPauseMenu();
    }
  }

  function resetVehicle() {
    vehicle.chassisBody.position.set(spawnX, spawnY, spawnZ);
    vehicle.chassisBody.velocity.set(0, 0, 0);
    vehicle.chassisBody.angularVelocity.set(0, 0, 0);
    vehicle.chassisBody.quaternion.set(0, 0, 0, 1);
    resetCargo(cargo, vehicle);
  }

  // Camera follow state. Slightly higher + further so crests don't blind you.
  const camOffsetLocal = new THREE.Vector3(0, 5.6, -10);
  let camShakeT = 0; // shake decay timer
  let lastVy = 0;    // for landing detection

  // Boost state — F gives 2.5s of +70% engine force, recharges over 8s.
  let boostCharge = 1.0; // 0..1
  let boostActive = false;
  const camTarget = new THREE.Vector3();
  let steering = 0; // smoothed steering value

  // HUD.
  const hudSpeed = document.getElementById("hud-speed")!;
  const hudHeading = document.getElementById("hud-heading")!;
  const hudLoad = document.getElementById("hud-load")!;
  const hudVehicle = document.getElementById("hud-vehicle");
  if (hudVehicle) hudVehicle.textContent = `${spec.name} — ${spec.year}`;
  hudLoad.textContent = `${spec.cargoSlots.length}/${spec.cargoSlots.length}`;
  const eventEl = document.getElementById("event")!;
  let crossed = false;
  let eventTimeout: number | undefined;
  function flash(text: string) {
    eventEl.textContent = text;
    eventEl.classList.add("show");
    clearTimeout(eventTimeout);
    eventTimeout = window.setTimeout(() => eventEl.classList.remove("show"), 2400);
  }

  // Resize.
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    postfx.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // GSAP intro: FOV 90 → 60 over the first 1.4s for a "settling in" feel.
  camera.fov = 90;
  camera.updateProjectionMatrix();
  let introDone = false;
  gsap.to(camera, {
    fov: 60, duration: 1.4, ease: "power2.out",
    onUpdate: () => camera.updateProjectionMatrix(),
    onComplete: () => { introDone = true; },
  });

  // — Photo mode (P key). Pauses world, hides HUD, free orbit camera.
  // Click + drag to rotate around the truck; scroll to zoom.
  let photoMode = false;
  const photoOrbit = { theta: 0, phi: Math.PI / 3, radius: 14, target: new THREE.Vector3() };
  let dragging = false;
  let lastMouse = { x: 0, y: 0 };
  function setPhotoMode(on: boolean) {
    photoMode = on;
    document.body.classList.toggle("photo-mode", on);
    if (on) {
      // Initialize orbit target on the truck position.
      photoOrbit.target.copy(vehicle.chassisMesh.position);
    }
  }
  window.addEventListener("mousedown", (e) => { if (photoMode) { dragging = true; lastMouse = { x: e.clientX, y: e.clientY }; } });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (!photoMode || !dragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    photoOrbit.theta -= dx * 0.005;
    // Clamp phi to horizon-only — never go below terrain.
    // 0.18 ≈ 10° from straight up; π/2 - 0.05 ≈ slightly above horizon.
    photoOrbit.phi = Math.max(0.18, Math.min(Math.PI / 2 - 0.05, photoOrbit.phi - dy * 0.005));
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("wheel", (e) => {
    if (!photoMode) return;
    photoOrbit.radius = Math.max(4, Math.min(60, photoOrbit.radius + e.deltaY * 0.02));
  }, { passive: true });

  // Loop.
  const clock = new THREE.Clock();
  const fixedStep = 1 / 60;

  // Base wheel grip — captured from spec at build time so we can scale per-zone.
  const baseFrictionSlip = 2.2;

  function applyDriveInput(dt: number, v: Vehicle) {
    // Per-zone traction: sample what's under the truck and scale forces.
    const zone = classifyZone(v.chassisBody.position.x, v.chassisBody.position.z, heights, isTrack);
    const trac = ZONE_TRACTION[zone];

    const targetSteer = (
      keys.left ? v.spec.maxSteer :
      keys.right ? -v.spec.maxSteer : 0
    ) * trac.steer;
    steering += (targetSteer - steering) * Math.min(1, dt * 6);

    v.raycast.setSteeringValue(steering, 0);
    v.raycast.setSteeringValue(steering, 1);

    // Update per-wheel friction so snow drifts and sand doesn't (much).
    for (let i = 0; i < v.raycast.wheelInfos.length; i++) {
      v.raycast.wheelInfos[i].frictionSlip = baseFrictionSlip * trac.friction;
    }
    // Extra linear damping in sand/scrub.
    v.chassisBody.linearDamping = 0.2 + trac.drag;

    // Engine: rear-wheel drive, scaled by zone traction. Boost stacks on top.
    const boostMul = boostActive && boostCharge > 0 ? 1.7 : 1.0;
    const drive = keys.fwd
      ? -v.spec.engineForce * boostMul * trac.engine
      : keys.back
        ? v.spec.engineForce * 0.6 * trac.engine
        : 0;
    v.raycast.applyEngineForce(drive, 2);
    v.raycast.applyEngineForce(drive, 3);
    v.raycast.applyEngineForce(0, 0);
    v.raycast.applyEngineForce(0, 1);

    const brakeAll = keys.brake ? v.spec.brakeForce * trac.brake : 0;
    const handbrakeRear = keys.handbrake ? v.spec.brakeForce * 1.6 * trac.brake : 0;
    v.raycast.setBrake(brakeAll, 0);
    v.raycast.setBrake(brakeAll, 1);
    v.raycast.setBrake(brakeAll + handbrakeRear, 2);
    v.raycast.setBrake(brakeAll + handbrakeRear, 3);

    // Surface readout for HUD (not a flash — a persistent line).
    if ((applyDriveInput as any)._lastZone !== zone) {
      (applyDriveInput as any)._lastZone = zone;
      const surfaceEl = document.getElementById("hud-surface");
      if (surfaceEl) surfaceEl.textContent = zone;
    }
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);

    if (paused) {
      // Frozen world: don't step physics, don't apply drive forces, keep
      // meshes in their current positions, feed zero to audio so the engine
      // settles and wind/tire fade out.
      audio.update(dt, 0, 0, true);
      // Still render so the scene stays visible behind the modal/overlay.
      dev.begin();
      postfx.render(dt);
      dev.end();
      requestAnimationFrame(tick);
      return;
    }

    applyDriveInput(dt, vehicle);
    world.step(fixedStep, dt, 3);
    syncVehicleMeshes(vehicle);

    // Brake lights — emissive intensity follows brake input.
    const braking = keys.brake || keys.handbrake || (keys.back && Math.hypot(vehicle.chassisBody.velocity.x, vehicle.chassisBody.velocity.z) > 0.5);
    for (const bl of vehicle.brakeLights) {
      const m = bl.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity += ((braking ? 1.4 : 0.0) - m.emissiveIntensity) * Math.min(1, dt * 12);
    }

    // Steering wheel rotates ~3x the front-wheel angle.
    vehicle.steeringWheel.rotation.y = steering * 3;

    // Audio update — derive throttle (signed), speed, and on-track from current state.
    const throttle = keys.fwd ? 1 : keys.back ? -1 : 0;
    const planarSpeed = Math.hypot(vehicle.chassisBody.velocity.x, vehicle.chassisBody.velocity.z);
    const elementSize = TERRAIN_SIZE / (TERRAIN_RES - 1);
    const ti = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor((vehicle.chassisBody.position.x + TERRAIN_SIZE / 2) / elementSize)));
    const tj = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor((TERRAIN_SIZE / 2 - vehicle.chassisBody.position.z) / elementSize)));
    const onTrack = isTrack[ti][tj];
    audio.update(dt, throttle, planarSpeed, onTrack);

    // Landing detection — sharp downward velocity → upward = camera shake kick.
    const vy = vehicle.chassisBody.velocity.y;
    if (vy - lastVy > 6 && planarSpeed > 4) camShakeT = 0.45;
    lastVy = vy;
    if (camShakeT > 0) camShakeT = Math.max(0, camShakeT - dt);

    // Particle spawns.
    // Dust: under each wheel, gated by speed.
    if (planarSpeed > 2) {
      const dustChance = Math.min(1, (planarSpeed - 2) / 8);
      for (let wi = 0; wi < vehicle.raycast.wheelInfos.length; wi++) {
        if (Math.random() > dustChance * 0.6) continue;
        const wt = vehicle.raycast.wheelInfos[wi].worldTransform;
        // Only spawn when wheel is close to the ground (suspension compressed).
        const wheelMesh = vehicle.wheelMeshes[wi];
        const groundH = sampleHeight(wt.position.x, wt.position.z, heights);
        if (wheelMesh.position.y - groundH > 0.5) continue;
        dust.spawn(
          wt.position.x + (Math.random() - 0.5) * 0.4,
          groundH + 0.1,
          wt.position.z + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 1.5,
          0.6 + Math.random() * 0.4,
          (Math.random() - 0.5) * 1.5,
          onTrack ? 0.55 : 0.85,
          0.5 + Math.random() * 0.6,
        );
      }
    }
    // Exhaust: from tailpipe when accelerating.
    if (keys.fwd) {
      const ex = vehicle.chassisMesh.localToWorld(vehicle.exhaustLocal.clone());
      exhaust.spawn(
        ex.x + (Math.random() - 0.5) * 0.15,
        ex.y,
        ex.z,
        (Math.random() - 0.5) * 0.4,
        0.3 + Math.random() * 0.4,
        -0.6 - Math.random() * 0.6,
        1.2 + Math.random() * 0.4,
        0.3 + Math.random() * 0.3,
      );
    }
    dust.update(dt, camera);
    exhaust.update(dt, camera);

    // Dynamic props (goats + barrels) — physics-driven scenery.
    syncProps(props);
    // Goat AI — wander + flee from truck.
    updateGoatBrains(
      goatBrains,
      new THREE.Vector3(vehicle.chassisBody.position.x, 0, vehicle.chassisBody.position.z),
      dt,
      (x, z) => sampleHeight(x, z, heights),
    );
    // Hit detection: any prop with high relative velocity to the truck just got punted.
    for (const p of props) {
      const dx = p.body.position.x - vehicle.chassisBody.position.x;
      const dy = p.body.position.y - vehicle.chassisBody.position.y;
      const dz = p.body.position.z - vehicle.chassisBody.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 4) {
        const relV = Math.hypot(
          p.body.velocity.x - vehicle.chassisBody.velocity.x,
          p.body.velocity.y - vehicle.chassisBody.velocity.y,
          p.body.velocity.z - vehicle.chassisBody.velocity.z,
        );
        if (relV > 6 && !(p as any)._hitFlashed) {
          (p as any)._hitFlashed = true;
          if (p.kind === "goat") flash(Math.random() < 0.5 ? "goat went airborne" : "sorry, goat");
          else                   flash(Math.random() < 0.5 ? "barrel down" : "scattered the barrels");
          setTimeout(() => { (p as any)._hitFlashed = false; }, 1500);
        }
      }
    }
    // Birds — pass truck position so they flee.
    birds.update(dt, new THREE.Vector3(vehicle.chassisBody.position.x, vehicle.chassisBody.position.y, vehicle.chassisBody.position.z));
    // Atmospheric dust drifts.
    dust2.update(dt, camera);

    // Water-splash detection: when truck Z passes through the stream band,
    // spawn a burst of bluish particles (reusing the dust system, recolored).
    const truckZ = vehicle.chassisBody.position.z;
    const wasInStream = inStream;
    inStream = truckZ > -73 && truckZ < -67 && Math.abs(vehicle.chassisBody.position.x) < 9;
    if (inStream && !wasInStream && planarSpeed > 3) {
      // Splash burst — 14 particles, faster + lighter than dust.
      for (let i = 0; i < 14; i++) {
        dust.spawn(
          vehicle.chassisBody.position.x + (Math.random() - 0.5) * 2.5,
          sampleHeight(vehicle.chassisBody.position.x, truckZ, heights) + 0.2,
          truckZ + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 4,
          1.6 + Math.random() * 1.8,
          (Math.random() - 0.5) * 4,
          0.55,
          0.6 + Math.random() * 0.5,
        );
      }
      flash("splash");
    }

    // Cargo physics — sync, detect lost, update HUD.
    const cargoStatus = updateCargo(cargo, vehicle);
    hudLoad.textContent = `${cargoStatus.secured}/${cargoStatus.total}`;
    if (cargoStatus.justLost) {
      flash(cargoStatus.justLost.kind === "tarp" ? "load shifted" : "lost a can");
    }

    // Day/night cycle — slow real-time advance (full cycle in ~12 minutes).
    // Skip in photo mode so the user can frame a moment.
    if (!photoMode) dayTime = (dayTime + dt / (12 * 60)) % 1;
    updateSun();
    // Sync directional light direction + intensity + color to sun position.
    sun.position.copy(sunPosition).multiplyScalar(150);
    const sunY = sunPosition.y; // -1..+1 sky vector
    const dayness = Math.max(0, sunY);
    sun.intensity = dayness * 1.6 + 0.05;
    // Warm sunrise / sunset, cool blue night.
    const warm = new THREE.Color(0xffd9a8);
    const noon = new THREE.Color(0xfff0d8);
    const night = new THREE.Color(0x4a5266);
    if (dayness > 0.4) sun.color.copy(noon);
    else if (sunY > 0)  sun.color.copy(warm);
    else                sun.color.copy(night);
    hemi.intensity = 0.25 + dayness * 0.5;

    // Camera: drive-mode chase cam OR photo-mode orbit.
    if (photoMode) {
      // Smoothly follow the truck position as orbit target.
      photoOrbit.target.lerp(vehicle.chassisMesh.position, Math.min(1, dt * 4));
      const x = photoOrbit.target.x + Math.sin(photoOrbit.theta) * Math.sin(photoOrbit.phi) * photoOrbit.radius;
      const y = photoOrbit.target.y + Math.cos(photoOrbit.phi) * photoOrbit.radius;
      const z = photoOrbit.target.z + Math.cos(photoOrbit.theta) * Math.sin(photoOrbit.phi) * photoOrbit.radius;
      camera.position.set(x, y, z);
      camera.lookAt(photoOrbit.target);
      // Skip the rest of the standard camera path.
      // Render and return.
      postfx.render(dt);
      requestAnimationFrame(tick);
      return;
    }

    // Camera follow.
    const desired = vehicle.chassisMesh.localToWorld(camOffsetLocal.clone());
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camTarget.copy(vehicle.chassisMesh.position).add(new THREE.Vector3(0, 1.5, 0));

    // Speed-based FOV: pulls back as you gain speed for the rush.
    // Suppressed until the intro tween finishes so they don't fight.
    if (introDone) {
      const speedNorm = Math.min(1, planarSpeed / 22);
      const targetFov = 60 + speedNorm * 12;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }

    // Landing shake — quick, dampened.
    if (camShakeT > 0) {
      const amp = camShakeT * 0.25;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
    }
    camera.lookAt(camTarget);

    // HUD.
    const v = vehicle.chassisBody.velocity;
    const speedKmh = Math.round(Math.hypot(v.x, v.z) * 3.6);
    hudSpeed.textContent = String(speedKmh);

    // Heading: world forward derived from chassis quaternion (local +z).
    const fw = new CANNON.Vec3(0, 0, 1);
    const fwWorld = new CANNON.Vec3();
    vehicle.chassisBody.quaternion.vmult(fw, fwWorld);
    const headingDeg = Math.round((Math.atan2(fwWorld.x, fwWorld.z) * 180) / Math.PI);
    hudHeading.textContent = `${headingDeg}°`;

    // Boost charge management.
    boostActive = keys.boost && keys.fwd && boostCharge > 0;
    if (boostActive) boostCharge = Math.max(0, boostCharge - dt / 2.5);   // 2.5s of full boost
    else             boostCharge = Math.min(1, boostCharge + dt / 8);     // 8s full recharge
    const boostBar = document.getElementById("hud-boost-bar");
    if (boostBar) boostBar.style.width = `${Math.round(boostCharge * 100)}%`;
    const boostLabel = document.getElementById("hud-boost-label");
    if (boostLabel) boostLabel.textContent = boostActive ? "boosting" : (boostCharge >= 1 ? "boost ready" : "boost charging");

    // Drift detection: lateral velocity vs forward velocity ratio.
    const fwLocal = new CANNON.Vec3(0, 0, 1);
    const fwWorldVec = new CANNON.Vec3();
    vehicle.chassisBody.quaternion.vmult(fwLocal, fwWorldVec);
    const vWorld = vehicle.chassisBody.velocity;
    const forwardComp = vWorld.x * fwWorldVec.x + vWorld.z * fwWorldVec.z;
    const lateralComp = Math.hypot(vWorld.x - fwWorldVec.x * forwardComp, vWorld.z - fwWorldVec.z * forwardComp);
    const drifting = planarSpeed > 6 && lateralComp / planarSpeed > 0.45;
    document.getElementById("hud-drift")?.classList.toggle("show", drifting);

    // Border crossing.
    if (!crossed && vehicle.chassisBody.position.z >= BORDER_Z) {
      crossed = true;
      flash("crossed");
    } else if (crossed && vehicle.chassisBody.position.z < BORDER_Z - 3) {
      crossed = false;
    }

    // Bounds: if you somehow exit the map, reset.
    if (Math.abs(vehicle.chassisBody.position.x) > TERRAIN_SIZE / 2 + 5 ||
        Math.abs(vehicle.chassisBody.position.z) > TERRAIN_SIZE / 2 + 5 ||
        vehicle.chassisBody.position.y < -10) {
      resetVehicle();
      flash("returned to start");
    }

    // Apply live tunables (dev panel — silent if dev panel hidden).
    if (scene.fog && (scene.fog as THREE.Fog).near !== undefined) {
      (scene.fog as THREE.Fog).near = dev.tunables.fogNear;
      (scene.fog as THREE.Fog).far = dev.tunables.fogFar;
    }
    sun.intensity = dev.tunables.sunIntensity;
    hemi.intensity = dev.tunables.hemiIntensity;
    camOffsetLocal.y = dev.tunables.cameraHeight;
    camOffsetLocal.z = -dev.tunables.cameraDistance;
    postfx.bloom.intensity = dev.tunables.bloomIntensity;
    (postfx.vignette as any).darkness = dev.tunables.vignetteDarkness;

    dev.begin();
    postfx.render(dt);
    dev.end();
    requestAnimationFrame(tick);
  }
  tick();
}

// Generate a tiny synthesized "door close" WAV as a data URI for Howler to play.
// 0.18s, descending tone + noise tail. Lightweight, no external asset.
function makeDoorClickDataURI(): string {
  const sampleRate = 22050;
  const samples = Math.floor(sampleRate * 0.18);
  const data = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 24);
    const tone = Math.sin(2 * Math.PI * (180 - t * 600) * t) * 0.4;
    const noise = (Math.random() * 2 - 1) * 0.15 * Math.exp(-t * 18);
    data[i] = Math.round((tone + noise) * env * 32000);
  }
  // Build a 16-bit mono PCM WAV.
  const buffer = new ArrayBuffer(44 + data.byteLength);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, data.byteLength, true);
  new Int16Array(buffer, 44).set(data);
  // Base64 encode.
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}
