"""APEX PURSUIT car import, step 1: a 3D car model → two game-ready glTF files.

    blender -b <model.blend|.fbx|.obj> --python tools/car-import/convert.py -- <out_dir> --rules rules.json [--textures dir]

(.fbx / .obj are imported first; a .blend opens directly.)

What it does, driven by the rules file (see README.md next to this script):
  1. deletes parts nobody will see (engine internals, suspension arms...) and empty objects
  2. renames every material to one of the game's slots (ap_paint, ap_glass, ap_tyre, ...)
  3. finds the four wheels (tyre + rim + brake disc) and the callipers, and the steering wheel
  4. thins out the heaviest meshes (tyres and dashboards are often far denser than they need to be)
  5. joins everything into a few parts and re-centres the car:
       body, cabin, under, steer, wheel_FL/FR/RL/RR (spin), hub_FL/FR/RL/RR (steer only)
     glTF space: +Y up, the car faces +Z, left = +X, the tyres stand on y = 0, origin = mid-wheelbase
  6. writes lod0.glb (full detail), lod1.glb (far away: ~10 % of the triangles) and meta.json

Then run tools/car-import/pack.mjs to compress the files and add the car to a car pack.
"""
import bpy, bmesh, sys, os, re, json, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
RULES = json.load(open(argv[argv.index('--rules') + 1]))
TEX = argv[argv.index('--textures') + 1] if '--textures' in argv else os.path.dirname(bpy.data.filepath)
os.makedirs(OUT, exist_ok=True)

src = bpy.data.filepath
if not src:  # started with an .fbx / .obj path: Blender opened an empty scene, import the file
    path = sys.argv[sys.argv.index('-b') + 1] if '-b' in sys.argv else ''
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    elif path.lower().endswith('.obj'):
        bpy.ops.wm.obj_import(filepath=path)

def rx(key, default=None):
    v = RULES.get(key, default)
    return re.compile(v, re.I) if v else None

DROP = rx('drop')
CABIN = rx('cabin', r'(interior|seat|dash|steer|gauge|shifter|pedal)')
UNDER = rx('under', r'(underbody|undercarriage|exhaust$)')
STEER = rx('steer', r'(steering_?wheel|steer)')
WH = RULES.get('wheels', {})
TYRE, RIM, BRAKE = (re.compile(WH.get(k, d), re.I) for k, d in (('tyre', r'(tyre|tire)'), ('rim', r'(rim|wheel)'), ('brake', r'(brake|disc|rotor)')))

# ── 1. delete hidden parts ──────────────────────────────────────────────────
for o in list(bpy.data.objects):
    if o.type != 'MESH' or len(o.data.polygons) == 0 or (DROP and DROP.search(o.name)):
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.data.users > 1:
        o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)

# ── 2. material slots ───────────────────────────────────────────────────────
def is_cabin(name):
    return bool(CABIN and CABIN.search(name))

OBJ_SLOTS = [(re.compile(o, re.I), re.compile(m, re.I), s) for o, m, s in RULES.get('object_slots', [])]
SLOTS = []
for pat, slot in RULES.get('slots', []):
    cab = pat.startswith('cabin:')
    SLOTS.append((cab, re.compile(pat[6:] if cab else pat, re.I), slot))
if not SLOTS:
    SLOTS = [(False, re.compile(p, re.I), s) for p, s in [
        (r'(paint|body_?col|carpaint)', 'paint'), (r'(tyre|tire|rubber)', 'tyre'), (r'(rim|alloy)', 'rim'), (r'caliper', 'caliper'),
        (r'(disc|rotor|brake)', 'disc'), (r'(glass|window)', 'glass'), (r'(tail|brakelight|rear_?light)', 'tail'), (r'(head|lamp|light)', 'head'),
        (r'chrome', 'chrome'), (r'carbon', 'carbon'), (r'mirror', 'mirror'), (r'(grille|mesh)', 'grille')]] + \
        [(True, re.compile(r'.*'), 'int'), (False, re.compile(r'.*'), 'black')]

def slot_of(mat, obj):
    for o, m, s in OBJ_SLOTS:
        if o.search(obj) and m.search(mat):
            return s
    cab = is_cabin(obj)
    for c, m, s in SLOTS:
        if c and not cab:
            continue
        if m.search(mat):
            return s
    return 'black'

TEXMAP = RULES.get('textures', {})
MATS = {}
def ap_mat(slot):
    if slot in MATS:
        return MATS[slot]
    m = bpy.data.materials.new('ap_' + slot)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    # a colour of its own per slot, so compression tools never merge two slots into one material
    h = sum(ord(c) * (i + 7) for i, c in enumerate(slot))
    bsdf.inputs['Base Color'].default_value = ((h % 97) / 96, (h // 97 % 89) / 88, (h // 8633 % 83) / 82, 1)
    img = TEXMAP.get(slot)
    if img and os.path.exists(os.path.join(TEX, img)):
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.join(TEX, img))
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    MATS[slot] = m
    return m

for o in bpy.data.objects:
    names = [s.material.name if s.material else '' for s in o.material_slots] or ['']
    if not o.material_slots:
        o.data.materials.append(None)
    for i, n in enumerate(names):
        o.material_slots[i].link = 'DATA'
        o.data.materials[i] = ap_mat(slot_of(n, o.name))

# ── 3. wheels ───────────────────────────────────────────────────────────────
def bounds(o):
    xs = [v.co for v in o.data.vertices]
    mn = Vector((min(v.x for v in xs), min(v.y for v in xs), min(v.z for v in xs)))
    mx = Vector((max(v.x for v in xs), max(v.y for v in xs), max(v.z for v in xs)))
    return (mn + mx) / 2, mn, mx

tyres = [o for o in bpy.data.objects if TYRE.search(o.name)]
if len(tyres) != 4:
    sys.exit(f'expected 4 tyres matching {TYRE.pattern!r}, found {len(tyres)}: {[o.name for o in tyres]}')
GROUND = min(bounds(o)[1].z for o in tyres)
# the model's front: -Y (Blender's usual front view) unless the rules say "front": "+y"
FRONT = 1.0 if RULES.get('front', '-y') == '+y' else -1.0
def corner(c):
    front = (c.y < 0) == (FRONT < 0)
    left = (c.x > 0) == (FRONT < 0)
    return ('F' if front else 'R') + ('L' if left else 'R')

wheel_info, wheel_parts = {}, {}
for o in list(bpy.data.objects):
    if TYRE.search(o.name) or RIM.search(o.name) or BRAKE.search(o.name):
        wheel_parts.setdefault(corner(bounds(o)[0]), []).append(o)
if sorted(wheel_parts) != ['FL', 'FR', 'RL', 'RR']:
    sys.exit(f'could not sort the wheel parts into four corners: {sorted(wheel_parts)}')

def split_slots(o, keep):
    idx = [i for i, s in enumerate(o.material_slots) if s.material and s.material.name[3:] in keep]
    if not idx:
        return None
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm2 = bmesh.new(); bm2.from_mesh(o.data)
    for f in [f for f in bm.faces if f.material_index in idx]: bm.faces.remove(f)
    for f in [f for f in bm2.faces if f.material_index not in idx]: bm2.faces.remove(f)
    for b in (bm, bm2):
        bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
    me2 = o.data.copy(); bm2.to_mesh(me2); bm2.free()
    bm.to_mesh(o.data); bm.free()
    o2 = bpy.data.objects.new(o.name + '_cal', me2)
    bpy.context.scene.collection.objects.link(o2)
    return o2

for k, parts in list(wheel_parts.items()):
    tyre = [p for p in parts if TYRE.search(p.name)][0]
    c, mn, mx = bounds(tyre)
    wheel_info[k] = {'c': c, 'r': (mx.z - mn.z) / 2, 'w': mx.x - mn.x}
    cal = [x for x in (split_slots(p, {'caliper'}) for p in parts if BRAKE.search(p.name)) if x]
    wheel_parts[k] = (parts, cal)

# ── 4. thin out heavy meshes ────────────────────────────────────────────────
def decimate(o, ratio):
    if ratio >= 1 or not o:
        return
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_apply(modifier=mod.name)

for o in list(bpy.data.objects):
    for pat, r in RULES.get('decimate', []):
        if re.search(pat, o.name, re.I):
            decimate(o, r)
            break

# ── 5. group, join, re-centre ───────────────────────────────────────────────
used = {p.name for parts, cal in wheel_parts.values() for p in parts + cal}
groups = {'body': [], 'cabin': [], 'under': [], 'steer': []}
for o in bpy.data.objects:
    if o.name in used:
        continue
    if STEER and STEER.search(o.name): groups['steer'].append(o)
    elif is_cabin(o.name): groups['cabin'].append(o)
    elif UNDER and UNDER.search(o.name): groups['under'].append(o)
    else: groups['body'].append(o)

def join(objs, name):
    objs = [o for o in objs if o and o.name in bpy.data.objects]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name; j.data.name = name
    return j

final = {g: join(objs, g) for g, objs in groups.items()}
for k, (parts, cal) in wheel_parts.items():
    final['wheel_' + k] = join(parts, 'wheel_' + k)
    final['hub_' + k] = join(cal, 'hub_' + k)

mid_y = (wheel_info['FL']['c'].y + wheel_info['RL']['c'].y) / 2
# turn the car so it faces -Y in Blender (= +Z in glTF)
TURN = Matrix.Rotation(math.pi, 4, 'Z') if FRONT > 0 else Matrix.Identity(4)
SHIFT = Matrix.Translation(Vector((0, -mid_y, -GROUND)))
XF = TURN @ SHIFT

# steering wheel: centre and column axis (the direction its vertices spread least)
steer_info = None
if final['steer']:
    pts = [XF @ v.co for v in final['steer'].data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    mean = sum(pts, Vector()) / len(pts)
    C = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for p in pts:
        d = p - mean
        for i in range(3):
            for j in range(3):
                C[i][j] += d[i] * d[j]
    Ci = C.inverted()
    axis = Vector((0.0, -1.0, 0.3)).normalized()
    for _ in range(60):
        axis = (Ci @ axis).normalized()
    if axis.y > 0:
        axis = -axis  # point it forwards, down the column
    steer_info = {'c': (mn + mx) / 2, 'axis': axis}

for name, o in final.items():
    if not o:
        continue
    o.data.transform(XF)
    if name.startswith(('wheel_', 'hub_')):
        c = XF @ wheel_info[name[-2:]]['c']
    elif name == 'steer' and steer_info:
        c = steer_info['c']
    else:
        c = Vector((0, 0, 0))
    o.data.transform(Matrix.Translation(-c))
    o.location = c
    o.data.shade_smooth()
    if hasattr(o.data, 'use_auto_smooth'):
        o.data.use_auto_smooth = True
        o.data.auto_smooth_angle = math.radians(35)

def gl(v):  # Blender (x, y, z) → glTF (x, z, -y)
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]

def tris():
    return {n: sum(len(p.vertices) - 2 for p in o.data.polygons) for n, o in final.items() if o}

def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=False)

meta = {'wheels': {k: {'pos': gl(XF @ v['c']), 'radius': round(v['r'], 4), 'width': round(v['w'], 4)} for k, v in wheel_info.items()}}
if steer_info:
    meta['steer'] = {'pos': gl(steer_info['c']), 'axis': gl(steer_info['axis'])}
meta['tris_lod0'] = tris()
print('LOD0 triangles', sum(meta['tris_lod0'].values()), meta['tris_lod0'])
export(os.path.join(OUT, 'lod0.glb'))

# ── 6. LOD1 ─────────────────────────────────────────────────────────────────
for name in ['steer', 'under'] + ['hub_' + k for k in ('FL', 'FR', 'RL', 'RR')]:
    if final.get(name):
        bpy.data.objects.remove(final[name], do_unlink=True)
        final[name] = None
L1 = RULES.get('lod1', {})
for name, o in final.items():
    if o:
        decimate(o, L1.get('wheel', 0.12) if name.startswith('wheel_') else L1.get(name, 0.14))
meta['tris_lod1'] = tris()
print('LOD1 triangles', sum(meta['tris_lod1'].values()))
export(os.path.join(OUT, 'lod1.glb'))
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print('wrote', OUT)
