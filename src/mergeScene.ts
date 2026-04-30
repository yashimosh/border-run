// mergeScene — batch-merge repeated static Groups into one Mesh per material.
//
// Why: every call to buildPersianOak() / buildJuniper() / buildBush() returns
// a Group with ~4-5 child Meshes. Placing 300 oaks = 1,500 draw calls for
// foliage alone. Chrome on Android pays IPC overhead per draw call through its
// GPU sandbox; Samsung Internet's Vulkan path doesn't. Merging reduces 1,500
// oak draw calls → 2 (trunk + foliage) regardless of tree count.
//
// Usage:
//   const groups: THREE.Group[] = [];
//   for (...) {
//     const g = buildPersianOak();
//     g.position.set(x, y, z);
//     g.rotation.y = r;
//     g.scale.setScalar(s);
//     groups.push(g);               // don't scene.add() yet
//   }
//   scene.add(mergeMeshGroups(groups, { castShadow: true }));
//
// The returned Group contains one Mesh per unique material found across all
// input groups. Each geometry has the world transform baked in (no live
// transforms on the merged meshes — they're static by definition).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface MergeOpts {
  castShadow?:    boolean; // default true
  receiveShadow?: boolean; // default false
}

/**
 * Merge all Mesh descendants of `groups` into as few Meshes as possible
 * (one per unique material). Groups are not added to the scene — their
 * transforms are baked into vertex positions instead.
 */
export function mergeMeshGroups(groups: THREE.Group[], opts: MergeOpts = {}): THREE.Group {
  const castShadow    = opts.castShadow    ?? true;
  const receiveShadow = opts.receiveShadow ?? false;

  // mat.uuid → { material, cloned geometries with world transform applied }
  const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();

  for (const group of groups) {
    // Force matrix world computation even though the group isn't in the scene.
    group.updateMatrixWorld(true);

    group.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.updateMatrixWorld(true);

      const mat: THREE.Material = Array.isArray(obj.material)
        ? obj.material[0]
        : obj.material;
      if (!mat) return;

      // Clone the geometry and bake the world matrix into vertex positions.
      const geo = obj.geometry.clone() as THREE.BufferGeometry;
      geo.applyMatrix4(obj.matrixWorld);

      if (!byMat.has(mat.uuid)) byMat.set(mat.uuid, { mat, geos: [] });
      byMat.get(mat.uuid)!.geos.push(geo);
    });
  }

  const out = new THREE.Group();

  for (const { mat, geos } of byMat.values()) {
    if (geos.length === 0) continue;

    const merged = mergeGeometries(geos, false);
    // Free the individual clones — we only need the merged result.
    geos.forEach(g => g.dispose());
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow    = castShadow;
    mesh.receiveShadow = receiveShadow;
    // Frustum culling on merged geometry needs a correct bounding sphere.
    merged.computeBoundingSphere();
    out.add(mesh);
  }

  return out;
}
