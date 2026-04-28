// Props — dynamic-body scenery that reacts to the truck. Goats that ragdoll
// when hit, oil barrels that knock over and roll. Each prop is a CANNON body
// + Three Group, synced each tick like cargo.

import * as THREE from "three";
import * as CANNON from "cannon-es";

export interface Prop {
  body: CANNON.Body;
  mesh: THREE.Object3D;
  kind: "goat" | "barrel";
}

const propMat = new CANNON.Material({ friction: 0.5, restitution: 0.15 });

// — Goat body + mesh. Light enough to react when hit, but damped so it
// doesn't endless-spin or rocket into orbit. Max angular velocity capped
// per frame in updateGoatBrains so collisions don't snap-rotate them.
export function spawnGoat(world: CANNON.World, scene: THREE.Scene, pos: THREE.Vector3): Prop {
  const halfExt = new CANNON.Vec3(0.3, 0.32, 0.5);
  const body = new CANNON.Body({ mass: 18, material: propMat });
  body.addShape(new CANNON.Box(halfExt));
  body.position.set(pos.x, pos.y + 0.6, pos.z);
  body.linearDamping = 0.5;     // stops sliding around forever
  body.angularDamping = 0.85;    // stops endless spin
  body.linearFactor.set(1, 1, 1);
  body.angularFactor.set(0.3, 1, 0.3); // restrict pitch/roll, allow yaw mostly
  world.addBody(body);

  const mesh = buildGoatMesh();
  scene.add(mesh);
  return { body, mesh, kind: "goat" };
}

function buildGoatMesh(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb0a890, roughness: 1.0 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 1.0 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.85), bodyMat);
  torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.35), bodyMat);
  head.position.set(0, 0.18, 0.55); g.add(head);
  for (const [x, z] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.3], [0.18, -0.3]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), darkMat);
    leg.position.set(x, -0.4, z); g.add(leg);
  }
  for (const sign of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.22, 5), darkMat);
    horn.position.set(sign * 0.1, 0.36, 0.55);
    horn.rotation.z = sign * 0.4;
    g.add(horn);
  }
  return g;
}

// — Oil barrel: rusted blue, taller than wide, knocks over and rolls.
export function spawnBarrel(world: CANNON.World, scene: THREE.Scene, pos: THREE.Vector3): Prop {
  const radius = 0.36;
  const height = 0.95;
  const body = new CANNON.Body({ mass: 28, material: propMat });
  body.addShape(new CANNON.Cylinder(radius, radius, height, 12));
  body.position.set(pos.x, pos.y + height / 2 + 0.05, pos.z);
  body.linearDamping = 0.3;
  body.angularDamping = 0.25;
  // Tip slightly so they look "left out", not arranged on a grid.
  body.quaternion.setFromEuler((Math.random() - 0.5) * 0.06, Math.random() * Math.PI, (Math.random() - 0.5) * 0.06);
  world.addBody(body);

  const mesh = buildBarrelMesh(radius, height);
  scene.add(mesh);
  return { body, mesh, kind: "barrel" };
}

function buildBarrelMesh(radius: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardMaterial({ color: 0x2f4858, roughness: 0.85, metalness: 0.3 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b3a26, roughness: 0.95 });
  const ring = new THREE.MeshStandardMaterial({ color: 0x7a715f, roughness: 0.5, metalness: 0.6 });

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), blue);
  drum.castShadow = true; g.add(drum);

  // Two ribs around the drum.
  for (const y of [-0.18, 0.18]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.01, 0.025, 6, 18), ring);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = y;
    g.add(rib);
  }
  // Rust patches: small flat planes on the surface.
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.18 + Math.random() * 0.15, 0.22 + Math.random() * 0.18), rust);
    patch.position.set(Math.cos(a) * (radius + 0.001), (Math.random() - 0.5) * (height - 0.2), Math.sin(a) * (radius + 0.001));
    patch.lookAt(patch.position.clone().multiplyScalar(2));
    g.add(patch);
  }
  // Lid lip on top.
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.04, radius - 0.04, 0.04, 16), ring);
  lid.position.y = height / 2;
  g.add(lid);
  return g;
}

export function syncProps(props: Prop[]) {
  for (const p of props) {
    p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
    p.mesh.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
  }
}

// — Birds: proper boids flock. Cohesion + alignment + separation + wander +
// avoid-truck. ~16 birds, all visible on screen at once.
interface Boid {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  flapPhase: number;
}

export class BirdFlock {
  private boids: Boid[] = [];
  private scene: THREE.Scene;
  private bounds: number;
  private mat: THREE.MeshBasicMaterial;

  // Tunable boid params.
  private maxSpeed = 9.5;
  private minSpeed = 4.5;
  private cohesionR = 12;
  private separationR = 3.0;
  private alignmentR = 8;
  private cohesionW = 0.6;
  private separationW = 1.6;
  private alignmentW = 0.9;
  private wanderW = 0.4;
  private avoidTruckR = 14;
  private avoidTruckW = 5.0;
  private cruiseAltitude = 28;
  private altitudeSpring = 0.5;

  constructor(scene: THREE.Scene, bounds: number, count = 16) {
    this.scene = scene;
    this.bounds = bounds;
    this.mat = new THREE.MeshBasicMaterial({ color: 0x1a1f24, fog: true });
    for (let i = 0; i < count; i++) this.spawn();
  }

  private spawn() {
    const mesh = this.makeBird();
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * this.bounds * 0.8,
      this.cruiseAltitude + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * this.bounds * 0.8,
    );
    mesh.position.copy(pos);
    const angle = Math.random() * Math.PI * 2;
    const sp = (this.minSpeed + this.maxSpeed) * 0.5;
    const vel = new THREE.Vector3(Math.cos(angle) * sp, 0, Math.sin(angle) * sp);
    this.scene.add(mesh);
    this.boids.push({ mesh, pos, vel, flapPhase: Math.random() * Math.PI * 2 });
  }

  update(dt: number, truckPos?: THREE.Vector3) {
    const acc = new THREE.Vector3();
    for (let i = 0; i < this.boids.length; i++) {
      const a = this.boids[i];
      acc.set(0, 0, 0);

      // Cohesion + alignment + separation.
      let cohCount = 0; const cohCenter = new THREE.Vector3();
      let aliCount = 0; const aliVel = new THREE.Vector3();
      let sepForce = new THREE.Vector3();

      for (let j = 0; j < this.boids.length; j++) {
        if (j === i) continue;
        const b = this.boids[j];
        const d = a.pos.distanceTo(b.pos);
        if (d < this.cohesionR) { cohCenter.add(b.pos); cohCount++; }
        if (d < this.alignmentR) { aliVel.add(b.vel); aliCount++; }
        if (d < this.separationR && d > 0.001) {
          const away = a.pos.clone().sub(b.pos).divideScalar(d * d);
          sepForce.add(away);
        }
      }
      if (cohCount > 0) {
        cohCenter.divideScalar(cohCount).sub(a.pos).multiplyScalar(this.cohesionW * 0.5);
        acc.add(cohCenter);
      }
      if (aliCount > 0) {
        aliVel.divideScalar(aliCount).sub(a.vel).multiplyScalar(this.alignmentW * 0.5);
        acc.add(aliVel);
      }
      sepForce.multiplyScalar(this.separationW * 8);
      acc.add(sepForce);

      // Wander: small random nudge.
      acc.x += (Math.random() - 0.5) * this.wanderW;
      acc.z += (Math.random() - 0.5) * this.wanderW;

      // Altitude spring — stay near cruise height.
      acc.y += (this.cruiseAltitude - a.pos.y) * this.altitudeSpring;

      // Avoid the truck — flee if too close.
      if (truckPos) {
        const toTruck = a.pos.clone().sub(truckPos);
        const dt2 = toTruck.length();
        if (dt2 < this.avoidTruckR && dt2 > 0.001) {
          const flee = toTruck.divideScalar(dt2 * dt2).multiplyScalar(this.avoidTruckW * this.avoidTruckR);
          acc.add(flee);
          acc.y += this.avoidTruckW * 0.6; // climb when fleeing
        }
      }

      // Stay within bounds — gently turn back if drifting out.
      const margin = this.bounds * 0.85;
      if (a.pos.x > margin) acc.x -= 4;
      else if (a.pos.x < -margin) acc.x += 4;
      if (a.pos.z > margin) acc.z -= 4;
      else if (a.pos.z < -margin) acc.z += 4;

      // Integrate.
      a.vel.addScaledVector(acc, dt);
      // Clamp speed range.
      const sp = a.vel.length();
      if (sp > this.maxSpeed) a.vel.multiplyScalar(this.maxSpeed / sp);
      else if (sp < this.minSpeed && sp > 0.001) a.vel.multiplyScalar(this.minSpeed / sp);
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);

      // Face direction of travel.
      const yaw = Math.atan2(a.vel.x, a.vel.z);
      a.mesh.rotation.y = yaw;
      const pitch = Math.atan2(-a.vel.y, Math.hypot(a.vel.x, a.vel.z));
      a.mesh.rotation.x = pitch * 0.4;

      // Wing flap rate scales with speed.
      a.flapPhase += dt * (8 + sp * 0.6);
      const flap = Math.sin(a.flapPhase) * 0.55;
      const wingL = a.mesh.children[0];
      const wingR = a.mesh.children[1];
      if (wingL) wingL.rotation.z = -0.25 + flap;
      if (wingR) wingR.rotation.z = 0.25 - flap;
    }
  }

  private makeBird(): THREE.Group {
    const g = new THREE.Group();
    const wingGeoL = new THREE.BufferGeometry();
    wingGeoL.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -0.85, 0, -0.18, -0.55, 0, 0.25], 3));
    const wingGeoR = new THREE.BufferGeometry();
    wingGeoR.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.85, 0, -0.18, 0.55, 0, 0.25], 3));
    const wingL = new THREE.Mesh(wingGeoL, this.mat);
    const wingR = new THREE.Mesh(wingGeoR, this.mat);
    g.add(wingL); g.add(wingR);
    // Tiny body so they have presence at distance.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.32),
      this.mat,
    );
    g.add(body);
    return g;
  }
}

// — Goat AI: pick a target, walk toward it, flee from truck. Prop bodies
// already exist; this just adds gentle horizontal force per frame.
export interface GoatBrain {
  prop: Prop;
  target: THREE.Vector3;
  retargetTimer: number;
  fleeing: boolean;
}

export function createGoatBrain(prop: Prop): GoatBrain {
  const target = new THREE.Vector3(prop.body.position.x, 0, prop.body.position.z);
  return { prop, target, retargetTimer: 1 + Math.random() * 3, fleeing: false };
}

export function updateGoatBrains(
  brains: GoatBrain[],
  truckPos: THREE.Vector3,
  dt: number,
  sampleH: (x: number, z: number) => number,
) {
  for (const brain of brains) {
    const body = brain.prop.body;
    if (brain.prop.kind !== "goat") continue;

    // Distance to truck.
    const dxT = body.position.x - truckPos.x;
    const dzT = body.position.z - truckPos.z;
    const distT = Math.hypot(dxT, dzT);
    brain.fleeing = distT < 9;

    // Cap angular velocity so collision impulses don't spin them like tops.
    const av = body.angularVelocity;
    const angSpeed = Math.hypot(av.x, av.y, av.z);
    const angCap = 6;
    if (angSpeed > angCap) {
      body.angularVelocity.scale(angCap / angSpeed, body.angularVelocity);
    }

    if (brain.fleeing) {
      // Flee away from truck. Force capped + applied at center of mass
      // to minimize torque (no spin). Inverse-square boosted force when
      // very close so they don't get run over.
      const inv = 1 / Math.max(2.0, distT);
      const mag = Math.min(140, 70 * inv * 5); // cap so they can't rocket
      const fx = (dxT / Math.max(0.5, distT)) * mag;
      const fz = (dzT / Math.max(0.5, distT)) * mag;
      body.applyForce(new CANNON.Vec3(fx, 0, fz), new CANNON.Vec3(body.position.x, body.position.y, body.position.z));
      brain.retargetTimer = 0.5;
    } else {
      brain.retargetTimer -= dt;
      if (brain.retargetTimer <= 0) {
        // Pick a new target within ~12m radius.
        const angle = Math.random() * Math.PI * 2;
        const dist = 4 + Math.random() * 8;
        brain.target.set(
          body.position.x + Math.cos(angle) * dist,
          0,
          body.position.z + Math.sin(angle) * dist,
        );
        brain.target.y = sampleH(brain.target.x, brain.target.z);
        brain.retargetTimer = 4 + Math.random() * 6;
      }
      // Gentle nudge toward target.
      const dx = brain.target.x - body.position.x;
      const dz = brain.target.z - body.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        const inv = 1 / d;
        body.applyForce(
          new CANNON.Vec3(dx * inv * 14, 0, dz * inv * 14),
          body.position,
        );
      }
    }
  }
}

// — Atmospheric dust: sparse low-alpha haze particles drifting slowly across
// the world. Creates "dawn corridor" feel without a heavy weather system.
export class DustHaze {
  mesh: THREE.InstancedMesh;
  private particles: { x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; rot: number }[] = [];
  private dummy = new THREE.Object3D();
  private bounds: number;

  constructor(scene: THREE.Scene, bounds: number, count = 90) {
    this.bounds = bounds;
    const geo = new THREE.PlaneGeometry(2.0, 2.0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc8b89a,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * bounds,
        y: 1 + Math.random() * 14,
        z: (Math.random() - 0.5) * bounds,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.3) * 0.15,
        vz: (Math.random() - 0.5) * 0.6,
        size: 1.5 + Math.random() * 3.5,
        rot: Math.random() * Math.PI * 2,
      });
    }
    scene.add(this.mesh);
  }

  update(dt: number, camera: THREE.Camera) {
    const half = this.bounds / 2;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += dt * 0.05;
      // Wrap around the world.
      if (p.x > half) p.x = -half;
      else if (p.x < -half) p.x = half;
      if (p.z > half) p.z = -half;
      else if (p.z < -half) p.z = half;
      if (p.y > 18) p.y = 1;
      else if (p.y < 0.5) p.y = 14;

      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.lookAt(camera.position);
      this.dummy.rotation.z = p.rot;
      this.dummy.scale.setScalar(p.size);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// — Horn: brief synthesized blast through an AM-character bandpass.
// Plays through the supplied audio destination so it shares the radio's
// "old vehicle" tonal character.
export function honk(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(220, t);
  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(330, t);
  osc2.detune.value = -8;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1100;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.32, t + 0.02);
  env.gain.setValueAtTime(0.32, t + 0.32);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(env).connect(dest);
  osc1.start(t); osc2.start(t);
  osc1.stop(t + 0.6); osc2.stop(t + 0.6);
}
