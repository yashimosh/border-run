// Cargo — independent rigid bodies riding on the vehicle's cargo platform.
// Drive smooth → they stay. Flip or hit a bump too hard → they tumble off.
// HUD load count ticks down. No fail state — the small bad thing is the point.

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Vehicle, CargoSlot } from "./vehicle";

export interface CargoItem {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  kind: CargoSlot["kind"];
  lost: boolean;
}

export function spawnCargo(vehicle: Vehicle, world: CANNON.World, scene: THREE.Scene): CargoItem[] {
  const items: CargoItem[] = [];
  const cargoMat = new CANNON.Material({ friction: 0.7, restitution: 0.05 });

  // Contact between truck shapes and cargo: high friction so they grip the platform.
  const truckMat = (vehicle.chassisBody.material as CANNON.Material) ?? new CANNON.Material();
  if (!vehicle.chassisBody.material) vehicle.chassisBody.material = truckMat;
  world.addContactMaterial(new CANNON.ContactMaterial(truckMat, cargoMat, {
    friction: 0.95, restitution: 0.0,
  }));

  // Material for cargo-on-cargo contact (so they stack reasonably).
  world.addContactMaterial(new CANNON.ContactMaterial(cargoMat, cargoMat, {
    friction: 0.6, restitution: 0.0,
  }));

  for (const slot of vehicle.spec.cargoSlots) {
    const item = createCargoBody(slot, cargoMat);
    // Position cargo in world space relative to vehicle spawn.
    const localPos = new CANNON.Vec3(slot.local.x, slot.local.y + vehicle.spec.meshOffsetY, slot.local.z);
    const worldPos = new CANNON.Vec3();
    vehicle.chassisBody.pointToWorldFrame(localPos, worldPos);
    item.body.position.copy(worldPos);
    world.addBody(item.body);

    const mesh = createCargoMesh(slot.kind);
    scene.add(mesh);
    items.push({ body: item.body, mesh, kind: slot.kind, lost: false });
  }
  return items;
}

function createCargoBody(slot: CargoSlot, material: CANNON.Material): { body: CANNON.Body } {
  let halfExt: CANNON.Vec3;
  let mass: number;
  if (slot.kind === "jerrycan") {
    halfExt = new CANNON.Vec3(0.16, 0.21, 0.09);
    mass = 8;   // lighter so they settle nicely on the rack
  } else {
    halfExt = new CANNON.Vec3(0.78, 0.27, 0.5);
    mass = 22;
  }
  const body = new CANNON.Body({ mass, material });
  body.addShape(new CANNON.Box(halfExt));
  body.linearDamping = 0.18;   // higher damping so they don't bounce
  body.angularDamping = 0.35;
  return { body };
}

function createCargoMesh(kind: CargoSlot["kind"]): THREE.Mesh {
  if (kind === "jerrycan") {
    const geo = new THREE.BoxGeometry(0.32, 0.42, 0.18);
    const mat = new THREE.MeshStandardMaterial({ color: 0x556b3d, roughness: 0.7, metalness: 0.2 });
    // Add a subtle ridge — fake the jerrycan side panel detail via vertex colors.
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  } else {
    const geo = new THREE.BoxGeometry(1.56, 0.55, 1.0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 1.0 });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }
}

// Sync each cargo body to its mesh, detect when items have separated from the
// truck (fallen off), update the secured count.
export function updateCargo(items: CargoItem[], vehicle: Vehicle): { secured: number; total: number; justLost: CargoItem | null } {
  let secured = 0;
  let justLost: CargoItem | null = null;
  for (const c of items) {
    c.mesh.position.set(c.body.position.x, c.body.position.y, c.body.position.z);
    c.mesh.quaternion.set(c.body.quaternion.x, c.body.quaternion.y, c.body.quaternion.z, c.body.quaternion.w);
    const dx = c.body.position.x - vehicle.chassisBody.position.x;
    const dy = c.body.position.y - vehicle.chassisBody.position.y;
    const dz = c.body.position.z - vehicle.chassisBody.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const onBoard = dist < 3.0 && dy > -0.5;
    if (!onBoard && !c.lost) {
      c.lost = true;
      justLost = c;
    }
    if (onBoard) secured++;
  }
  return { secured, total: items.length, justLost };
}

export function resetCargo(items: CargoItem[], vehicle: Vehicle) {
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    const slot = vehicle.spec.cargoSlots[i];
    const localPos = new CANNON.Vec3(slot.local.x, slot.local.y + vehicle.spec.meshOffsetY, slot.local.z);
    const worldPos = new CANNON.Vec3();
    vehicle.chassisBody.pointToWorldFrame(localPos, worldPos);
    c.body.position.copy(worldPos);
    c.body.velocity.set(0, 0, 0);
    c.body.angularVelocity.set(0, 0, 0);
    c.body.quaternion.copy(vehicle.chassisBody.quaternion);
    c.lost = false;
  }
}
