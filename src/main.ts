// Border Run — vertical slice.
// Three.js + cannon-es. Heightfield terrain with a baked dirt track,
// RaycastVehicle physics, two pickable Land Cruiser variants.

import * as THREE from "three";
import * as CANNON from "cannon-es";
import {
  TERRAIN_SIZE, TERRAIN_RES, BORDER_Z,
  buildHeights, buildHeightfieldBody, buildTerrainMesh, sampleHeight,
  buildSkyGradient, buildWatchtower, buildHut, buildDistantRidge,
  buildRocks, buildScrub, buildBorderPosts, buildBorderLine,
  buildCairn, buildWreck, buildCypress, buildFlagPole,
} from "./world";
import { SPECS, VehicleKind, buildVehicle, syncVehicleMeshes, Vehicle } from "./vehicle";
import { AudioSystem } from "./audio";

type Keys = {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  brake: boolean; handbrake: boolean;
};

function boot() {
  const start = document.getElementById("start") as HTMLButtonElement | null;
  const title = document.getElementById("title");

  const readChoice = (): VehicleKind => {
    const checked = document.querySelector<HTMLInputElement>('input[name="vehicle-choice"]:checked');
    return (checked?.value as VehicleKind) || "fj40";
  };

  start?.addEventListener("click", () => {
    title?.classList.add("hidden");
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
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

function init(kind: VehicleKind) {
  const stage = document.getElementById("stage")!;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0b0b0c);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = buildSkyGradient();
  scene.fog = new THREE.Fog(0x9aa0a8, 100, 320);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);

  // Lighting — cold dawn.
  scene.add(new THREE.HemisphereLight(0xa9b4c4, 0x2a2620, 0.7));
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
  scene.add(buildRocks(heights, isTrack, 90));
  scene.add(buildScrub(heights, isTrack, 220));
  scene.add(buildDistantRidge());

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

  // Vehicle.
  const spec = SPECS[kind];
  const spawnX = Math.sin((-0.42) * 2.4) * 12 + Math.sin((-0.42) * 5.7) * 3; // align spawn to track curve at z = -126
  const spawnY = sampleHeight(spawnX, -120, heights) + 4;
  const vehicle = buildVehicle(spec, world, new CANNON.Vec3(spawnX, spawnY, -120));
  scene.add(vehicle.chassisMesh);
  for (const w of vehicle.wheelMeshes) scene.add(w);

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
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", setKey(true));
  window.addEventListener("keyup", setKey(false));

  function resetVehicle() {
    vehicle.chassisBody.position.set(spawnX, spawnY, -120);
    vehicle.chassisBody.velocity.set(0, 0, 0);
    vehicle.chassisBody.angularVelocity.set(0, 0, 0);
    vehicle.chassisBody.quaternion.set(0, 0, 0, 1);
  }

  // Camera follow state. Slightly higher + further so crests don't blind you.
  const camOffsetLocal = new THREE.Vector3(0, 5.6, -10);
  const camTarget = new THREE.Vector3();
  let steering = 0; // smoothed steering value

  // HUD.
  const hudSpeed = document.getElementById("hud-speed")!;
  const hudHeading = document.getElementById("hud-heading")!;
  const hudLoad = document.getElementById("hud-load")!;
  const hudVehicle = document.getElementById("hud-vehicle");
  if (hudVehicle) hudVehicle.textContent = `${spec.name} — ${spec.year}`;
  hudLoad.textContent = "—";
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
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

    // Audio update — derive throttle (signed), speed, and on-track from current state.
    const throttle = keys.fwd ? 1 : keys.back ? -1 : 0;
    const planarSpeed = Math.hypot(vehicle.chassisBody.velocity.x, vehicle.chassisBody.velocity.z);
    const elementSize = TERRAIN_SIZE / (TERRAIN_RES - 1);
    const ti = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor((vehicle.chassisBody.position.x + TERRAIN_SIZE / 2) / elementSize)));
    const tj = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor((TERRAIN_SIZE / 2 - vehicle.chassisBody.position.z) / elementSize)));
    const onTrack = isTrack[ti][tj];
    audio.update(dt, throttle, planarSpeed, onTrack);

    // Camera follow.
    const desired = vehicle.chassisMesh.localToWorld(camOffsetLocal.clone());
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camTarget.copy(vehicle.chassisMesh.position).add(new THREE.Vector3(0, 1.5, 0));
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

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}
