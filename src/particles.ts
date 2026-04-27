// Particles — pooled instanced quads. Two systems: dust under wheels, exhaust
// from the tailpipe. Both update on a fixed-size pool, no allocs in the hot path.

import * as THREE from "three";

interface Particle {
  alive: boolean;
  age: number;
  life: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  scale: number;
  spin: number; rot: number;
}

export class ParticleSystem {
  mesh: THREE.InstancedMesh;
  private pool: Particle[];
  private dummy = new THREE.Object3D();
  private color: THREE.Color;
  private gravity: number;

  constructor(maxParticles: number, color: number, gravity: number) {
    const geo = new THREE.PlaneGeometry(0.7, 0.7);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxParticles);
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color(color);
    this.gravity = gravity;
    this.pool = [];
    for (let i = 0; i < maxParticles; i++) {
      this.pool.push({ alive: false, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, scale: 1, spin: 0, rot: 0 });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, scale: number) {
    for (const p of this.pool) {
      if (!p.alive) {
        p.alive = true; p.age = 0; p.life = life;
        p.x = x; p.y = y; p.z = z;
        p.vx = vx; p.vy = vy; p.vz = vz;
        p.scale = scale;
        p.spin = (Math.random() - 0.5) * 2;
        p.rot = Math.random() * Math.PI * 2;
        return;
      }
    }
  }

  update(dt: number, camera: THREE.Camera) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vy -= this.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const t = p.age / p.life;
      const grow = 1 + t * 1.5;
      const fade = 1 - t;
      this.dummy.position.set(p.x, p.y, p.z);
      // Always face camera.
      this.dummy.lookAt(camera.position);
      this.dummy.rotation.z = p.rot;
      this.dummy.scale.setScalar(p.scale * grow * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
