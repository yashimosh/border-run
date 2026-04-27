// Vehicle — RaycastVehicle wrapper. Real 4-wheel suspension + steering + brakes.
// Ships two specs: FJ40 (short, high CoG, agile) and HJ75 pickup (long, lower CoG, heavier load).

import * as THREE from "three";
import * as CANNON from "cannon-es";

export type VehicleKind = "fj40" | "hj75";

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
  year: string;
  // Chassis half-extents for the cannon Box (not the visual mesh).
  chassisHalfExtents: CANNON.Vec3;
  chassisMass: number;
  // Wheel positions in chassis-local space (y is height of wheel center from chassis center).
  wheelPositions: { x: number; y: number; z: number }[];
  wheelRadius: number;
  engineForce: number;
  brakeForce: number;
  maxSteer: number;
  // Center-of-mass shift (cannon Body offset of the visual)
  meshOffsetY: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  fj40: {
    kind: "fj40",
    name: "Land Cruiser FJ40",
    year: "'79",
    chassisHalfExtents: new CANNON.Vec3(0.85, 0.45, 1.85),
    chassisMass: 1300,
    wheelPositions: [
      { x:  0.85, y: -0.25, z:  1.2 }, // front-right
      { x: -0.85, y: -0.25, z:  1.2 }, // front-left
      { x:  0.85, y: -0.25, z: -1.2 }, // rear-right
      { x: -0.85, y: -0.25, z: -1.2 }, // rear-left
    ],
    wheelRadius: 0.4,
    engineForce: 2200,
    brakeForce: 60,
    maxSteer: 0.55,
    meshOffsetY: -0.45,
  },
  hj75: {
    kind: "hj75",
    name: "Land Cruiser HJ75",
    year: "'85",
    chassisHalfExtents: new CANNON.Vec3(0.9, 0.5, 2.5),
    chassisMass: 1700,
    wheelPositions: [
      { x:  0.9, y: -0.3, z:  1.65 },
      { x: -0.9, y: -0.3, z:  1.65 },
      { x:  0.9, y: -0.3, z: -1.65 },
      { x: -0.9, y: -0.3, z: -1.65 },
    ],
    wheelRadius: 0.42,
    engineForce: 2600,
    brakeForce: 70,
    maxSteer: 0.45,
    meshOffsetY: -0.5,
  },
};

export interface Vehicle {
  spec: VehicleSpec;
  chassisBody: CANNON.Body;
  raycast: CANNON.RaycastVehicle;
  chassisMesh: THREE.Object3D;
  wheelMeshes: THREE.Mesh[];
}

export function buildVehicle(spec: VehicleSpec, world: CANNON.World, spawn: CANNON.Vec3): Vehicle {
  const chassisShape = new CANNON.Box(spec.chassisHalfExtents);
  const chassisBody = new CANNON.Body({ mass: spec.chassisMass });
  chassisBody.addShape(chassisShape);
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
    suspensionStiffness: 32,
    suspensionRestLength: 0.32,
    frictionSlip: 1.55,
    dampingRelaxation: 2.4,
    dampingCompression: 4.5,
    maxSuspensionForce: 100000,
    rollInfluence: 0.04,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(),
    maxSuspensionTravel: 0.35,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  for (const wp of spec.wheelPositions) {
    const opt = { ...wheelOpts, chassisConnectionPointLocal: new CANNON.Vec3(wp.x, wp.y, wp.z) };
    raycast.addWheel(opt);
  }
  raycast.addToWorld(world);

  const chassisMesh = spec.kind === "fj40" ? buildFJ40() : buildHJ75();
  const wheelMeshes: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.32, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  for (let i = 0; i < raycast.wheelInfos.length; i++) {
    const m = new THREE.Mesh(wheelGeo, wheelMat);
    m.castShadow = true;
    wheelMeshes.push(m);
  }

  return { spec, chassisBody, raycast, chassisMesh, wheelMeshes };
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

// — FJ40 silhouette (short wheelbase, vertical grille).
function buildFJ40(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc8b896, roughness: 0.85, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.7, metalness: 0.1 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6b3a26, roughness: 0.95 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.3, metalness: 0.5 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.6, metalness: 0.4 });
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xd9c87a, roughness: 0.2, emissive: 0x2a2510 });

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.7, 3.7), bodyMat);
  tub.position.y = 0; tub.castShadow = true; g.add(tub);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.3), bodyMat);
  hood.position.set(0, 0.45, 1.15); hood.castShadow = true; g.add(hood);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 2.2), bodyMat);
  cabin.position.set(0, 0.75, -0.3); cabin.castShadow = true; g.add(cabin);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.8, 0.08), glassMat);
  windshield.position.set(0, 0.95, 0.7); g.add(windshield);

  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.9), glassMat);
  sideWinL.position.set(0.86, 1.05, -0.3); g.add(sideWinL);
  const sideWinR = sideWinL.clone(); sideWinR.position.x = -0.86; g.add(sideWinR);

  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.08), glassMat);
  rearWin.position.set(0, 1.05, -1.4); g.add(rearWin);

  const grilleHousing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 0.08), trimMat);
  grilleHousing.position.set(0, 0.45, 1.82); g.add(grilleHousing);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.04), rimMat);
    slat.position.set(i * 0.18, 0.45, 1.86); g.add(slat);
  }

  const headL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), headlightMat);
  headL.rotation.x = Math.PI / 2; headL.position.set(0.6, 0.55, 1.84); g.add(headL);
  const headR = headL.clone(); headR.position.x = -0.6; g.add(headR);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.18, 0.18), trimMat);
  bumper.position.set(0, 0.1, 1.92); g.add(bumper);
  const rearBumper = bumper.clone(); rearBumper.position.set(0, 0.1, -1.92); g.add(rearBumper);

  const fender = (z: number, x: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.85), rustMat);
    f.position.set(x, 0.35, z); g.add(f);
  };
  fender(1.2, 0.94); fender(1.2, -0.94); fender(-1.2, 0.94); fender(-1.2, -0.94);

  // Roof rack frame.
  const rackY = 1.28;
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.04, 2.05), trimMat);
  rackFrame.position.set(0, rackY, -0.3); g.add(rackFrame);
  for (const x of [-0.78, 0.78]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 2.05), trimMat);
    rail.position.set(x, rackY + 0.08, -0.3); g.add(rail);
  }

  // Spare on rear hatch.
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), tireMat);
  spare.rotation.x = Math.PI / 2; spare.position.set(0.45, 0.55, -1.92); g.add(spare);

  return g;
}

// — HJ75 pickup silhouette (longer wheelbase, with bed).
function buildHJ75(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x546b54, roughness: 0.9 }); // dusty olive
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.7 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6b3a26, roughness: 0.95 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.3, metalness: 0.5 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.6, metalness: 0.4 });
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xd9c87a, roughness: 0.2, emissive: 0x2a2510 });
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 1.0 });

  // Cabin (front portion).
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.05, 2.2), bodyMat);
  cabin.position.set(0, 0.75, 0.6); cabin.castShadow = true; g.add(cabin);

  // Hood.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.3), bodyMat);
  hood.position.set(0, 0.5, 2.05); hood.castShadow = true; g.add(hood);

  // Bed.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.35, 2.4), bodyMat);
  bed.position.set(0, 0.4, -1.3); bed.castShadow = true; g.add(bed);

  // Bed walls.
  const wallH = 0.5;
  for (const [x, w, z, depth] of [
    [0.94, 0.06, -1.3, 2.4],
    [-0.94, 0.06, -1.3, 2.4],
    [0, 1.85, -2.5, 0.06],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, depth), bodyMat);
    wall.position.set(x, 0.6 + wallH / 2, z); g.add(wall);
  }

  // Tarp-wrapped cargo in the bed.
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), tarpMat);
  cargo.position.set(0, 1.0, -1.3); cargo.castShadow = true; g.add(cargo);

  // Glass.
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 0.08), glassMat);
  windshield.position.set(0, 1.1, 1.65); g.add(windshield);
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.08), glassMat);
  rearWin.position.set(0, 1.15, -0.5); g.add(rearWin);
  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 2.0), glassMat);
  sideWinL.position.set(0.94, 1.18, 0.6); g.add(sideWinL);
  const sideWinR = sideWinL.clone(); sideWinR.position.x = -0.94; g.add(sideWinR);

  // Grille + headlights.
  const grilleHousing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.08), trimMat);
  grilleHousing.position.set(0, 0.5, 2.74); g.add(grilleHousing);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.04), rimMat);
    slat.position.set(i * 0.2, 0.5, 2.78); g.add(slat);
  }
  const headL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12), headlightMat);
  headL.rotation.x = Math.PI / 2; headL.position.set(0.65, 0.6, 2.76); g.add(headL);
  const headR = headL.clone(); headR.position.x = -0.65; g.add(headR);

  // Bumpers + fenders.
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 0.2), trimMat);
  bumper.position.set(0, 0.15, 2.84); g.add(bumper);
  const rearBumper = bumper.clone(); rearBumper.position.set(0, 0.15, -2.6); g.add(rearBumper);

  const fender = (z: number, x: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.95), rustMat);
    f.position.set(x, 0.35, z); g.add(f);
  };
  fender(1.65, 0.95); fender(1.65, -0.95); fender(-1.65, 0.95); fender(-1.65, -0.95);

  return g;
}
