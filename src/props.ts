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

// — Goat body + mesh. Light + low damping → fly funny when hit.
export function spawnGoat(world: CANNON.World, scene: THREE.Scene, pos: THREE.Vector3): Prop {
  const halfExt = new CANNON.Vec3(0.3, 0.32, 0.5);
  const body = new CANNON.Body({ mass: 12, material: propMat });
  body.addShape(new CANNON.Box(halfExt));
  body.position.set(pos.x, pos.y + 0.6, pos.z);
  body.linearDamping = 0.25;
  body.angularDamping = 0.18;
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

// — Birds: simple flapping triangles that fly across the +z corridor.
export class BirdFlock {
  private birds: { mesh: THREE.Group; vx: number; vz: number; flapPhase: number; life: number }[] = [];
  private spawnTimer = 5 + Math.random() * 12;
  private scene: THREE.Scene;
  private bounds: number;

  constructor(scene: THREE.Scene, bounds: number) {
    this.scene = scene;
    this.bounds = bounds;
  }

  update(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.birds.length < 4) {
      this.spawnFlock();
      this.spawnTimer = 14 + Math.random() * 22;
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vz * dt;
      b.flapPhase += dt * 9;
      // Animate wings via the children's rotation.
      const wingL = b.mesh.children[0];
      const wingR = b.mesh.children[1];
      const flap = Math.sin(b.flapPhase) * 0.5;
      if (wingL) wingL.rotation.z = -0.3 + flap;
      if (wingR) wingR.rotation.z = 0.3 - flap;
      b.life -= dt;
      if (b.life <= 0 || Math.abs(b.mesh.position.x) > this.bounds || Math.abs(b.mesh.position.z) > this.bounds) {
        this.scene.remove(b.mesh);
        this.birds.splice(i, 1);
      }
    }
  }

  private spawnFlock() {
    const count = 1 + Math.floor(Math.random() * 3);
    const startX = (Math.random() < 0.5 ? -1 : 1) * this.bounds * 0.8;
    const startZ = -100 + Math.random() * 200;
    const dir = Math.sign(-startX); // fly across to the other side
    const speed = 7 + Math.random() * 5;
    const altitude = 28 + Math.random() * 12;
    for (let i = 0; i < count; i++) {
      const bird = this.makeBird();
      bird.position.set(startX + i * 2, altitude + (Math.random() - 0.5) * 3, startZ + i * 1.5);
      this.scene.add(bird);
      this.birds.push({
        mesh: bird,
        vx: dir * speed,
        vz: (Math.random() - 0.5) * 1.5,
        flapPhase: Math.random() * Math.PI * 2,
        life: 28 + Math.random() * 10,
      });
    }
  }

  private makeBird(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x202428, fog: true });
    // Wings: two triangles meeting at a center.
    const wingGeoL = new THREE.BufferGeometry();
    wingGeoL.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -0.7, 0, -0.1, -0.5, 0, 0.2], 3));
    const wingGeoR = new THREE.BufferGeometry();
    wingGeoR.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.7, 0, -0.1, 0.5, 0, 0.2], 3));
    const wingL = new THREE.Mesh(wingGeoL, mat);
    const wingR = new THREE.Mesh(wingGeoR, mat);
    g.add(wingL); g.add(wingR);
    return g;
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
