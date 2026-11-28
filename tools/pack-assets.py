# 5C: turn the three Sketchfab packs into what the game bundles (run once; the results are committed).
#   python3 tools/pack-assets.py <snow_pine_dir> <sakura_dir> <sky_pano_dir>
# Each pack lands in assets/<name>/ with its license.txt: one .bin of geometry (positions, normals,
# uvs, indices per part, node transforms baked in, each tree standing at the origin, Y up) and its
# textures shrunk to WebP. assets/packs.json describes the parts.
import sys, json, struct, shutil, pathlib
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent / 'assets'

def mat(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'scale' in n: m = np.diag(list(n['scale']) + [1.0]) @ m
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        r = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        R = np.eye(4); R[:3, :3] = r; m = R @ m
    if 'translation' in n:
        T = np.eye(4); T[:3, 3] = n['translation']; m = T @ m
    return m

def load(d):
    g = json.load(open(d / 'scene.gltf'))
    buf = (d / g['buffers'][0]['uri']).read_bytes()
    def acc(i):
        a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
        comp = {5126: ('f4', 4), 5123: ('u2', 2), 5125: ('u4', 4)}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', comp[1] * n)
        raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + comp[1] * n, offset=off)
        out = np.lib.stride_tricks.as_strided(raw.view(np.uint8), shape=(a['count'], comp[1] * n), strides=(stride, 1)).copy()
        return out.view(comp[0]).reshape(a['count'], n)
    meshes = {}  # mesh index -> list of world-space parts
    def walk(ni, parent):
        n = g['nodes'][ni]; m = parent @ mat(n)
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                pos = acc(p['attributes']['POSITION']).astype(np.float64)
                nor = acc(p['attributes']['NORMAL']).astype(np.float64)
                uv = acc(p['attributes']['TEXCOORD_0']).astype(np.float32)
                idx = acc(p['indices']).reshape(-1).astype(np.uint32)
                P = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                N = nor @ np.linalg.inv(m[:3, :3])
                N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
                meshes.setdefault(g['meshes'][n['mesh']]['name'], []).append((P, N, uv, idx))
        for c in n.get('children', []): walk(c, m)
    for r in g['scenes'][g.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    return meshes

def merged(parts):
    P, N, U, I = [], [], [], []
    base = 0
    for p, n, u, i in parts:
        P.append(p); N.append(n); U.append(u); I.append(i + base); base += len(p)
    return np.vstack(P), np.vstack(N), np.vstack(U), np.concatenate(I)

class Pack:
    def __init__(self, name):
        self.name = name; self.blob = bytearray(); self.parts = {}
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    def add(self, key, P, N, U, I, origin, scale=1.0):
        P = (P - origin) * scale
        # the lathe-like trees are double sided in the source: keep as is (materials draw both sides)
        assert len(P) < 65536
        rec = {}
        for nm, arr, dt in (('pos', P, 'f4'), ('nor', N, 'f4'), ('uv', U, 'f4'), ('idx', I, 'u2')):
            while len(self.blob) % 4: self.blob.append(0)
            rec[nm] = [len(self.blob), int(arr.size)]
            self.blob += np.ascontiguousarray(arr, dtype=dt).tobytes()
        rec['min'] = [round(float(v), 4) for v in P.min(0)]
        rec['max'] = [round(float(v), 4) for v in P.max(0)]
        rec['tris'] = int(len(I) // 3)
        self.parts[key] = rec
        print(f'  {key}: {len(P)} verts, {len(I)//3} tris, size {np.round(P.max(0)-P.min(0),2)}')
    def save(self):
        (ROOT / self.name / f'{self.name}.bin').write_bytes(bytes(self.blob))
        return {'bin': f'{self.name}/{self.name}.bin', 'parts': self.parts}

def tex(src, dst, size, alpha=True, flip=False, q=82):
    im = Image.open(src)
    im = im.convert('RGBA' if alpha else 'RGB')
    if flip: im = im.transpose(Image.FLIP_TOP_BOTTOM)
    im = im.resize(size, Image.LANCZOS)
    im.save(dst, 'WEBP', quality=q, method=6)
    print(f'  {dst.name}: {size[0]}x{size[1]}, {dst.stat().st_size // 1024} kB')

def trunk_origin(P):
    # the base of the trunk: lowest point, centred on the lowest 10% of vertices
    y0 = P[:, 1].min(); low = P[P[:, 1] < y0 + (P[:, 1].max() - y0) * 0.1]
    return np.array([low[:, 0].mean(), y0, low[:, 2].mean()])

def main(pine, sakura, sky):
    out = {}
    # ── snow pine pack ──
    print('snow pine pack')
    m = load(pine); pk = Pack('snow-pine-pack')
    t1 = merged(m['SnowTree1_Trunk_0']); b1 = merged(m['SnowTree1_SnowBranchCircle_0'])
    o = trunk_origin(t1[0]); pk.add('spruceA_trunk', *t1, o); pk.add('spruceA_branch', *b1, o)
    t2 = merged(m['SnowTree2_Trunk_0']); b2 = merged(m['SnowTree2_SnowBranchCircle_0'])
    o = trunk_origin(t2[0]); pk.add('spruceB_trunk', *t2, o); pk.add('spruceB_branch', *b2, o)
    s = merged(m['SnowTree1.001_SnowBranchCircle_0']); o = trunk_origin(s[0]); pk.add('sapling_branch', *s, o)
    b = merged(m['BushBare1_treebaretall_0']); o = trunk_origin(b[0]); pk.add('bare', *b, o)
    out['pine'] = pk.save()
    d = ROOT / 'snow-pine-pack'
    shutil.copy(pine / 'license.txt', d / 'license.txt')
    tex(pine / 'textures/SnowBranchCircle_baseColor.png', d / 'branch.webp', (512, 512))
    tex(pine / 'textures/treebaretall_baseColor.png', d / 'bare.webp', (256, 512))
    tex(pine / 'textures/Trunk_normal.png', d / 'trunk-normal.webp', (512, 512), alpha=False, q=88)
    # ── sakura ──
    print('sakura tree')
    m = load(sakura); pk = Pack('sakura-tree')
    bark = merged(m['Sakura_Bark001_2K_JPG_Mat_0']); bloom = merged(m['Sakura_Sakura_Mat_0'])
    o = trunk_origin(bark[0]); h = max(bark[0][:, 1].max(), bloom[0][:, 1].max()) - o[1]
    pk.add('sakura_bark', *bark, o, 1 / h); pk.add('sakura_bloom', *bloom, o, 1 / h)
    out['sakura'] = pk.save()
    d = ROOT / 'sakura-tree'
    shutil.copy(sakura / 'license.txt', d / 'license.txt')
    tex(sakura / 'textures/Sakura_Mat_baseColor.png', d / 'bloom.webp', (512, 512))
    tex(sakura / 'textures/Bark001_2K_JPG_Mat_baseColor.png', d / 'bark.webp', (256, 512), alpha=False)
    # ── sky pano (the photo only; stored upside down on its sphere) ──
    print('sky pano')
    d = ROOT / 'sky-pano-winter-forest'; d.mkdir(parents=True, exist_ok=True)
    shutil.copy(sky / 'license.txt', d / 'license.txt')
    tex(sky / 'textures/lambert1_emissive.jpeg', d / 'pano.webp', (2048, 1024), alpha=False, flip=True, q=78)
    json.dump(out, open(ROOT / 'packs.json', 'w'), indent=1)

main(*[pathlib.Path(a) for a in sys.argv[1:4]])
