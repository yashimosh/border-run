// World — terrain, sky, lighting, props.
// Terrain bakes a dirt track into the heightfield so the player has a route
// without UI hand-holding.

import * as THREE from "three";
import * as CANNON from "cannon-es";

export const TERRAIN_SIZE = 300;
export const TERRAIN_RES = 96;
export const BORDER_Z = 50;

// — Authored terrain. North ridge, valley E-W, dirt track curving through.
// Returns [heights, isTrack] — a parallel grid telling the mesh shader which
// vertices are "on the road" so we can shade them sandy instead of scrub.
export function buildHeights(): { heights: number[][]; isTrack: boolean[][] } {
  const heights: number[][] = [];
  const isTrack: boolean[][] = [];

  // Track centerline: a sine curve in x as a function of z. Player drives +z.
  const trackX = (zNorm: number) => Math.sin(zNorm * 2.4) * 12 + Math.sin(zNorm * 5.7) * 3;

  for (let i = 0; i < TERRAIN_RES; i++) {
    heights[i] = [];
    isTrack[i] = [];
    for (let j = 0; j < TERRAIN_RES; j++) {
      const x = (i / (TERRAIN_RES - 1) - 0.5) * TERRAIN_SIZE;
      const z = (j / (TERRAIN_RES - 1) - 0.5) * TERRAIN_SIZE;
      const zNorm = z / TERRAIN_SIZE;

      const ridge = Math.max(0, z / TERRAIN_SIZE) * 18;
      const valley = -Math.exp(-Math.pow(z / 24, 2)) * 1.5;
      const noise =
        Math.sin(x * 0.04) * 0.6 +
        Math.cos(z * 0.05) * 0.5 +
        Math.sin((x + z) * 0.09) * 0.25 +
        Math.sin(x * 0.21) * 0.15;

      let h = ridge + valley + noise;

      const tx = trackX(zNorm);
      const distToTrack = Math.abs(x - tx);
      const onTrack = distToTrack < 4.0;
      const inTrackInfluence = distToTrack < 8.0;

      if (inTrackInfluence) {
        // Smooth blend: the closer to centerline, the flatter and lower (graded path).
        const t = Math.max(0, Math.min(1, 1 - distToTrack / 8));
        const targetH = ridge * 0.7 + valley * 0.5 - 0.25;
        h = h * (1 - t * 0.85) + targetH * (t * 0.85);
      }

      heights[i][j] = h;
      isTrack[i][j] = onTrack;
    }
  }
  return { heights, isTrack };
}

export function buildHeightfieldBody(heights: number[][]): CANNON.Body {
  const elementSize = TERRAIN_SIZE / (TERRAIN_RES - 1);
  const shape = new CANNON.Heightfield(heights, { elementSize });
  const body = new CANNON.Body({ mass: 0, material: new CANNON.Material({ friction: 0.7 }) });
  body.addShape(shape);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.position.set(-TERRAIN_SIZE / 2, 0, TERRAIN_SIZE / 2);
  return body;
}

export function buildTerrainMesh(heights: number[][], isTrack: boolean[][]): THREE.Mesh {
  const res = TERRAIN_RES;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const scrub = new THREE.Color(0x6e6555);
  const dirt = new THREE.Color(0xa68a5b);

  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const idx = j * res + i;
      // See worktree DECISIONS notes — flip j to align with rotated heightfield body.
      const jFlipped = res - 1 - j;
      pos.setY(idx, heights[i][jFlipped]);
      const c = isTrack[i][jFlipped] ? dirt : scrub;
      colors[idx * 3] = c.r;
      colors[idx * 3 + 1] = c.g;
      colors[idx * 3 + 2] = c.b;
    }
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
  });
  return new THREE.Mesh(geo, mat);
}

export function sampleHeight(x: number, z: number, heights: number[][]): number {
  const elementSize = TERRAIN_SIZE / (TERRAIN_RES - 1);
  const u = (x + TERRAIN_SIZE / 2) / elementSize;
  const v = (TERRAIN_SIZE / 2 - z) / elementSize;
  const i = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(u)));
  const j = Math.max(0, Math.min(TERRAIN_RES - 1, Math.floor(v)));
  return heights[i][j];
}

// — Sky gradient. Cool dust-blue at top, warmer at horizon.
export function buildSkyGradient(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#3a4452");
  grad.addColorStop(0.55, "#7d8492");
  grad.addColorStop(1.0, "#9aa0a8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// — Watchtower. Wood + tin, no light on.
export function buildWatchtower(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 });
  const tin = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.6, metalness: 0.4 });
  const legGeo = new THREE.BoxGeometry(0.18, 5.5, 0.18);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x * 1.0, 2.75, z * 1.0);
    leg.castShadow = true;
    g.add(leg);
  }
  const braceGeo = new THREE.BoxGeometry(2.6, 0.06, 0.06);
  for (let s = 0; s < 2; s++) {
    const z = s === 0 ? -1.05 : 1.05;
    const b1 = new THREE.Mesh(braceGeo, wood); b1.position.set(0, 1.6, z); b1.rotation.z = Math.PI / 5; g.add(b1);
    const b2 = new THREE.Mesh(braceGeo, wood); b2.position.set(0, 1.6, z); b2.rotation.z = -Math.PI / 5; g.add(b2);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), wood);
  platform.position.set(0, 5.5, 0);
  platform.castShadow = true; platform.receiveShadow = true;
  g.add(platform);
  const wallGeo = new THREE.BoxGeometry(2.4, 0.9, 0.1);
  const w1 = new THREE.Mesh(wallGeo, wood); w1.position.set(0, 6.05, -1.15); g.add(w1);
  const w2 = new THREE.Mesh(wallGeo, wood); w2.position.set(0, 6.05, 1.15); g.add(w2);
  const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 2.4), wood); w3.position.set(-1.15, 6.05, 0); g.add(w3);
  const w4 = w3.clone(); w4.position.x = 1.15; g.add(w4);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 2.7), tin);
  roof.position.set(0, 6.7, 0); roof.rotation.x = -0.06;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

// — Stone smuggler's hut. Crumbling, no door, low roof. Pre-existing structure.
export function buildHut(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6c635a, roughness: 1.0 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.4, 3.5), stone);
  walls.position.y = 1.2;
  walls.castShadow = true; walls.receiveShadow = true;
  g.add(walls);
  // Doorway gap (just a darker rectangle on one face).
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.7), new THREE.MeshBasicMaterial({ color: 0x0a0907, side: THREE.DoubleSide }));
  door.position.set(0, 0.85, 1.76);
  g.add(door);
  // Flat-ish roof (wooden beams + dirt).
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.25, 3.9), wood);
  roof.position.y = 2.55;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

// — Distant ridge silhouette on the +z horizon.
export function buildDistantRidge(): THREE.Mesh {
  const w = 800, segments = 100;
  const geo = new THREE.PlaneGeometry(w, 80, segments, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * w;
    const h = 18 + Math.sin(t * 22) * 8 + Math.sin(t * 7.3 + 1.2) * 12 + Math.cos(t * 3.1) * 5;
    pos.setY(i, h);
    pos.setY(i + segments + 1, -10);
    pos.setX(i, x);
    pos.setX(i + segments + 1, x);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x46505c, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI;
  return mesh;
}

// — Rocks: instanced low-poly forms scattered off the track.
export function buildRocks(heights: number[][], isTrack: boolean[][], count: number): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4f463c, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 8) {
    attempts++;
    const x = (Math.random() - 0.5) * (TERRAIN_SIZE - 20);
    const z = (Math.random() - 0.5) * (TERRAIN_SIZE - 20);
    const i = Math.floor((x + TERRAIN_SIZE / 2) / (TERRAIN_SIZE / (TERRAIN_RES - 1)));
    const j = Math.floor((TERRAIN_SIZE / 2 - z) / (TERRAIN_SIZE / (TERRAIN_RES - 1)));
    if (i < 0 || j < 0 || i >= TERRAIN_RES || j >= TERRAIN_RES) continue;
    if (isTrack[i][j]) continue; // never on the track
    const y = heights[i][j];
    const scale = 0.4 + Math.random() * 1.4;
    dummy.position.set(x, y - 0.1, z);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(scale, scale * 0.7, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  return mesh;
}

// — Scrub bushes: instanced cones, dark olive.
export function buildScrub(heights: number[][], isTrack: boolean[][], count: number): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(0.6, 1.0, 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d3a25, roughness: 1.0, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 8) {
    attempts++;
    const x = (Math.random() - 0.5) * (TERRAIN_SIZE - 10);
    const z = (Math.random() - 0.5) * (TERRAIN_SIZE - 10);
    const i = Math.floor((x + TERRAIN_SIZE / 2) / (TERRAIN_SIZE / (TERRAIN_RES - 1)));
    const j = Math.floor((TERRAIN_SIZE / 2 - z) / (TERRAIN_SIZE / (TERRAIN_RES - 1)));
    if (i < 0 || j < 0 || i >= TERRAIN_RES || j >= TERRAIN_RES) continue;
    if (isTrack[i][j]) continue;
    const y = heights[i][j];
    const scale = 0.6 + Math.random() * 0.8;
    dummy.position.set(x, y + 0.4 * scale, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.set(scale, scale * (0.7 + Math.random() * 0.6), scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  return mesh;
}

// — Border posts every 8m.
export function buildBorderPosts(): THREE.Group {
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 0.9 });
  for (let x = -TERRAIN_SIZE / 2; x <= TERRAIN_SIZE / 2; x += 8) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(x, 0.8, BORDER_Z);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

export function buildBorderLine(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-TERRAIN_SIZE / 2, 0.05, BORDER_Z),
    new THREE.Vector3(TERRAIN_SIZE / 2, 0.05, BORDER_Z),
  ]);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xc0392b, dashSize: 1.2, gapSize: 0.6 }));
  line.computeLineDistances();
  return line;
}
