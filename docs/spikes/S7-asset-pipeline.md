# S7: Custom asset pipeline (first character)

Date: 2026-10-18 · Status: **pipeline proven end to end; in-engine check and licence review still open**

## What was done

One character (the Claude Code agent) went through the whole pipeline in about 10 minutes of wall-clock time:

1. **Higgsfield** (`gpt_image_2_5`, 16:9): 2 variants of a 4-view A-pose turnaround. Both were consistent across views; sheet A was selected.
2. **Crop**: the sheet was split automatically into front / ¾ / side / back squares by finding the white-background gaps between figures.
3. **Meshy multi-image-to-3d** (meshy-7.1, front+side+back, remesh 12k, 2k texture): a faithful mesh, 12.4k triangles. 30 credits, ~2 min.
4. **Meshy rig**: a 24-bone humanoid skeleton, with walk and run included. 5 credits, ~10 s.
5. **Meshy animate**: 5 library clips (idle, think, wave, failed, celebrate) in one call, 15 credits. Plus 3 `text_to_motion` prime clips (type, read, operate), 30 credits, retargeted for 9 credits.
6. **Blender MCP** with `tools/blender/assemble_character.py`: imports the rig and every clip, renames the actions, puts them on NLA tracks, normalises to 1.0 unit tall with feet at the origin, removes Meshy's `Icosphere` bone-shape helpers, downsizes the texture to 1024 WebP, and exports the GLB + a `.blend`. The script can be re-run safely.
7. **gltf-transform** meshopt: the final GLB is **664 KB** (budget ≤ 1.5 MB ✓), with 10 named clips.

Meshy total: **89 credits**. Higgsfield: 2 image generations.

## Findings

- Multi-view input from a single turnaround sheet gives good back and side reconstruction, because the views are already consistent.
- Walk and run are roughly in place, since the hip translation range is similar to idle. The city moves the character node along the path, so no root-motion extraction is needed.
- `type`, `read` and `operate` look alike without props. **Props (laptop, clipboard, hammer) should be separate meshes attached to the `RightHand`/`LeftHand` bones in Three.js**, and shown or hidden per state.
- `think` (Confused_Scratch) is 12 s long and spends a lot of it bent over. Consider a shorter custom `think` motion.
- gltf-transform's `textureCompress` (sharp/libvips) fails on this Windows machine with `colourspace: parameter space not set`. Texture downsizing and WebP conversion moved into the Blender export.
- `.blend` saves must use `bpy.data.libraries.write({scene})`. A full-file save pulled in ~45 MB of orphaned texture copies from the clip imports.
- Raw Meshy downloads (`src/characters/*/meshy/`, ~30 MB per character) are large binaries. Decide between Git LFS and keeping them outside git, given that the Meshy task ids in `MANIFEST.json` allow re-downloading for ~3 days only.

## Round 2: Codex and generic characters (same day)

- **Codex:** deep teal beanie with brass goggles, padded vest, satchel. **Generic:** yellow hard hat and grey overalls, kept mostly grey so it can be recoloured per session. Both reused the style key; the three silhouettes are distinct in a side-by-side render.
- Replaced the 12 s library `think` (Confused_Scratch) with a 4 s custom text-to-motion clip on all three characters.
- **Text-to-motion clips can be reused across rigs**, because Meshy's biped rigs share the same skeleton. Only the 3-credit retarget is paid per character.
- **Bug found and fixed:** Blender's glTF exporter includes every scene by default, so a second character's GLB picked up the first one's mesh. The script now passes `use_active_scene=True` and deletes its working scene afterwards.
- Final sizes: claude-code 640 KB, codex 653 KB, generic 588 KB. Each has 10 clips and one skinned mesh of ~12.3k triangles.
- Round-2 cost: 131 Meshy credits (two characters at 59 each, plus the new think motion and Claude's think retarget). The total so far is 220 credits and 6 Higgsfield images.
- Not done: a frame-by-frame visual check of each Codex and generic clip. The clip count and names were verified with `gltf-transform inspect`. The pipeline is identical to the Claude character, whose clips were checked visually.

## Source size cleanup

- Meshy returns every animation "with skin": each clip GLB repeats the full mesh + 2K texture (~3.5 MB) around 20–60 KB of animation. Per character, the 8 clip files plus a redundant `model.glb` and loose `model_base_color.png` came to 33–37 MB.
- `tools/assets/strip-clips.mjs` (gltf-transform) removes meshes and prunes, keeping the skin (Blender only rebuilds an armature from a skin) and the animations. `model.glb` and `model_base_color.png` were deleted, because `rigged.glb` holds the same mesh and texture.
- Result: each `meshy/` folder is 4.2–4.6 MB, about 13 MB for all three instead of about 104 MB. Rebuilding all three characters from the stripped sources gives identical output: 720/720 animation channels and every vertex match with a max abs diff of 0.
- Gotcha: `Mesh.dispose()` leaves its primitives alive, so `prune()` keeps the vertex data and material. Dispose the primitives first.

## Still open

- [ ] Load `dist/characters/claude-code.glb` in the R3F scene (needs `MeshoptDecoder`), and check the clips, cross-fades and readability at isometric 0.5× zoom.
- [ ] Review Higgsfield and Meshy terms for redistributing the generated output.
- [x] Repeat for Codex and generic characters with the same style key.
- [ ] Per-session tinting of `generic` in Three.js (hue-shift the grey overall regions via a mask or material override).
