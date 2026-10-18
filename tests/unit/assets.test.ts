import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  animationClips,
  characterKinds,
  clipForActivity,
} from '../../packages/protocol/src/index';

for (const kind of characterKinds) {
  it(`${kind} is a real GLB with every promised animation and a local Meshopt payload`, () => {
    const bytes = readFileSync(
      new URL(`../../assets/dist/characters/${kind}.glb`, import.meta.url),
    );
    expect(bytes.subarray(0, 4).toString()).toBe('glTF');
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const names = gltf.animations.map(
      (animation: { name: string }) => animation.name,
    );
    expect(names.toSorted()).toEqual([...animationClips].sort());
    for (const clip of Object.values(clipForActivity))
      expect(names).toContain(clip);
    expect(gltf.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(gltf.skins.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThan(1_500_000);
    for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])])
      expect(resource.uri).toBeUndefined();
  });
}
