// Border Run — vertical slice.
// Three.js + cannon-es. Heightfield terrain with a baked dirt track,
// RaycastVehicle physics, two pickable Land Cruiser variants.

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoomEnvironment } from "three-stdlib";
import {
  TERRAIN_SIZE, TERRAIN_RES, BORDER_Z,
  buildHeights, buildHeightfieldBody, buildTerrainMesh, sampleHeight,
  buildSkyGradient, buildSunDisk, buildWatchtower, buildHut, buildDistantRidges,
  buildRocks, buildScrub, buildBorderPosts, buildBorderLine,
  buildCairn, buildWreck, buildCypress, buildFlagPole,
} from "./world";
import {
  buildLimestoneSlab, buildPersianOak, buildStoneWall, buildStream,
  buildVillage, buildGoat, buildPylon, buildPowerLines,
} from "./scenery";
import { SPECS, VehicleKind, buildVehicle, syncVehicleMeshes, Vehicle } from "./vehicle";
import { AudioSystem } from "./audio";
import { Radio, DEFAULT_STATIONS } from "./radio";
import { ParticleSystem } from "./particles";
import { spawnCargo, updateCargo, resetCargo, CargoItem } from "./cargo";
import { setupFeedback } from "./feedback";
import { createDevtools } from "./devtools";
import { createPostFx } from "./postfx";
import gsap from "gsap";
import { Howl } from "howler";

type Keys = {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  brake: boolean; handbrake: boolean;
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
    doorClickHowl.play();
    // GSAP intro tween: fade title, then start the engine.
    gsap.to(title!, { opacity: 0, duration: 0.4, onComplete: () => title?.classList.add("hidden") });
    gsap.delayedCall(0.2, () => init(readChoice()));
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
  document.addEventListener("DOMContentLoaded", () => { hideLoader(); setupFeedback(); boot(); });
} else {
  hideLoader();
  setupFeedback();
  boot();
}

function hideLoader() {
  const loader = document.getElementById("loader");
  if (!loader) return;
  loader.classList.add("hide");
  setTimeout(() => loader.remove(), 600);
}

function init(kind: VehicleKind) {
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
  scene.background = buildSkyGradient();
  scene.fog = new THREE.Fog(0x9aa0a8, 100, 320);

  // IBL for soft fill on chrome/glass — three-stdlib's RoomEnvironment generates
  // an indoor-ish PMREM probe. Good enough for non-PBR-realism, helps polished
  // materials read better.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);

  // Postprocessing — bloom, vignette, tone mapping. Replaces renderer.render.
  const postfx = createPostFx(renderer, scene, camera);

  // Lighting — cold dawn.
  const hemi = new THREE.HemisphereLight(0xa9b4c4, 0x2a2620, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 0.8);
  sun.position.set(80, 50, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 250;
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

  // Scatter detail.
  scene.add(buildRocks(heights, isTrack, 75));
  scene.add(buildScrub(heights, isTrack, 260));
  scene.add(buildDistantRidges());

  // Sun disk low over the +z horizon, slightly east. Quietly catches dawn.
  const sunDisk = buildSunDisk();
  sunDisk.position.set(45, 22, 380);
  scene.add(sunDisk);

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

  // Persian oak grove on the south slope (z = -60, off the road).
  for (let i = 0; i < 14; i++) {
    const oak = buildPersianOak();
    const ox = -32 + Math.random() * 30;
    const oz = -85 + Math.random() * 30;
    oak.position.set(ox, sampleHeight(ox, oz, heights), oz);
    oak.scale.setScalar(0.85 + Math.random() * 0.5);
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

  // Goats grazing on a south-facing slope, off-road.
  for (let i = 0; i < 6; i++) {
    const goat = buildGoat();
    const gx = -55 + Math.random() * 18;
    const gz = -25 + Math.random() * 12;
    goat.position.set(gx, sampleHeight(gx, gz, heights), gz);
    goat.rotation.y = Math.random() * Math.PI * 2;
    scene.add(goat);
  }

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

  // Radio shares the same audio context.
  const radio = new Radio(audio.ctx, audio.master, DEFAULT_STATIONS);

  // Vehicle.
  const spec = SPECS[kind];
  // Spawn at the south end of the track, aligned with the track centerline.
  const spawnZ = -135;
  const spawnX = Math.sin((spawnZ / TERRAIN_SIZE) * 2.4) * 12 + Math.sin((spawnZ / TERRAIN_SIZE) * 5.7) * 3;
  const spawnY = sampleHeight(spawnX, spawnZ, heights) + 4;
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
  const keys: Keys = { fwd: false, back: false, left: false, right: false, brake: false, handbrake: false };
  const setKey = (down: boolean) => (e: KeyboardEvent) => {
    let handled = true;
    switch (e.code) {
      case "KeyW": case "ArrowUp": keys.fwd = down; break;
      case "KeyS": case "ArrowDown": keys.back = down; break;
      case "KeyA": case "ArrowLeft": keys.left = down; break;
      case "KeyD": case "ArrowRight": keys.right = down; break;
      case "Space": keys.brake = down; break;
      case "ShiftLeft": case "ShiftRight": keys.handbrake = down; break;
      case "KeyR": if (down) resetVehicle(); break;
      case "KeyM": if (down) {
        const muted = audio.toggleMute();
        flash(muted ? "muted" : "sound on");
      } break;
      case "KeyB": if (down) radio.toggle(); break;            // radio on/off
      case "KeyN": if (down) radio.next(); break;              // next station
      case "BracketLeft": if (down) radio.bumpVolume(-0.1); break;
      case "BracketRight": if (down) radio.bumpVolume(0.1); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", setKey(true));
  window.addEventListener("keyup", setKey(false));

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

  // Loop.
  const clock = new THREE.Clock();
  const fixedStep = 1 / 60;

  function applyDriveInput(dt: number, v: Vehicle) {
    const targetSteer =
      keys.left ? v.spec.maxSteer :
      keys.right ? -v.spec.maxSteer : 0;
    // Smooth steering — exponential approach.
    steering += (targetSteer - steering) * Math.min(1, dt * 6);

    // Front wheels = indices 0, 1 (per addWheel order).
    v.raycast.setSteeringValue(steering, 0);
    v.raycast.setSteeringValue(steering, 1);

    // Engine: rear-wheel drive.
    const drive = keys.fwd ? -v.spec.engineForce : keys.back ? v.spec.engineForce * 0.6 : 0;
    v.raycast.applyEngineForce(drive, 2);
    v.raycast.applyEngineForce(drive, 3);
    // No engine on front.
    v.raycast.applyEngineForce(0, 0);
    v.raycast.applyEngineForce(0, 1);

    // Brakes.
    const brakeAll = keys.brake ? v.spec.brakeForce : 0;
    const handbrakeRear = keys.handbrake ? v.spec.brakeForce * 1.6 : 0;
    v.raycast.setBrake(brakeAll, 0);
    v.raycast.setBrake(brakeAll, 1);
    v.raycast.setBrake(brakeAll + handbrakeRear, 2);
    v.raycast.setBrake(brakeAll + handbrakeRear, 3);
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);

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

    // Cargo physics — sync, detect lost, update HUD.
    const cargoStatus = updateCargo(cargo, vehicle);
    hudLoad.textContent = `${cargoStatus.secured}/${cargoStatus.total}`;
    if (cargoStatus.justLost) {
      flash(cargoStatus.justLost.kind === "tarp" ? "load shifted" : "lost a can");
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
