// Scenery — landmark-scale objects placed by hand. Sable's "islands of content"
// principle: density at named locations (canyon, hut, wreck, stream, village,
// border crossing); breathing room between them.

import * as THREE from "three";

// — Limestone slab outcrop. Angular tectonic plate jutting from the ground.
// Built from a few low-poly extruded shapes for the chunky character of
// monocline limestone walls. Cream-grey, slightly weathered.
export function buildLimestoneSlab(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x9c907a, roughness: 1.0, flatShading: true });
  const stoneShadow = new THREE.MeshStandardMaterial({ color: 0x6e6657, roughness: 1.0, flatShading: true });

  // Main angular slab — extruded triangle for monocline character.
  const shape = new THREE.Shape();
  const w = 3.5 * scale, h = 4.2 * scale;
  shape.moveTo(-w, 0);
  shape.lineTo(w * 0.9, 0);
  shape.lineTo(w * 0.4, h);
  shape.lineTo(-w * 0.7, h * 0.85);
  shape.closePath();
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.6 * scale, bevelEnabled: false });
  slabGeo.computeVertexNormals();
  const slab = new THREE.Mesh(slabGeo, stone);
  slab.castShadow = true; slab.receiveShadow = true;
  g.add(slab);

  // Smaller leaning shoulder slab.
  const sg2 = new THREE.Shape();
  sg2.moveTo(-1.2 * scale, 0);
  sg2.lineTo(1.5 * scale, 0);
  sg2.lineTo(0.8 * scale, 2.6 * scale);
  sg2.lineTo(-0.9 * scale, 2.0 * scale);
  sg2.closePath();
  const slab2 = new THREE.Mesh(new THREE.ExtrudeGeometry(sg2, { depth: 1.0 * scale, bevelEnabled: false }), stoneShadow);
  slab2.position.set(w * 0.6, 0, -1.0 * scale);
  slab2.rotation.y = -0.4;
  slab2.castShadow = true;
  g.add(slab2);

  // A rubble pile at the base — talus of fallen pieces.
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x7a715f, roughness: 1.0, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const r = (0.25 + Math.random() * 0.4) * scale;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rubbleMat);
    rock.position.set(
      (Math.random() - 0.5) * w * 1.4,
      r * 0.5,
      (0.6 + Math.random() * 1.0) * scale,
    );
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.castShadow = true;
    g.add(rock);
  }
  return g;
}

// — Persian oak (Quercus brantii). Low, gnarled, spreading. Different from
// the cypress — wider crown, shorter trunk, oak has presence as a landmark.
export function buildPersianOak(): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.95 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x4d5036, roughness: 1.0, flatShading: true });

  // Trunk: short, thick, slightly leaning.
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.4, 7), trunkMat);
  trunk.position.y = 0.7;
  trunk.rotation.z = (Math.random() - 0.5) * 0.2;
  trunk.castShadow = true;
  g.add(trunk);

  // Crown: 3-4 overlapping low-poly spheres for the spreading shape.
  const blobs = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < blobs; i++) {
    const r = 1.0 + Math.random() * 0.6;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), foliageMat);
    blob.position.set(
      (Math.random() - 0.5) * 1.4,
      1.6 + Math.random() * 0.5,
      (Math.random() - 0.5) * 1.4,
    );
    blob.scale.y = 0.7;
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

// — Dry-stone wall ruin. Terraced agriculture remnant — long stretch of
// loosely stacked stones, partial collapse along the length.
export function buildStoneWall(lengthM = 8): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x756a58, roughness: 1.0, flatShading: true });
  const stones = Math.floor(lengthM * 4);
  for (let i = 0; i < stones; i++) {
    const x = (i / stones) * lengthM - lengthM / 2;
    // Wall is shorter in some spots — partial collapse.
    const collapse = Math.sin(i * 0.4) * 0.3 + (Math.random() - 0.5) * 0.4;
    const stackHeight = Math.max(1, Math.floor(2 + collapse * 2));
    for (let h = 0; h < stackHeight; h++) {
      const w = 0.25 + Math.random() * 0.15;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.8, w * 0.9), stoneMat);
      stone.position.set(
        x + (Math.random() - 0.5) * 0.05,
        h * w * 0.85 + w * 0.4,
        (Math.random() - 0.5) * 0.1,
      );
      stone.rotation.y = (Math.random() - 0.5) * 0.4;
      stone.castShadow = true;
      g.add(stone);
    }
  }
  return g;
}

// — Stream/river crossing. Water plane with cobble approach on each side.
// Crosses E-W at a fixed z.
export function buildStream(width = 14, depth = 0.15): THREE.Group {
  const g = new THREE.Group();
  // Water plane.
  const waterGeo = new THREE.PlaneGeometry(width, 5);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x445862,
    roughness: 0.3,
    metalness: 0.4,
    transparent: true,
    opacity: 0.85,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -depth;
  g.add(water);

  // Cobbled banks — a few rocks on each side.
  const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x6f6759, roughness: 1.0, flatShading: true });
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 12; i++) {
      const r = 0.18 + Math.random() * 0.22;
      const cobble = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), cobbleMat);
      cobble.position.set(
        (Math.random() - 0.5) * width * 0.95,
        r * 0.4,
        side * (2.2 + Math.random() * 0.8),
      );
      cobble.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      cobble.castShadow = true;
      g.add(cobble);
    }
  }
  return g;
}

// — Distant village. Cluster of small flat-roofed stone/mud houses on a hillside.
// Kept low-poly + low-detail because it's silhouette-only at viewing distance.
export function buildVillage(): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7d68, roughness: 1.0 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4f3e, roughness: 1.0 });

  // 10 houses irregularly placed.
  const positions: [number, number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const x = (Math.random() - 0.5) * 22;
    const z = (Math.random() - 0.5) * 14;
    const w = 1.6 + Math.random() * 1.4;
    const d = 1.4 + Math.random() * 1.2;
    positions.push([x, z, w, d]);
  }

  for (const [x, z, w, d] of positions) {
    const h = 1.6 + Math.random() * 0.8;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    walls.position.set(x, h / 2, z);
    walls.castShadow = true;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.18, d * 1.05), roofMat);
    roof.position.set(x, h + 0.06, z);
    g.add(roof);
  }
  return g;
}

// — Goat. Tiny, low-poly, static — a placed prop. Just enough silhouette.
export function buildGoat(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb0a890, roughness: 1.0 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 1.0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.85), bodyMat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.35), bodyMat);
  head.position.set(0, 0.7, 0.55); g.add(head);
  // Four legs.
  for (const [x, z] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.3], [0.18, -0.3]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), darkMat);
    leg.position.set(x, 0.22, z); g.add(leg);
  }
  // Horns.
  for (const sign of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.22, 5), darkMat);
    horn.position.set(sign * 0.1, 0.88, 0.55);
    horn.rotation.z = sign * 0.4;
    g.add(horn);
  }
  return g;
}

// — Power line pylon (low wooden type, period-correct for rural Iran/Iraq).
export function buildPylon(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 6), wood);
  post.position.y = 3.75; post.castShadow = true; g.add(post);
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), wood);
  crossbar.position.y = 7.0; crossbar.castShadow = true; g.add(crossbar);
  // Insulators.
  const insulMat = new THREE.MeshStandardMaterial({ color: 0xd4d4cc, roughness: 0.6 });
  for (const x of [-1.0, 0, 1.0]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), insulMat);
    ins.position.set(x, 7.18, 0); g.add(ins);
  }
  return g;
}

// — Power lines connecting two pylons. Drooping wires.
export function buildPowerLines(start: THREE.Vector3, end: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1814 });
  const offsets = [-1.0, 0, 1.0];
  for (const offset of offsets) {
    const points: THREE.Vector3[] = [];
    const segs = 24;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = start.x + (end.x - start.x) * t + offset;
      const y = start.y * (1 - t) + end.y * t - Math.sin(t * Math.PI) * 0.6; // sag
      const z = start.z + (end.z - start.z) * t;
      points.push(new THREE.Vector3(x, y, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    g.add(new THREE.Line(geo, wireMat));
  }
  return g;
}
