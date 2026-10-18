"""Assemble a Meshy-rigged character and its clip GLBs into one game-ready GLB.

Runs inside Blender (via Blender MCP, or headless:
`blender -b -P tools/blender/assemble_character.py -- <character_dir> <out_glb>`).

Expects <character_dir>/meshy/ to contain rigged.glb plus the clip files listed in
CLIPS. Works in a fresh scene so the user's open scene is left untouched.
"""
import os
import sys

import bpy

# (source file, action name inside that file or None for "the only action", exported clip name)
CLIPS = [
    ("clip_library.glb", "Idle", "idle"),
    ("clip_think.glb", None, "think"),
    ("clip_library.glb", "Wave_One_Hand", "wave"),
    ("clip_library.glb", "Headache_Relief", "failed"),
    ("clip_library.glb", "Cheer_with_One_Hand_Up", "celebrate"),
    ("clip_walk.glb", None, "walk"),
    ("clip_run.glb", None, "run"),
    ("clip_type.glb", None, "type"),
    ("clip_read.glb", None, "read"),
    ("clip_operate.glb", None, "operate"),
]
TARGET_HEIGHT = 1.0  # world units; the city uses 1 unit = 1 tile edge
MAX_TEXTURE = 1024
HELPER_PREFIXES = ("Icosphere",)  # Meshy bone-display helpers, never exported


def import_glb(path):
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objects = [o for o in bpy.data.objects if o not in before_objects]
    new_actions = [a for a in bpy.data.actions if a not in before_actions]
    return new_objects, new_actions


def remove_objects(objects):
    for obj in objects:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)


def world_z_bounds(mesh_obj):
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh_obj.evaluated_get(deps)
    zs = [(evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices]
    return min(zs), max(zs)


def assemble(character_dir, out_glb):
    src = os.path.join(character_dir, "meshy")
    name = os.path.basename(os.path.normpath(character_dir))

    previous_scene = bpy.context.window.scene
    scene_name = f"assemble_{name}"
    if scene_name in bpy.data.scenes:
        old = bpy.data.scenes[scene_name]
        remove_objects(list(old.objects))
        bpy.data.scenes.remove(old)
    # Clip actions carry a fake user, so a previous run's copies outlive their scene.
    for _, _, clip_name in CLIPS:
        for action in [a for a in bpy.data.actions if a.name.split(".")[0] == clip_name]:
            bpy.data.actions.remove(action)
    scene = bpy.data.scenes.new(scene_name)
    bpy.context.window.scene = scene

    objects, rest_actions = import_glb(os.path.join(src, "rigged.glb"))
    helpers = [o for o in objects if o.name.startswith(HELPER_PREFIXES)]
    armature = next(o for o in objects if o.type == "ARMATURE")
    meshes = [o for o in objects if o.type == "MESH" and o not in helpers]
    remove_objects(helpers)
    for action in rest_actions:
        bpy.data.actions.remove(action)

    clip_cache = {}
    actions = []
    for filename, source_action, clip_name in CLIPS:
        if filename not in clip_cache:
            clip_objects, clip_actions = import_glb(os.path.join(src, filename))
            remove_objects(clip_objects)
            clip_cache[filename] = clip_actions
        candidates = clip_cache[filename]
        if source_action is None:
            if len(candidates) != 1:
                raise RuntimeError(f"{filename}: expected one action, got {[a.name for a in candidates]}")
            action = candidates[0]
        else:
            action = next(a for a in candidates if a.name == source_action)
        action.name = clip_name
        action.use_fake_user = True
        actions.append(action)

    anim = armature.animation_data or armature.animation_data_create()
    anim.action = None
    for track in list(anim.nla_tracks):
        anim.nla_tracks.remove(track)
    for action in actions:
        track = anim.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        if hasattr(strip, "action_slot") and getattr(action, "slots", None):
            strip.action_slot = action.slots[0]
        track.mute = False

    # Normalise: TARGET_HEIGHT tall, feet on the origin.
    zmin, zmax = world_z_bounds(meshes[0])
    factor = TARGET_HEIGHT / (zmax - zmin)
    armature.scale = [s * factor for s in armature.scale]
    bpy.context.view_layer.update()
    zmin, _ = world_z_bounds(meshes[0])
    armature.location.z -= zmin
    bpy.context.view_layer.update()

    armature.name = name
    for mesh in meshes:
        mesh.name = f"{name}_body"

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature

    # Downscale textures here: gltf-transform's sharp-based texture step is unreliable on Windows.
    for mesh in meshes:
        for slot in mesh.material_slots:
            if slot.material and slot.material.node_tree:
                for node in slot.material.node_tree.nodes:
                    image = getattr(node, "image", None)
                    if image and max(image.size) > MAX_TEXTURE:
                        image.scale(MAX_TEXTURE, MAX_TEXTURE)

    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(
        export_image_format="WEBP",
        export_image_quality=85,
        filepath=out_glb,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_apply=False,
    )
    # Write only this scene and its dependencies, not the imports' orphaned duplicates.
    bpy.data.libraries.write(os.path.join(character_dir, f"{name}.blend"), {scene}, compress=True)
    zmin, zmax = world_z_bounds(meshes[0])
    report = {
        "out": out_glb,
        "clips": [a.name for a in actions],
        "height": round(zmax - zmin, 4),
        "feet_z": round(zmin, 4),
        "tris": sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes),
    }

    # Leave the user's session as we found it.
    if previous_scene is not None:
        bpy.context.window.scene = previous_scene
    remove_objects(list(scene.objects))
    bpy.data.scenes.remove(scene)
    for action in actions:
        bpy.data.actions.remove(action)
    return report


if __name__ == "__main__" and "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    print(assemble(args[0], args[1]))
