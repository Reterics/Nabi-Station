// Strip Meshy "withSkin" clip GLBs down to skeleton + animation.
//
// Meshy returns every animation as a full copy of the character (mesh + 2K texture),
// so a 30 KB clip ships as a ~3.5 MB file. The mesh and texture live in rigged.glb;
// clips only need the skin (so Blender rebuilds the armature) and the animation.
//
// Usage: node tools/assets/strip-clips.mjs <file.glb> [...]   (rewrites in place)
//        node tools/assets/strip-clips.mjs --out <dir> <file.glb> [...]
import { basename, join } from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
if (args.length === 0) {
  console.error('usage: strip-clips.mjs [--out <dir>] <file.glb> [...]');
  process.exit(1);
}

const io = new NodeIO();

for (const file of args) {
  const doc = await io.read(file);
  const root = doc.getRoot();

  let meshNodes = 0;
  for (const node of root.listNodes()) {
    if (node.getMesh()) {
      node.setMesh(null);
      meshNodes++;
    }
  }
  for (const mesh of root.listMeshes()) {
    // Disposing a mesh leaves its primitives alive, and they keep the vertex
    // accessors and material (and so the texture) referenced through prune().
    for (const primitive of mesh.listPrimitives()) primitive.dispose();
    mesh.dispose();
  }

  // Keep skins and leaf joints (e.g. head_end): Blender only builds an armature from a skin.
  await doc.transform(
    prune({
      keepLeaves: true,
      propertyTypes: [
        PropertyType.MESH,
        PropertyType.MATERIAL,
        PropertyType.TEXTURE,
        PropertyType.ACCESSOR,
        PropertyType.BUFFER,
      ],
    }),
  );

  const target = outDir ? join(outDir, basename(file)) : file;
  await io.write(target, doc);
  const animations = root.listAnimations().map((a) => a.getName());
  console.log(`${target}: removed ${meshNodes} mesh node(s); skins=${root.listSkins().length}; animations=${animations.join(',')}`);
}
