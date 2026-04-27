// Border Run — vertical slice.
// Three.js + cannon-es. One terrain, one FJ40 Land Cruiser, one border line.
// Decisions: see DECISIONS.md at repo root.

import * as THREE from "three";
import * as CANNON from "cannon-es";

type Keys = { f: boolean; b: boolean; l: boolean; r: boolean; brake: boolean; reset: boolean };

const TERRAIN_SIZE = 200;
const TERRAIN_RES = 64;
const BORDER_Z = 30; // world line; cross from -z to +z = "across"

function boot() {
  const start = document.getElementById("start") as HTMLButtonElement | null;
  const title = document.getElementById("title");
  start?.addEventListener("click", () => {
    title?.classList.add("hidden");
    init();
  }, { once: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

function init() {
  const stage = document.getElementById("stage")!;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0b0b0c);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Dawn sky: cool dust-blue gradient, fades into fog at the horizon.
  scene.background = buildSkyGradient();
  scene.fog = new THREE.Fog(0x9aa0a8, 80, 260);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 12, -18);

  // — Lighting. Cold dawn before the sun has cleared the ridge.
  const hemi = new THREE.HemisphereLight(0xa9b4c4, 0x2a2620, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 0.75);
  sun.position.set(60, 35, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
  scene.add(sun);

  // — Physics world.
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  // — Terrain. Authored heightfield: ridge to the north, valley running E–W, soft noise.
  const heights = buildHeights(TERRAIN_RES, TERRAIN_RES);
  const elementSize = TERRAIN_SIZE / (TERRAIN_RES - 1);

  const heightShape = new CANNON.Heightfield(heights, { elementSize });
  const heightBody = new CANNON.Body({ mass: 0, material: new CANNON.Material({ friction: 0.6 }) });
  heightBody.addShape(heightShape);
  // Cannon Heightfield is built in +x +y, oriented with z up. Rotate so y is up in three.
  heightBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  heightBody.position.set(-TERRAIN_SIZE / 2, 0, TERRAIN_SIZE / 2);
  world.addBody(heightBody);

  const terrainMesh = buildTerrainMesh(heights, TERRAIN_SIZE, TERRAIN_RES);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // — Border line. Visual only; logic is z-coordinate based.
  const borderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-TERRAIN_SIZE / 2, 0.05, BORDER_Z),
    new THREE.Vector3(TERRAIN_SIZE / 2, 0.05, BORDER_Z),
  ]);
  const borderLine = new THREE.Line(borderGeo, new THREE.LineDashedMaterial({ color: 0xc0392b, dashSize: 1.2, gapSize: 0.6 }));
  borderLine.computeLineDistances();
  scene.add(borderLine);

  // Posts along the border, every 8m, to make the line read as territorial, not aesthetic.
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 0.9 });
  for (let x = -TERRAIN_SIZE / 2; x <= TERRAIN_SIZE / 2; x += 8) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(x, 0.8, BORDER_Z);
    p.castShadow = true;
    scene.add(p);
  }

  // — Vehicle: FJ40-silhouette Land Cruiser proxy.
  // Single dynamic Box body; visual is built from primitives. Not a real vehicle controller — see DECISIONS.md.
  // Body half-extents tuned to FJ40 footprint: ~3.84m long, ~1.66m wide, ~2.0m tall (with roof rack + cans).
  const truckMat = new CANNON.Material({ friction: 0.95 });
  const truckShape = new CANNON.Box(new CANNON.Vec3(0.95, 0.85, 1.95));
  const truckBody = new CANNON.Body({
    mass: 1500, // FJ40 ~1300kg curb + cargo
    material: truckMat,
    angularDamping: 0.7,
    linearDamping: 0.2,
  });
  truckBody.addShape(truckShape);
  // Roof rack as a thin compound shape on top — cargo rests here.
  const rackShape = new CANNON.Box(new CANNON.Vec3(0.85, 0.05, 1.05));
  truckBody.addShape(rackShape, new CANNON.Vec3(0, 1.33, -0.3));
  truckBody.position.set(0, 6, -10);
  world.addBody(truckBody);

  const truckMesh = buildFJ40();
  scene.add(truckMesh);

  // Wheels are visual-only in slice; rotate at speed for read.
  const wheels = truckMesh.userData.wheels as THREE.Mesh[];

  // — Cargo on roof rack. Each item is its own dynamic body; if you flip, they fall.
  const cargoMat = new CANNON.Material({ friction: 0.7, restitution: 0.0 });
  const cargoBodies: { body: CANNON.Body; mesh: THREE.Mesh; lost?: boolean }[] = [];

  // 3 olive jerry cans, lined up on the front of the rack.
  const canGeoCN = new CANNON.Box(new CANNON.Vec3(0.16, 0.21, 0.09));
  const canGeoTHREE = new THREE.BoxGeometry(0.32, 0.42, 0.18);
  const canMatTHREE = new THREE.MeshStandardMaterial({ color: 0x556b3d, roughness: 0.7, metalness: 0.2 });
  for (let i = 0; i < 3; i++) {
    const body = new CANNON.Body({ mass: 18, material: cargoMat });
    body.addShape(canGeoCN);
    body.position.set(-0.4 + i * 0.4, 6 + 1.7, -10 + 0.45);
    body.linearDamping = 0.05;
    body.angularDamping = 0.1;
    world.addBody(body);
    const mesh = new THREE.Mesh(canGeoTHREE, canMatTHREE);
    mesh.castShadow = true;
    scene.add(mesh);
    cargoBodies.push({ body, mesh });
  }

  // Tarp-wrapped cargo block on the rear of the rack.
  const tarpCN = new CANNON.Box(new CANNON.Vec3(0.75, 0.27, 0.5));
  const tarpTHREE = new THREE.BoxGeometry(1.5, 0.55, 1.0);
  const tarpMatTHREE = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 1.0 });
  {
    const body = new CANNON.Body({ mass: 90, material: cargoMat });
    body.addShape(tarpCN);
    body.position.set(0, 6 + 1.75, -10 - 0.9);
    body.linearDamping = 0.05;
    body.angularDamping = 0.15;
    world.addBody(body);
    const mesh = new THREE.Mesh(tarpTHREE, tarpMatTHREE);
    mesh.castShadow = true;
    scene.add(mesh);
    cargoBodies.push({ body, mesh });
  }

  // Truck-vs-cargo and cargo-vs-ground contact materials.
  world.addContactMaterial(new CANNON.ContactMaterial(truckMat, cargoMat, { friction: 0.8, restitution: 0.0 }));

  // — Watchtower silhouette north of the border, off-center. Gives the line presence.
  const tower = buildWatchtower();
  tower.position.set(28, sampleHeightAt(28, BORDER_Z + 4, heights, elementSize) + 0.0, BORDER_Z + 4);
  scene.add(tower);

  // — Distant ridge silhouette on the +z horizon so the world doesn't end at fog.
  const ridge = buildDistantRidge();
  ridge.position.set(0, 0, 240);
  scene.add(ridge);

  // — Input.
  const keys: Keys = { f: false, b: false, l: false, r: false, brake: false, reset: false };
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp": keys.f = down; break;
      case "KeyS": case "ArrowDown": keys.b = down; break;
      case "KeyA": case "ArrowLeft": keys.l = down; break;
      case "KeyD": case "ArrowRight": keys.r = down; break;
      case "Space": keys.brake = down; break;
      case "KeyR": if (down) resetTruck(); break;
    }
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  function resetTruck() {
    truckBody.position.set(0, 6, -10);
    truckBody.velocity.set(0, 0, 0);
    truckBody.angularVelocity.set(0, 0, 0);
    truckBody.quaternion.set(0, 0, 0, 1);
    // Re-stack cargo on the rack at canonical positions.
    const seedSpots: [number, number, number][] = [
      [-0.4, 6 + 1.7, -10 + 0.45],
      [ 0.0, 6 + 1.7, -10 + 0.45],
      [ 0.4, 6 + 1.7, -10 + 0.45],
      [ 0.0, 6 + 1.75, -10 - 0.9],
    ];
    cargoBodies.forEach((c, i) => {
      const [x, y, z] = seedSpots[i] ?? [0, 8, -10];
      c.body.position.set(x, y, z);
      c.body.velocity.set(0, 0, 0);
      c.body.angularVelocity.set(0, 0, 0);
      c.body.quaternion.set(0, 0, 0, 1);
      c.lost = false;
    });
    crossed = false;
  }

  // — HUD bindings.
  const hudSpeed = document.getElementById("hud-speed")!;
  const hudHeading = document.getElementById("hud-heading")!;
  const hudLoad = document.getElementById("hud-load")!;
  const event = document.getElementById("event")!;

  let crossed = false;
  function trigger(text: string) {
    event.textContent = text;
    event.classList.add("show");
    clearTimeout((trigger as any)._t);
    (trigger as any)._t = setTimeout(() => event.classList.remove("show"), 2400);
  }

  // — Resize.
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // — Loop.
  const clock = new THREE.Clock();
  const fixedStep = 1 / 60;
  const tmpForward = new CANNON.Vec3();
  const camOffset = new THREE.Vector3(0, 6.5, -11);
  const camTarget = new THREE.Vector3();

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);

    // Drive forces. Vehicle-local forward is +z; turning is yaw torque.
    // Heavier vehicle than the bike proxy → larger forces, but speed kept modest by linearDamping.
    const driveForce = 7500;
    const reverseForce = 4000;
    const turnTorque = 1600;

    // Rough "on ground" check: position above heightfield sample.
    const onGround = truckBody.position.y < sampleHeight(truckBody.position.x, truckBody.position.z) + 2.0;

    if (onGround) {
      const localForward = new CANNON.Vec3(0, 0, 1);
      truckBody.quaternion.vmult(localForward, tmpForward);
      if (keys.f) truckBody.applyForce(tmpForward.scale(driveForce), truckBody.position);
      if (keys.b) truckBody.applyForce(tmpForward.scale(-reverseForce), truckBody.position);
      if (keys.l) truckBody.torque.y += turnTorque;
      if (keys.r) truckBody.torque.y -= turnTorque;
      if (keys.brake) {
        truckBody.velocity.x *= 0.9;
        truckBody.velocity.z *= 0.9;
      }
    }

    world.step(fixedStep, dt, 3);

    // Sync mesh.
    truckMesh.position.set(truckBody.position.x, truckBody.position.y, truckBody.position.z);
    truckMesh.quaternion.set(truckBody.quaternion.x, truckBody.quaternion.y, truckBody.quaternion.z, truckBody.quaternion.w);

    // Wheel spin — proportional to forward velocity.
    const planarSpeed = Math.hypot(truckBody.velocity.x, truckBody.velocity.z);
    const wheelDelta = planarSpeed * dt / 0.4; // wheel radius
    for (const w of wheels) w.rotation.x -= wheelDelta;

    // Sync cargo bodies to meshes; flag any that have separated from the truck.
    let secured = 0;
    for (const c of cargoBodies) {
      c.mesh.position.set(c.body.position.x, c.body.position.y, c.body.position.z);
      c.mesh.quaternion.set(c.body.quaternion.x, c.body.quaternion.y, c.body.quaternion.z, c.body.quaternion.w);
      const dx = c.body.position.x - truckBody.position.x;
      const dy = c.body.position.y - truckBody.position.y;
      const dz = c.body.position.z - truckBody.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const onBoard = dist < 2.4 && c.body.position.y > truckBody.position.y - 0.5;
      if (!onBoard && !c.lost) {
        c.lost = true;
        trigger("load shifted");
      }
      if (onBoard) secured++;
    }
    hudLoad.textContent = `${secured}/${cargoBodies.length}`;

    // Camera follow — chase cam, behind the truck's local -z.
    const offsetWorld = camOffset.clone().applyQuaternion(truckMesh.quaternion);
    const desired = truckMesh.position.clone().add(offsetWorld);
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camTarget.copy(truckMesh.position).add(new THREE.Vector3(0, 1.4, 0));
    camera.lookAt(camTarget);

    // HUD.
    const speedKmh = Math.round(planarSpeed * 3.6);
    hudSpeed.textContent = String(speedKmh);
    const headingDeg = Math.round((Math.atan2(tmpForward.x, tmpForward.z) * 180) / Math.PI);
    hudHeading.textContent = `${headingDeg}°`;

    // Border crossing.
    if (!crossed && truckBody.position.z >= BORDER_Z) {
      crossed = true;
      trigger("crossed");
    } else if (crossed && truckBody.position.z < BORDER_Z - 2) {
      crossed = false;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  // — Helpers.

  function sampleHeight(x: number, z: number): number {
    // Map world (x,z) into heightfield grid coords (heightfield is rotated −π/2 around X).
    const u = (x + TERRAIN_SIZE / 2) / elementSize;
    const v = (TERRAIN_SIZE / 2 - z) / elementSize;
    const i = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(u)));
    const j = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(v)));
    return heights[i][j];
  }
}

// — Authored terrain. Ridge to the north, valley running E–W, gentle noise.
// Deterministic; not a real DEM — slice readability over realism.
function buildHeights(nx: number, nz: number): number[][] {
  const h: number[][] = [];
  for (let i = 0; i < nx; i++) {
    h[i] = [];
    for (let j = 0; j < nz; j++) {
      const x = (i / (nx - 1)) * 2 - 1; // −1..1
      const z = (j / (nz - 1)) * 2 - 1;
      // Ridge on +z side, soft on -z side.
      const ridge = Math.max(0, z) * 6.0;
      const valley = -Math.exp(-Math.pow(z * 2.2, 2)) * 1.2;
      const noise =
        Math.sin(x * 6.0) * 0.4 +
        Math.cos(z * 4.0) * 0.3 +
        Math.sin((x + z) * 9.0) * 0.15;
      h[i][j] = ridge + valley + noise;
    }
  }
  return h;
}

function buildTerrainMesh(heights: number[][], size: number, res: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      // PlaneGeometry vertex order: rows along x, cols along z (post-rotateX).
      // We want world (x,z) at vertex (i,j) to read heights[i'][j'] consistent with the cannon body's rotation+offset.
      // cannon body is rotated -π/2 about X, then translated to (-size/2, 0, +size/2). Empirically this maps:
      //   world x = -size/2 + i * elementSize  → grid i
      //   world z = +size/2 - j * elementSize  → grid j
      const idx = j * res + i;
      // Vertex at grid (i,j) in plane space lands at world (x,z) = (-size/2 + i*step, -size/2 + j*step).
      // To match the cannon mapping (z = +size/2 - j*step), flip j → res-1-j.
      pos.setY(idx, heights[i][res - 1 - j]);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6e6555,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  return new THREE.Mesh(geo, mat);
}

// — FJ40-silhouette Land Cruiser, primitives only.
// Period-correct read: short wheelbase, vertical grille, flat fenders, exposed rear cabin,
// roof rack with jerry cans + tarp-wrapped cargo. Cream-over-rust livery (typical 70s/80s fleet vehicle).
// Forward is +z (matches the cannon body local forward used in the drive code).
function buildFJ40(): THREE.Group {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc8b896, roughness: 0.85, metalness: 0.05 }); // cream
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.7, metalness: 0.1 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6b3a26, roughness: 0.95 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.3, metalness: 0.5 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.6, metalness: 0.4 });
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 1.0 });
  const canMat = new THREE.MeshStandardMaterial({ color: 0x556b3d, roughness: 0.7, metalness: 0.2 }); // olive jerry can
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xd9c87a, roughness: 0.2, metalness: 0.1, emissive: 0x2a2510 });

  // Lower body / chassis tub.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.7, 3.7), bodyMat);
  tub.position.y = 0.0;
  tub.castShadow = true;
  g.add(tub);

  // Hood (forward of cabin, +z side).
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.3), bodyMat);
  hood.position.set(0, 0.45, 1.15);
  hood.castShadow = true;
  g.add(hood);

  // Cabin (cream box behind the hood).
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 2.2), bodyMat);
  cabin.position.set(0, 0.75, -0.3);
  cabin.castShadow = true;
  g.add(cabin);

  // Windshield (slightly inset, glass).
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.8, 0.08), glassMat);
  windshield.position.set(0, 0.95, 0.7);
  g.add(windshield);

  // Side windows.
  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.9), glassMat);
  sideWinL.position.set(0.86, 1.05, -0.3);
  g.add(sideWinL);
  const sideWinR = sideWinL.clone();
  sideWinR.position.x = -0.86;
  g.add(sideWinR);

  // Rear window.
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.08), glassMat);
  rearWin.position.set(0, 1.05, -1.4);
  g.add(rearWin);

  // Vertical grille slats — the FJ40 read.
  const grilleHousing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 0.08), trimMat);
  grilleHousing.position.set(0, 0.45, 1.82);
  g.add(grilleHousing);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.04), rimMat);
    slat.position.set(i * 0.18, 0.45, 1.86);
    g.add(slat);
  }

  // Round headlights (the FJ40 face).
  const headL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), headlightMat);
  headL.rotation.x = Math.PI / 2;
  headL.position.set(0.6, 0.55, 1.84);
  g.add(headL);
  const headR = headL.clone();
  headR.position.x = -0.6;
  g.add(headR);

  // Front bumper.
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.18, 0.18), trimMat);
  bumper.position.set(0, 0.1, 1.92);
  g.add(bumper);
  // Rear bumper.
  const rearBumper = bumper.clone();
  rearBumper.position.set(0, 0.1, -1.92);
  g.add(rearBumper);

  // Flat fenders (suggestion of arches).
  const fender = (z: number, x: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.85), rustMat);
    f.position.set(x, 0.35, z);
    g.add(f);
  };
  fender(1.2, 0.94); fender(1.2, -0.94);
  fender(-1.2, 0.94); fender(-1.2, -0.94);

  // Wheels — 4. Cylinder rotated to align with x-axis. Track ~1.5m, wheelbase ~2.4m.
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 16);
  const wheelPositions: [number, number][] = [
    [0.85, 1.2], [-0.85, 1.2],   // front
    [0.85, -1.2], [-0.85, -1.2], // rear
  ];
  for (const [x, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -0.05, z);
    wheel.castShadow = true;
    g.add(wheel);
    wheels.push(wheel);
  }

  // Roof rack frame (thin black bars).
  const rackBaseY = 1.28;
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.04, 2.05), trimMat);
  rackFrame.position.set(0, rackBaseY, -0.3);
  g.add(rackFrame);
  // Rack rails.
  for (const x of [-0.78, 0.78]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 2.05), trimMat);
    rail.position.set(x, rackBaseY + 0.08, -0.3);
    g.add(rail);
  }

  // (Jerry cans + tarp-wrapped cargo are spawned as dynamic physics bodies in init() — they
  // sit on the rack by gravity and fall off if the truck flips or hits a bump too hard.)

  // Spare tire on rear hatch (FJ40 hallmark).
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), tireMat);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0.45, 0.55, -1.92);
  g.add(spare);
  const spareRim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12), rimMat);
  spareRim.rotation.x = Math.PI / 2;
  spareRim.position.set(0.45, 0.55, -1.92);
  g.add(spareRim);

  g.userData.wheels = wheels;
  return g;
}

// — Sky gradient. Cool dust-blue at the top, fades into the warmer fog tint at the horizon.
function buildSkyGradient(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#3a4452");   // upper sky
  grad.addColorStop(0.55, "#7d8492");  // mid
  grad.addColorStop(1.0, "#9aa0a8");   // horizon (matches fog)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// Sample helper used outside the main closure.
function sampleHeightAt(x: number, z: number, heights: number[][], elementSize: number): number {
  const u = (x + TERRAIN_SIZE / 2) / elementSize;
  const v = (TERRAIN_SIZE / 2 - z) / elementSize;
  const i = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(u)));
  const j = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(v)));
  return heights[i][j];
}

// — Watchtower. Wood-and-iron silhouette, four legs, small cabin, no light.
// Reads as: somebody is here, even if no one is in it tonight.
function buildWatchtower(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 });
  const tin = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.6, metalness: 0.4 });

  // Four legs.
  const legGeo = new THREE.BoxGeometry(0.18, 5.5, 0.18);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x * 1.0, 2.75, z * 1.0);
    leg.castShadow = true;
    g.add(leg);
  }
  // Cross-bracing (X pattern, two sides).
  const braceGeo = new THREE.BoxGeometry(2.6, 0.06, 0.06);
  for (let s = 0; s < 2; s++) {
    const z = s === 0 ? -1.05 : 1.05;
    const b1 = new THREE.Mesh(braceGeo, wood); b1.position.set(0, 1.6, z); b1.rotation.z = Math.PI / 5; g.add(b1);
    const b2 = new THREE.Mesh(braceGeo, wood); b2.position.set(0, 1.6, z); b2.rotation.z = -Math.PI / 5; g.add(b2);
  }
  // Cabin platform.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), wood);
  platform.position.set(0, 5.5, 0);
  platform.castShadow = true; platform.receiveShadow = true;
  g.add(platform);
  // Cabin walls (low, leaving a gap for the rifle slit).
  const wallGeo = new THREE.BoxGeometry(2.4, 0.9, 0.1);
  const w1 = new THREE.Mesh(wallGeo, wood); w1.position.set(0, 6.05, -1.15); g.add(w1);
  const w2 = new THREE.Mesh(wallGeo, wood); w2.position.set(0, 6.05, 1.15); g.add(w2);
  const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 2.4), wood); w3.position.set(-1.15, 6.05, 0); g.add(w3);
  const w4 = w3.clone(); w4.position.x = 1.15; g.add(w4);
  // Tin roof, slightly pitched.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 2.7), tin);
  roof.position.set(0, 6.7, 0);
  roof.rotation.x = -0.06;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

// — Distant ridge silhouette on the horizon. Just a dark, flat-shaded line of peaks.
function buildDistantRidge(): THREE.Mesh {
  const w = 600, segments = 80;
  const geo = new THREE.PlaneGeometry(w, 60, segments, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * w;
    // Two-octave noise for the ridge silhouette.
    const h = 14 + Math.sin(t * 22) * 6 + Math.sin(t * 7.3 + 1.2) * 9 + Math.cos(t * 3.1) * 4;
    pos.setY(i, h);          // top edge
    pos.setY(i + segments + 1, -10); // bottom edge sinks below horizon
    pos.setX(i, x);
    pos.setX(i + segments + 1, x);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x46505c, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI; // face -z so it's visible from the player driving +z
  return mesh;
}
