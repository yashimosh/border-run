// Vehicle — RaycastVehicle wrapper. Real 4-wheel suspension + steering + brakes.
// Ships two specs: FJ40 (short, high CoG, agile) and HJ75 pickup (long, lower CoG, heavier load).

import * as THREE from "three";
import * as CANNON from "cannon-es";

export type VehicleKind = "fj40" | "hj75";

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
  year: string;
  chassisHalfExtents: CANNON.Vec3;
  chassisMass: number;
  wheelPositions: { x: number; y: number; z: number }[];
  wheelRadius: number;
  engineForce: number;
  brakeForce: number;
  maxSteer: number;
  meshOffsetY: number;
  // Cargo platform (where loose items rest) + slot positions.
  // Local-space (chassis frame, before meshOffsetY).
  cargoPlatform: { halfExtents: CANNON.Vec3; offset: CANNON.Vec3 };
  cargoSlots: CargoSlot[];
}

export interface CargoSlot {
  kind: "jerrycan" | "tarp";
  // Local position above the cargo platform (gravity will settle them).
  local: { x: number; y: number; z: number };
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  fj40: {
    kind: "fj40",
    name: "Land Cruiser FJ40",
    year: "'79",
    chassisHalfExtents: new CANNON.Vec3(0.85, 0.45, 1.85),
    chassisMass: 1200,
    wheelPositions: [
      { x:  0.85, y: -0.25, z:  1.2 },
      { x: -0.85, y: -0.25, z:  1.2 },
      { x:  0.85, y: -0.25, z: -1.2 },
      { x: -0.85, y: -0.25, z: -1.2 },
    ],
    wheelRadius: 0.42,                        // bigger = better climbing on terrain edges
    engineForce: 5400,                        // more torque so steep slopes don't stall
    brakeForce: 75,
    maxSteer: 0.6,
    meshOffsetY: -0.45,
    // Cargo on the roof rack: thin platform at y=1.28, on top of the body.
    cargoPlatform: { halfExtents: new CANNON.Vec3(0.85, 0.05, 1.05), offset: new CANNON.Vec3(0, 1.33, -0.3) },
    cargoSlots: [
      { kind: "jerrycan", local: { x: -0.4, y: 1.7, z: 0.3 } },
      { kind: "jerrycan", local: { x:  0.0, y: 1.7, z: 0.3 } },
      { kind: "jerrycan", local: { x:  0.4, y: 1.7, z: 0.3 } },
      { kind: "tarp",     local: { x:  0.0, y: 1.78, z: -0.9 } },
    ],
  },
  hj75: {
    kind: "hj75",
    name: "Land Cruiser HJ75",
    year: "'85",
    chassisHalfExtents: new CANNON.Vec3(0.9, 0.5, 2.5),
    chassisMass: 1550,
    wheelPositions: [
      { x:  0.9, y: -0.3, z:  1.65 },
      { x: -0.9, y: -0.3, z:  1.65 },
      { x:  0.9, y: -0.3, z: -1.65 },
      { x: -0.9, y: -0.3, z: -1.65 },
    ],
    wheelRadius: 0.44,
    engineForce: 6200,
    brakeForce: 90,
    maxSteer: 0.5,
    meshOffsetY: -0.5,
    // Cargo in the bed: floor + side walls so cargo can't slide out sideways.
    cargoPlatform: { halfExtents: new CANNON.Vec3(0.85, 0.06, 1.15), offset: new CANNON.Vec3(0, 0.46, -1.3) },
    cargoSlots: [
      { kind: "tarp",     local: { x:  0.0, y: 0.85, z: -1.3 } },
      { kind: "jerrycan", local: { x: -0.55, y: 0.85, z: -0.4 } },
      { kind: "jerrycan", local: { x:  0.55, y: 0.85, z: -0.4 } },
    ],
  },
};

export interface Vehicle {
  spec: VehicleSpec;
  chassisBody: CANNON.Body;
  raycast: CANNON.RaycastVehicle;
  chassisMesh: THREE.Object3D;
  wheelMeshes: THREE.Mesh[];
  headlights: THREE.SpotLight[];
  brakeLights: THREE.Mesh[];     // emissive on brake
  steeringWheel: THREE.Object3D; // rotates with steering input
  exhaustLocal: THREE.Vector3;
  wheelGroundLocal: THREE.Vector3[];
}

export function buildVehicle(spec: VehicleSpec, world: CANNON.World, spawn: CANNON.Vec3): Vehicle {
  const chassisShape = new CANNON.Box(spec.chassisHalfExtents);
  const chassisBody = new CANNON.Body({ mass: spec.chassisMass });
  chassisBody.addShape(chassisShape);
  // Cargo platform — top of compound shape so loose cargo can rest on it.
  const platShape = new CANNON.Box(spec.cargoPlatform.halfExtents);
  chassisBody.addShape(platShape, spec.cargoPlatform.offset);
  // For HJ75: bed walls so cargo doesn't slide out the sides.
  if (spec.kind === "hj75") {
    const wallH = 0.28;
    const wallShape = new CANNON.Box(new CANNON.Vec3(0.04, wallH, 1.15));
    chassisBody.addShape(wallShape, new CANNON.Vec3(0.92, 0.46 + wallH + 0.06, -1.3));
    chassisBody.addShape(wallShape, new CANNON.Vec3(-0.92, 0.46 + wallH + 0.06, -1.3));
    const backShape = new CANNON.Box(new CANNON.Vec3(0.92, wallH, 0.04));
    chassisBody.addShape(backShape, new CANNON.Vec3(0, 0.46 + wallH + 0.06, -2.5));
  }
  chassisBody.position.copy(spawn);
  chassisBody.angularDamping = 0.4;

  const raycast = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0, // x
    indexUpAxis: 1,    // y
    indexForwardAxis: 2, // z
  });

  const wheelOpts = {
    radius: spec.wheelRadius,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 42,           // stiffer so wheels stay engaged on bumps
    suspensionRestLength: 0.4,
    frictionSlip: 2.6,
    dampingRelaxation: 2.8,
    dampingCompression: 5.2,
    maxSuspensionForce: 280000,        // way up — enables steep climbs
    rollInfluence: 0.02,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(),
    maxSuspensionTravel: 0.55,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  for (const wp of spec.wheelPositions) {
    const opt = { ...wheelOpts, chassisConnectionPointLocal: new CANNON.Vec3(wp.x, wp.y, wp.z) };
    raycast.addWheel(opt);
  }
  raycast.addToWorld(world);

  const built = spec.kind === "fj40" ? buildFJ40() : buildHJ75();
  const chassisMesh = built.group;
  const wheelMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < raycast.wheelInfos.length; i++) {
    const w = buildPolishedWheel(spec.wheelRadius);
    wheelMeshes.push(w);
  }

  // Headlights — two SpotLights parented to the chassis mesh, aimed forward (+z).
  const headlights: THREE.SpotLight[] = [];
  const headlightForwardZ = spec.kind === "fj40" ? 1.95 : 2.85;
  const headlightX = 0.6;
  for (const sign of [-1, 1]) {
    const light = new THREE.SpotLight(0xfff0c8, 18, 35, Math.PI / 7, 0.45, 1.4);
    light.position.set(sign * headlightX, 0.55, headlightForwardZ);
    const target = new THREE.Object3D();
    target.position.set(sign * headlightX * 0.5, -0.2, headlightForwardZ + 6);
    chassisMesh.add(target);
    light.target = target;
    chassisMesh.add(light);
    headlights.push(light);
  }

  // VFX local offsets.
  const exhaustLocal = new THREE.Vector3(
    spec.kind === "fj40" ? 0.7 : 0.85,
    -0.05,
    spec.kind === "fj40" ? -1.95 : -2.6
  );
  const wheelGroundLocal = spec.wheelPositions.map(
    wp => new THREE.Vector3(wp.x, wp.y - spec.wheelRadius, wp.z)
  );

  return {
    spec, chassisBody, raycast, chassisMesh, wheelMeshes, headlights,
    brakeLights: built.brakeLights,
    steeringWheel: built.steeringWheel,
    exhaustLocal, wheelGroundLocal,
  };
}

// Polished wheel: tire (outer), sidewall step, rim with 5 spokes + center cap.
// Returned as a single Mesh-like Object3D for compatibility (we wrap in a Group
// then mark .castShadow on children, but the public interface still works).
function buildPolishedWheel(radius: number): THREE.Mesh {
  // We need to return a Mesh per the existing wheelMeshes type. Use a tiny dummy
  // Mesh as the wrapper, attach detail children to it.
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const sidewallMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x707067, roughness: 0.45, metalness: 0.6 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9a9a8e, roughness: 0.4, metalness: 0.7 });

  const tireGeo = new THREE.CylinderGeometry(radius, radius, 0.32, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const wrapper = new THREE.Mesh(tireGeo, tireMat);
  wrapper.castShadow = true;

  // Sidewall step (slightly smaller diameter inner band, both sides).
  for (const side of [-1, 1]) {
    const sw = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.08, 22),
      sidewallMat
    );
    sw.rotation.z = Math.PI / 2;
    sw.position.x = side * 0.13;
    wrapper.add(sw);
  }

  // Rim disk on each face.
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.04, 18),
      rimMat
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.x = side * 0.17;
    wrapper.add(rim);

    // 5 spokes radiating from center.
    for (let s = 0; s < 5; s++) {
      const angle = (s / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, radius * 0.55, 0.08),
        rimMat
      );
      spoke.position.set(side * 0.18, Math.cos(angle) * radius * 0.32, Math.sin(angle) * radius * 0.32);
      spoke.rotation.x = angle;
      wrapper.add(spoke);
    }

    // Hub center cap with lug nuts.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, 0.06, 12), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * 0.2;
    wrapper.add(hub);
  }

  return wrapper;
}

export function syncVehicleMeshes(v: Vehicle) {
  // Chassis mesh is offset visually to put wheels at the right height.
  const cb = v.chassisBody;
  v.chassisMesh.position.set(cb.position.x, cb.position.y + v.spec.meshOffsetY, cb.position.z);
  v.chassisMesh.quaternion.set(cb.quaternion.x, cb.quaternion.y, cb.quaternion.z, cb.quaternion.w);

  for (let i = 0; i < v.raycast.wheelInfos.length; i++) {
    v.raycast.updateWheelTransform(i);
    const t = v.raycast.wheelInfos[i].worldTransform;
    const m = v.wheelMeshes[i];
    m.position.set(t.position.x, t.position.y, t.position.z);
    m.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
  }
}

// Shared materials for vehicle details.
function vehicleMaterials() {
  return {
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.7, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xa8a89c, roughness: 0.35, metalness: 0.85 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6b3a26, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.18, metalness: 0.6, transparent: true, opacity: 0.78 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.6, metalness: 0.4 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xfff2c4, roughness: 0.15, emissive: 0x423218, emissiveIntensity: 1.0 }),
    brakeOff: new THREE.MeshStandardMaterial({ color: 0x701418, roughness: 0.4, metalness: 0.1, emissive: 0x150404, emissiveIntensity: 0.0 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xd9a14a, roughness: 0.4, emissive: 0x4a2810, emissiveIntensity: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x9c7559, roughness: 1.0 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 1.0 }),
  };
}

// Driver silhouette — head + torso visible through windshield.
function buildDriver(skin: THREE.Material, cloth: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.32), cloth);
  torso.position.y = 0.27; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skin);
  head.position.y = 0.7; g.add(head);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), cloth);
  arm.position.set(-0.2, 0.4, 0.08); g.add(arm);
  return g;
}

// Steering wheel — small ring with a center hub. Returned so caller can rotate it.
function buildSteeringWheel(rim: THREE.Material, hub: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 18), rim);
  g.add(wheel);
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 8), hub);
  center.rotation.x = Math.PI / 2; g.add(center);
  // Two horizontal bars across the wheel — the period look.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.02), rim);
  g.add(bar);
  return g;
}

// Side mirror — small box on a stalk.
function sideMirror(side: number, x: number, y: number, z: number, body: THREE.Material, glass: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), body);
  stalk.position.set(side * 0.06, 0, 0); g.add(stalk);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.07), body);
  housing.position.set(side * 0.16, 0, 0); g.add(housing);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), glass);
  mirror.position.set(side * 0.21, 0, 0);
  mirror.rotation.y = side * Math.PI / 2;
  g.add(mirror);
  g.position.set(x, y, z);
  return g;
}

// — FJ40 silhouette: polished. Cream-over-rust period livery, side mirrors,
// running boards, antenna, mud flaps, brake lights, exhaust pipe, driver,
// steering wheel that rotates with input.
function buildFJ40(): { group: THREE.Group; brakeLights: THREE.Mesh[]; steeringWheel: THREE.Group } {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc8b896, roughness: 0.78, metalness: 0.06 });
  const M = vehicleMaterials();
  const brakeLights: THREE.Mesh[] = [];

  // Body shapes — chamfered with overlapping pieces for a less-boxy read.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.7, 3.7), bodyMat);
  tub.position.y = 0; tub.castShadow = true; g.add(tub);
  // Tub corner chamfer (small pieces angled at front-bottom and rear-bottom).
  const chamferF = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.16, 0.5), bodyMat);
  chamferF.position.set(0, -0.32, 1.6); chamferF.rotation.x = -0.3; g.add(chamferF);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.3), bodyMat);
  hood.position.set(0, 0.45, 1.15); hood.castShadow = true; g.add(hood);
  // Hood vent (raised strip).
  const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), M.trim);
  hoodVent.position.set(0, 0.73, 1.15); g.add(hoodVent);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 2.2), bodyMat);
  cabin.position.set(0, 0.75, -0.3); cabin.castShadow = true; g.add(cabin);

  // Door cuts — thin trim lines suggesting separate door panels.
  for (const sign of [-1, 1]) {
    const cut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.05), M.trim);
    cut.position.set(sign * 0.86, 0.7, -0.5); g.add(cut);
    // Door handle.
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), M.chrome);
    handle.position.set(sign * 0.86, 0.78, -0.6); g.add(handle);
  }

  // Glass.
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.78, 0.06), M.glass);
  windshield.position.set(0, 0.95, 0.72); g.add(windshield);
  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 1.9), M.glass);
  sideWinL.position.set(0.86, 1.05, -0.3); g.add(sideWinL);
  const sideWinR = sideWinL.clone(); sideWinR.position.x = -0.86; g.add(sideWinR);
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.06), M.glass);
  rearWin.position.set(0, 1.05, -1.4); g.add(rearWin);

  // Grille.
  const grilleHousing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 0.08), M.trim);
  grilleHousing.position.set(0, 0.45, 1.82); g.add(grilleHousing);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.04), M.rim);
    slat.position.set(i * 0.18, 0.45, 1.86); g.add(slat);
  }
  // FJ40 "TOYOTA" badge area — thin chrome bar.
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.04), M.chrome);
  badge.position.set(0, 0.78, 1.86); g.add(badge);

  // Round headlights (chrome bezel + glass lens).
  for (const sign of [-1, 1]) {
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14), M.chrome);
    bezel.rotation.x = Math.PI / 2; bezel.position.set(sign * 0.6, 0.55, 1.84); g.add(bezel);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), M.headlight);
    lens.rotation.x = Math.PI / 2; lens.position.set(sign * 0.6, 0.55, 1.86); g.add(lens);
    // Indicator light next to it.
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.04), M.indicator);
    ind.position.set(sign * 0.85, 0.55, 1.84); g.add(ind);
  }

  // Bumpers — chrome look on FJ40.
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 0.22), M.chrome);
  bumperF.position.set(0, 0.1, 1.95); g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 0.22), M.chrome);
  bumperR.position.set(0, 0.1, -1.95); g.add(bumperR);
  // Tow hook on rear.
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 4, 8), M.rim);
  hook.rotation.x = Math.PI / 2; hook.position.set(0, 0.05, -2.05); g.add(hook);

  // Brake lights — small red rectangles on the rear, will glow when braking.
  for (const sign of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), M.brakeOff);
    bl.position.set(sign * 0.7, 0.32, -1.94); g.add(bl); brakeLights.push(bl);
  }

  // Fenders (rust-orange).
  const fender = (z: number, x: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.85), M.rust);
    f.position.set(x, 0.35, z); g.add(f);
  };
  fender(1.2, 0.94); fender(1.2, -0.94); fender(-1.2, 0.94); fender(-1.2, -0.94);

  // Running boards (side step).
  for (const sign of [-1, 1]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.7), M.trim);
    step.position.set(sign * 0.92, 0.05, -0.3); g.add(step);
  }

  // Mud flaps behind rear wheels.
  for (const sign of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.03), M.rubber);
    flap.position.set(sign * 0.92, 0.14, -1.55); g.add(flap);
  }

  // Side mirrors.
  g.add(sideMirror(1, 0.92, 1.05, 0.7, bodyMat, M.glass));
  g.add(sideMirror(-1, -0.92, 1.05, 0.7, bodyMat, M.glass));

  // Antenna — thin pole on front-right fender.
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.85, 5), M.rim);
  antenna.position.set(0.92, 0.85, 1.0); antenna.rotation.x = -0.05; g.add(antenna);

  // Exhaust pipe sticking out the rear.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 10), M.chrome);
  pipe.rotation.x = Math.PI / 2; pipe.position.set(0.65, 0.18, -1.92); g.add(pipe);

  // Roof rack frame.
  const rackY = 1.28;
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.04, 2.05), M.trim);
  rackFrame.position.set(0, rackY, -0.3); g.add(rackFrame);
  for (const x of [-0.78, 0.78]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 2.05), M.trim);
    rail.position.set(x, rackY + 0.08, -0.3); g.add(rail);
  }
  // Rack crossbeams.
  for (const z of [-1.2, -0.3, 0.6]) {
    const cb = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.03, 0.04), M.trim);
    cb.position.set(0, rackY + 0.05, z); g.add(cb);
  }

  // Spare tire on rear hatch.
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), M.rubber);
  spare.rotation.x = Math.PI / 2; spare.position.set(0.45, 0.55, -1.94); g.add(spare);
  const spareRim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12), M.rim);
  spareRim.rotation.x = Math.PI / 2; spareRim.position.set(0.45, 0.55, -1.94); g.add(spareRim);

  // Driver and steering wheel inside cabin.
  const driver = buildDriver(M.skin, M.cloth);
  driver.position.set(0.3, 0.6, -0.1); g.add(driver);
  const sw = buildSteeringWheel(M.rim, M.chrome);
  sw.position.set(0.3, 0.85, 0.45);
  sw.rotation.x = -0.4;
  g.add(sw);

  return { group: g, brakeLights, steeringWheel: sw };
}

// — HJ75 pickup: polished. Dusty olive paint, square workhorse profile,
// cargo strapped in the bed with visible straps, mud flaps, side mirrors,
// chrome trim only where it would actually appear (not as decoration).
function buildHJ75(): { group: THREE.Group; brakeLights: THREE.Mesh[]; steeringWheel: THREE.Group } {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x546b54, roughness: 0.85, metalness: 0.04 });
  const M = vehicleMaterials();
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 1.0 });
  const brakeLights: THREE.Mesh[] = [];

  // Cabin.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.05, 2.2), bodyMat);
  cabin.position.set(0, 0.75, 0.6); cabin.castShadow = true; g.add(cabin);
  // Door cuts.
  for (const sign of [-1, 1]) {
    const cut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.95, 0.05), M.trim);
    cut.position.set(sign * 0.94, 0.75, 0.5); g.add(cut);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), M.chrome);
    handle.position.set(sign * 0.94, 0.85, 0.3); g.add(handle);
  }

  // Hood.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.3), bodyMat);
  hood.position.set(0, 0.5, 2.05); hood.castShadow = true; g.add(hood);
  // Hood vent.
  const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.5), M.trim);
  hoodVent.position.set(0, 0.78, 2.05); g.add(hoodVent);

  // Bed floor.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.35, 2.4), bodyMat);
  bed.position.set(0, 0.4, -1.3); bed.castShadow = true; g.add(bed);

  // Bed walls.
  const wallH = 0.55;
  for (const [x, w, z, depth] of [
    [0.94, 0.06, -1.3, 2.4],
    [-0.94, 0.06, -1.3, 2.4],
    [0, 1.85, -2.5, 0.06],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, depth), bodyMat);
    wall.position.set(x, 0.6 + wallH / 2, z); g.add(wall);
  }

  // Tarp-wrapped cargo.
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), tarpMat);
  cargo.position.set(0, 1.0, -1.3); cargo.castShadow = true; g.add(cargo);
  // Cargo straps — three thin dark bands across the tarp.
  for (const sx of [-0.6, 0, 0.6]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.04, 0.06), M.trim);
    strap.position.set(0, 1.28, -1.3 + sx); g.add(strap);
    // Side drops.
    for (const side of [-1, 1]) {
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.06), M.trim);
      drop.position.set(side * 0.82, 1.0, -1.3 + sx); g.add(drop);
    }
  }

  // Glass.
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 0.06), M.glass);
  windshield.position.set(0, 1.1, 1.65); g.add(windshield);
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.06), M.glass);
  rearWin.position.set(0, 1.15, -0.5); g.add(rearWin);
  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 2.0), M.glass);
  sideWinL.position.set(0.94, 1.18, 0.6); g.add(sideWinL);
  const sideWinR = sideWinL.clone(); sideWinR.position.x = -0.94; g.add(sideWinR);

  // Grille (HJ75 has a wider, less ornate grille than FJ40).
  const grilleHousing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.08), M.trim);
  grilleHousing.position.set(0, 0.5, 2.74); g.add(grilleHousing);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.04), M.rim);
    slat.position.set(i * 0.2, 0.5, 2.78); g.add(slat);
  }

  // Headlights — rectangular on HJ75 (period-correct sealed beams).
  for (const sign of [-1, 1]) {
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.06), M.chrome);
    bezel.position.set(sign * 0.65, 0.6, 2.76); g.add(bezel);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.04), M.headlight);
    lens.position.set(sign * 0.65, 0.6, 2.79); g.add(lens);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04), M.indicator);
    ind.position.set(sign * 0.65, 0.42, 2.78); g.add(ind);
  }

  // Bumpers + tow hitch.
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 0.22), M.trim);
  bumperF.position.set(0, 0.15, 2.86); g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 0.22), M.trim);
  bumperR.position.set(0, 0.15, -2.62); g.add(bumperR);
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.32), M.rim);
  hitch.position.set(0, 0.12, -2.78); g.add(hitch);
  const hitchBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.chrome);
  hitchBall.position.set(0, 0.22, -2.78); g.add(hitchBall);

  // Brake lights — rectangular red panels on HJ75.
  for (const sign of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.04), M.brakeOff);
    bl.position.set(sign * 0.7, 0.5, -2.55); g.add(bl); brakeLights.push(bl);
  }

  // Fenders.
  const fender = (z: number, x: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.95), M.rust);
    f.position.set(x, 0.35, z); g.add(f);
  };
  fender(1.65, 0.95); fender(1.65, -0.95); fender(-1.65, 0.95); fender(-1.65, -0.95);

  // Running boards.
  for (const sign of [-1, 1]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 1.9), M.trim);
    step.position.set(sign * 0.96, 0.05, 0.6); g.add(step);
  }

  // Mud flaps — bigger on HJ75.
  for (const sign of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.03), M.rubber);
    flap.position.set(sign * 0.96, 0.18, -2.18); g.add(flap);
  }

  // Side mirrors.
  g.add(sideMirror(1, 0.98, 1.18, 1.65, bodyMat, M.glass));
  g.add(sideMirror(-1, -0.98, 1.18, 1.65, bodyMat, M.glass));

  // Antenna.
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.95, 5), M.rim);
  antenna.position.set(0.95, 0.95, 1.85); antenna.rotation.x = -0.05; g.add(antenna);

  // Exhaust pipe — angled out the rear-left.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), M.chrome);
  pipe.rotation.x = Math.PI / 2; pipe.position.set(-0.85, 0.18, -2.65); g.add(pipe);

  // Driver + steering wheel.
  const driver = buildDriver(M.skin, M.cloth);
  driver.position.set(0.32, 0.55, 0.55); g.add(driver);
  const sw = buildSteeringWheel(M.rim, M.chrome);
  sw.position.set(0.32, 0.95, 1.4); sw.rotation.x = -0.4; g.add(sw);

  return { group: g, brakeLights, steeringWheel: sw };
}
