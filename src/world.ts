// World — terrain, sky, lighting, props.
// Terrain bakes a dirt track into the heightfield so the player has a route
// without UI hand-holding.

import * as THREE from "three";
import * as CANNON from "cannon-es";

export const TERRAIN_SIZE = 320;
export const TERRAIN_RES = 128;
export const BORDER_Z = 60;

// — Authored terrain. North ridge, valley E-W, dirt track curving through.
// Returns [heights, isTrack] — a parallel grid telling the mesh shader which
// vertices are "on the road" so we can shade them sandy instead of scrub.
export function buildHeights(): { heights: number[][]; isTrack: boolean[][] } {
  const heights: number[][] = [];
  const isTrack: boolean[][] = [];

  // Track centerline: a sine curve in x as a function of z. Player drives +z.
  const trackX = (zNorm: number) => Math.sin(zNorm * 2.4) * 12 + Math.sin(zNorm * 5.7) * 3;

  // Track elevation: rolling-hill rhythm + one authored ramp for the launch moment.
  // The ramp is a steep crest at z ≈ 5 (just before the border) — it's the indie-game
  // "moment" beat where you can catch air if you hit it fast.
  const trackY = (z: number) => {
    let h =
      Math.sin(z * 0.26) * 3.2 +
      Math.sin(z * 0.41 + 0.7) * 1.4 +
      Math.cos(z * 0.13) * 0.8 +
      Math.max(0, z + 80) * 0.04;
    // Ramp: localized bump centered at z=5, ~10m wide, ~3m peak. Asymmetric — steeper
    // on the approach (-z side), shallower on the descent so you actually launch.
    const rampDist = z - 5;
    if (rampDist > -8 && rampDist < 6) {
      const t = rampDist < 0 ? (rampDist + 8) / 8 : 1 - rampDist / 6;
      h += Math.max(0, t) * 3.0;
    }
    return h;
  };

  // Canyon walls flank the road in a midroute section (z = -20..10).
  // Outside the track-influence band, terrain rises sharply nearby — limestone walls.
  const canyonWallHeight = (x: number, z: number) => {
    if (z < -25 || z > 12) return 0;
    const tx = trackX(z / TERRAIN_SIZE);
    const dist = Math.abs(x - tx);
    // Wall band: 8m..16m from centerline.
    if (dist < 8 || dist > 16) return 0;
    const wallFactor = Math.min(1, (dist - 8) / 5) * Math.min(1, (16 - dist) / 4);
    // Taper at canyon entrance/exit.
    const lengthFactor = Math.min(1, (z + 25) / 6) * Math.min(1, (12 - z) / 6);
    return wallFactor * lengthFactor * 9; // up to 9m walls
  };

  for (let i = 0; i < TERRAIN_RES; i++) {
    heights[i] = [];
    isTrack[i] = [];
    for (let j = 0; j < TERRAIN_RES; j++) {
      const x = (i / (TERRAIN_RES - 1) - 0.5) * TERRAIN_SIZE;
      const z = (j / (TERRAIN_RES - 1) - 0.5) * TERRAIN_SIZE;
      const zNorm = z / TERRAIN_SIZE;

      // Multi-octave terrain. Zagros has dramatic vertical articulation —
      // limestone walls, deep valleys, peaks. Big amplitudes on long
      // wavelengths drive the silhouette; mid + fine noise add texture.
      // North side rises sharply to high snow-capped ridge.
      const zNormPos = Math.max(0, z / TERRAIN_SIZE);
      // Quadratic ramp toward the north so the mountains feel like *mountains*.
      const ridge = zNormPos * zNormPos * 60 + zNormPos * 8;
      // Big folded ridges (limestone monoclines).
      const bigFold = Math.sin(x * 0.013 + z * 0.005) * 5.5
                    + Math.cos(z * 0.018 - x * 0.003) * 4.0;
      const longRidge = Math.sin(x * 0.034) * 2.4 + Math.cos(z * 0.041) * 1.8;
      const midNoise =
        Math.sin(x * 0.07) * 1.1 +
        Math.cos(z * 0.08) * 0.9 +
        Math.sin((x + z) * 0.11) * 0.6;
      const fineNoise =
        Math.sin(x * 0.21) * 0.25 +
        Math.cos(z * 0.27) * 0.2 +
        Math.sin((x - z) * 0.33) * 0.15;
      // Far peaks: extra rise on the deep north quarter.
      const farPeaks = Math.max(0, (z - TERRAIN_SIZE * 0.25) / TERRAIN_SIZE) * 18
                     * (0.6 + 0.4 * Math.sin(x * 0.025 + z * 0.01));

      let h = ridge + bigFold + longRidge + midNoise + fineNoise + farPeaks;
      h += canyonWallHeight(x, z);

      const tx = trackX(zNorm);
      const distToTrack = Math.abs(x - tx);
      const onTrack = distToTrack < 4.0;
      const inTrackInfluence = distToTrack < 9.0;

      if (inTrackInfluence) {
        const t = Math.max(0, Math.min(1, 1 - distToTrack / 9));
        const targetH = trackY(z);
        h = h * (1 - t * 0.92) + targetH * (t * 0.92);
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

  // Palette tuned to Zagros geology. Limestone where slope is steep (canyon walls,
  // ridges); sand in low pockets; scrub-olive on the broad mid-elevations; dirt on
  // the graded track; rut darkest on centerline.
  const limestone = new THREE.Color(0x9c907a);
  const limestoneShadow = new THREE.Color(0x6e6657);
  const sand = new THREE.Color(0xb8a075);
  const scrub = new THREE.Color(0x6e6555);
  const scrubDry = new THREE.Color(0x837048);
  const dirt = new THREE.Color(0xa68a5b);
  const rut = new THREE.Color(0x6b5436);
  // Snow palette for high-altitude peaks. White at the top, partial dusting in transition.
  const snow = new THREE.Color(0xeae6e0);
  const snowDirty = new THREE.Color(0xb6b0a4);

  const trackXAt = (z: number) => {
    const zNorm = z / TERRAIN_SIZE;
    return Math.sin(zNorm * 2.4) * 12 + Math.sin(zNorm * 5.7) * 3;
  };

  // Compute slope at (i,j) by sampling neighbors.
  const slopeAt = (i: number, j: number): number => {
    const left = heights[Math.max(0, i - 1)][j];
    const right = heights[Math.min(res - 1, i + 1)][j];
    const down = heights[i][Math.max(0, j - 1)];
    const up = heights[i][Math.min(res - 1, j + 1)];
    const elementSize = TERRAIN_SIZE / (res - 1);
    const dx = (right - left) / (2 * elementSize);
    const dz = (up - down) / (2 * elementSize);
    return Math.hypot(dx, dz);
  };

  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const idx = j * res + i;
      const jFlipped = res - 1 - j;
      const h = heights[i][jFlipped];
      pos.setY(idx, h);

      // Art-of-Rally / Over-the-Hill style: bold color blocking, no smooth
      // gradients, hard transitions between zones. Fewer tones, stronger reads.
      let c: THREE.Color;
      if (isTrack[i][jFlipped]) {
        const x = (i / (res - 1) - 0.5) * TERRAIN_SIZE;
        const z = ((res - 1 - jFlipped) / (res - 1) - 0.5) * TERRAIN_SIZE;
        const dist = Math.abs(x - trackXAt(z));
        c = dist < 1.4 ? rut : dirt;
      } else {
        const slope = slopeAt(i, jFlipped);
        // Hard zone selection — pick ONE color per band, no blending.
        if (h >= 24 && slope < 1.6) {
          c = snow;             // alpine snow cap
        } else if (h >= 18 && slope < 1.4) {
          c = snowDirty;        // patchy snow line
        } else if (slope > 1.6) {
          c = limestoneShadow;  // steep cliff face
        } else if (slope > 0.9) {
          c = limestone;        // sloped limestone outcrop
        } else if (h < -0.4) {
          c = sand;             // low pocket
        } else if (h > 8) {
          c = scrubDry;         // high scrub
        } else {
          c = scrub;             // baseline scrub steppe
        }
      }
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

// — Sun disk: a faint warm circle low on the +z horizon. Soft outer halo.
// Reads as the sun not yet over the ridge — supports the dawn register.
export function buildSunDisk(): THREE.Group {
  const g = new THREE.Group();
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xf2b988, transparent: true, opacity: 0.22, fog: false, depthWrite: false });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(8, 32), sunMat);
  g.add(sun);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(22, 32), haloMat);
  halo.position.z = -0.1;
  g.add(halo);
  // Outer fainter halo.
  const halo2Mat = new THREE.MeshBasicMaterial({ color: 0xd9a874, transparent: true, opacity: 0.08, fog: false, depthWrite: false });
  const halo2 = new THREE.Mesh(new THREE.CircleGeometry(48, 32), halo2Mat);
  halo2.position.z = -0.2;
  g.add(halo2);
  return g;
}

// — Sky gradient with a soft cloud band. Dawn light below the cloud line.
export function buildSkyGradient(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 512;
  const ctx = c.getContext("2d")!;
  // Base gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, "#2f3a48");
  grad.addColorStop(0.40, "#5a6470");
  grad.addColorStop(0.70, "#8b8c8e");
  grad.addColorStop(0.85, "#b09a82"); // warmer cloud underbelly catching dawn
  grad.addColorStop(1.00, "#9aa0a8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 512);
  // Cloud band: a slightly lighter horizontal stripe with feather.
  const band = ctx.createLinearGradient(0, 360, 0, 430);
  band.addColorStop(0.00, "rgba(202,196,184,0)");
  band.addColorStop(0.50, "rgba(214,206,192,0.55)");
  band.addColorStop(1.00, "rgba(202,196,184,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 360, 2, 70);
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

// — Layered distant ridges. Three ridges at different distances for parallax depth.
// Closer ridges are warmer + more articulated, farther ones cooler + smoother.
export function buildDistantRidges(): THREE.Group {
  const g = new THREE.Group();
  const layers = [
    { dist: 200, color: 0x4d5562, height: 22, freqA: 0.08, freqB: 0.025, freqC: 0.011, ampA: 8, ampB: 12, ampC: 5, base: 18 },
    { dist: 280, color: 0x5d6470, height: 28, freqA: 0.05, freqB: 0.018, freqC: 0.008, ampA: 6, ampB: 14, ampC: 7, base: 22 },
    { dist: 360, color: 0x787e88, height: 36, freqA: 0.03, freqB: 0.012, freqC: 0.005, ampA: 4, ampB: 10, ampC: 9, base: 28 },
  ];
  for (const layer of layers) {
    const w = layer.dist * 3.0;
    const segments = 110;
    const geo = new THREE.PlaneGeometry(w, layer.height + 18, segments, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = (t - 0.5) * w;
      const h = layer.base
        + Math.sin(x * layer.freqA) * layer.ampA
        + Math.sin(x * layer.freqB + 0.5) * layer.ampB
        + Math.cos(x * layer.freqC) * layer.ampC;
      pos.setY(i, h);
      pos.setY(i + segments + 1, -10);
      pos.setX(i, x);
      pos.setX(i + segments + 1, x);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: layer.color, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = layer.dist;
    mesh.rotation.y = Math.PI;
    g.add(mesh);
  }
  return g;
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

// — Cairn (stones piled by passersby on mountain passes — Kurdish/Iranian custom).
export function buildCairn(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6b6155, roughness: 1.0, flatShading: true });
  const count = 6 + Math.floor(Math.random() * 4);
  let y = 0;
  for (let i = 0; i < count; i++) {
    const r = 0.32 - i * 0.03 + (Math.random() - 0.5) * 0.05;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMat);
    stone.position.set((Math.random() - 0.5) * 0.1, y + r * 0.7, (Math.random() - 0.5) * 0.1);
    stone.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    stone.castShadow = true;
    g.add(stone);
    y += r * 1.3;
  }
  return g;
}

// — Wrecked truck. A previous run that didn't make it. Tells a story.
export function buildWreck(): THREE.Group {
  const g = new THREE.Group();
  const rust = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.95, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f1814, roughness: 0.9 });
  // Tipped on its side. Body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 3.3), rust);
  body.position.y = 0.85;
  body.rotation.z = -Math.PI / 2.4; // half-tipped
  body.castShadow = true;
  g.add(body);
  // Cabin.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 1.8), rust);
  cabin.position.set(0.65, 1.55, -0.2);
  cabin.rotation.z = -Math.PI / 2.4;
  cabin.castShadow = true;
  g.add(cabin);
  // A wheel up in the air.
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.32, 14), dark);
  wheel.rotation.set(0, 0, Math.PI / 2);
  wheel.position.set(-0.5, 1.6, 1.0);
  g.add(wheel);
  return g;
}

// — Cypress (tall thin tree common in the region). Two cones stacked.
export function buildCypress(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 1.0 })
  );
  trunk.position.y = 0.3; trunk.castShadow = true; g.add(trunk);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2d3a26, roughness: 1.0, flatShading: true });
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.2, 6), foliageMat);
  lower.position.y = 1.7; lower.castShadow = true; g.add(lower);
  const upper = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.4, 6), foliageMat);
  upper.position.y = 3.0; upper.castShadow = true; g.add(upper);
  return g;
}

// — Memorial flag pole. Tall thin post with a colored cloth tied near the top.
// Marks dangerous spots / honors people lost on the route. Quiet detail.
export function buildFlagPole(color: number): THREE.Group {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), woodMat);
  post.position.y = 1.6; post.castShadow = true; g.add(post);
  // Cloth: a thin rectangle, drooping slightly via rotation.
  const clothMat = new THREE.MeshStandardMaterial({ color, roughness: 1.0, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.85), clothMat);
  cloth.position.set(0.3, 2.8, 0);
  cloth.rotation.set(0.05, Math.PI / 2, 0.18);
  cloth.castShadow = true;
  g.add(cloth);
  // Knot near the top of the post.
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), clothMat);
  knot.position.set(0, 3.05, 0);
  g.add(knot);
  return g;
}
