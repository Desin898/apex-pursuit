# Apex Pursuit intro trailer v2: cut from real in-game footage recorded frame by frame (rec.py).
import sys, math, subprocess, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

FPS = 30
DUR = 26.0
OW, OH = 1920, 1080
IW = 1920
IH = 911
TOP = (OH - IH) // 2
TEAL = (0x4F, 0xD1, 0xD9)
REC = '/tmp/trailer2/rec'
P = 4  # warm-up frames recorded before each shot

# (start, end, act, shot folder)
SHOTS = [
    (0.6, 2.6, 'dusk', 'dusk/d1', 5), (2.6, 4.6, 'dusk', 'dusk/d2', 5), (4.6, 6.0, 'dusk', 'dusk2/d3', 7),
    (6.0, 7.2, 'dusk', 'dusk2/d4', 5), (7.2, 8.2, 'dusk', 'dusk2/d5', 5), (8.2, 9.0, 'dusk', 'dusk/d6', 5),
    (9.0, 11.0, 'snow', 'snow2/s1', 5), (11.0, 12.4, 'snow', 'snow3/s2', 5), (12.4, 13.8, 'snow', 'snow/s3', 5), (13.8, 14.93, 'snow', 'snow2/s4', 5),
    (15.0, 16.4, 'storm', 'storm/r1', 5), (16.4, 17.6, 'storm', 'storm/r2', 5), (17.6, 19.0, 'storm', 'storm/r3', 5),
    (19.0, 21.0, 'storm', 'storm2/r4', 4), (21.0, 22.6, 'storm', 'storm/r5', 5),
]
SHARP = np.float32([[0, -0.25, 0], [-0.25, 2.0, -0.25], [0, -0.25, 0]])

def rec_frame(folder, i):
    d = os.path.join(REC, folder)
    n = len([f for f in os.listdir(d) if f.endswith('.jpg')])
    i = min(max(i, 0), n - 1)
    im = cv2.imread(os.path.join(d, f'{i:04d}.jpg'), cv2.IMREAD_COLOR)
    im = cv2.resize(im, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
    im = cv2.filter2D(im, -1, SHARP)
    return im[TOP:TOP + IH].astype(np.float32)

def last_frame(folder):
    d = os.path.join(REC, folder)
    return rec_frame(folder, len([f for f in os.listdir(d) if f.endswith('.jpg')]) - 1)

def grade(img, act, amt=0.6):
    return img * (1 - amt) + grade_full(img, act) * amt

def grade_full(img, act):
    # each weather keeps its own look; a gentle S-curve evens the contrast between shots
    if act == 'dusk':
        img = img * np.float32([0.93, 1.0, 1.06])  # BGR: warmer
    elif act == 'snow':
        img = img * np.float32([1.06, 1.01, 0.95])  # cooler, white-blue
    elif act == 'storm':
        g = img.mean(axis=2, keepdims=True)
        img = g + (img - g) * 0.72  # desaturate
        img = img * np.float32([1.07, 1.0, 0.92])  # steel blue
    x = np.clip(img / 255.0, 0, 1)
    x = x * 0.75 + (x * x * (3 - 2 * x)) * 0.25
    return np.clip(x * 255.0, 0, 255)

yy, xx = np.mgrid[0:IH, 0:IW].astype(np.float32)
VIG = (1 - 0.32 * (((xx - IW / 2) / (IW / 2)) ** 2 + ((yy - IH / 2) / (IH / 1.6)) ** 2)).clip(0.55, 1)[..., None]
rng = np.random.default_rng(7)

def shake_off(t, amp):
    if amp <= 0:
        return 0.0, 0.0
    return (amp * (math.sin(t * 47.0) * 0.6 + math.sin(t * 83.0 + 1.3) * 0.4) * 1.6,
            amp * (math.sin(t * 59.0 + 0.7) * 0.6 + math.sin(t * 101.0) * 0.4) * 1.6)

# ── text ──────────────────────────────────────────────────────────────────────
F_TAG = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 30)
F_TITLE = ImageFont.truetype('/usr/share/fonts/opentype/inter/InterDisplay-Black.otf', 150)
F_SUB = ImageFont.truetype('/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf', 40)
F_LINE = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 34)

def spaced(draw, xy, text, font, fill, spacing):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + spacing
    return x

def spaced_width(text, font, spacing):
    d = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    return sum(d.textlength(c, font=font) + spacing for c in text) - spacing

def word_layer(word):
    im = Image.new('RGBA', (OW, OH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x, y = 96, TOP + IH - 92
    d.rectangle([x, y + 6, x + 4, y + 34], fill=TEAL + (255,))
    spaced(d, (x + 18, y), word, F_TAG, (255, 255, 255, 255), 10)
    return np.asarray(im).astype(np.float32) / 255.0

TITLE_BG = cv2.GaussianBlur(last_frame('storm/r5'), (0, 0), 9) if os.path.isdir(os.path.join(REC, 'storm/r5')) else np.zeros((IH, IW, 3), np.float32)
WORDS = {w: word_layer(w) for w in ('DUSK', 'SNOW', 'STORM')}
WORD_T = [('DUSK', 2.9, 3.9), ('SNOW', 9.3, 10.3), ('STORM', 17.8, 18.8)]

def title_layers():
    out = {}
    for key in ('title', 'sub', 'line'):
        im = Image.new('RGBA', (OW, OH), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if key == 'title':
            w = spaced_width('APEX PURSUIT', F_TITLE, 14)
            spaced(d, ((OW - w) / 2, 380), 'APEX PURSUIT', F_TITLE, (255, 255, 255, 255), 14)
            d.rectangle([(OW - w) / 2, 575, (OW + w) / 2, 580], fill=TEAL + (255,))
        elif key == 'sub':
            w = spaced_width('HANAGIRI PASS', F_SUB, 16)
            spaced(d, ((OW - w) / 2, 612), 'HANAGIRI PASS', F_SUB, TEAL + (255,), 16)
        else:
            t = 'Three weathers. One pass.'
            w = d.textlength(t, font=F_LINE)
            d.text(((OW - w) / 2, 690), t, font=F_LINE, fill=(225, 228, 232, 255))
        out[key] = np.asarray(im).astype(np.float32) / 255.0
    return out

TL = title_layers()

def over(frame, layer, a):
    if a <= 0:
        return frame
    al = layer[..., 3:4] * a
    rgb = layer[..., 2::-1] * 255.0  # RGBA -> BGR
    return frame * (1 - al) + rgb * al

def smooth01(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

# ── frames ────────────────────────────────────────────────────────────────────
def frame_at(t):
    canvas = np.zeros((OH, OW, 3), np.float32)
    pic = None
    for (t0, t1, act, folder, off) in SHOTS:
        if t0 <= t < t1:
            fi = off + int(round((t - t0) * FPS))
            pic = grade(rec_frame(folder, fi), act)
            if folder.endswith('/s4'):
                # oncoming headlights bloom to white at the end of the snow
                b = smooth01((t - 14.3) / 0.6)
                if b > 0:
                    blur = cv2.GaussianBlur(pic, (0, 0), 18)
                    pic = pic + blur * b * 1.2 + 255 * b * b * 0.9
            if folder == 'storm/r4':
                f = 0.0
                for ft, fa in ((19.2, 0.45), (19.267, 0.15), (19.333, 0.35)):
                    if ft <= t < ft + 1 / FPS + 1e-6:
                        f = fa
                pic = pic * (1 + f * 0.6) + 255 * f * 0.3
            if folder == 'storm/r5':
                pic = pic * (1 - 0.45 * smooth01((t - 21.8) / 0.8))
            break
    if pic is None and t >= 22.6:
        # the title card over the last shot, blurred and dark
        dim = 0.15 + 0.12 * (1 if 24.40 <= t < 24.47 else 0) + 0.06 * (1 if 24.53 <= t < 24.57 else 0)
        pic = grade(TITLE_BG, 'storm') * dim
    if pic is not None:
        pic = pic * VIG
        canvas[TOP:TOP + IH] = pic
    # white flash from dusk into snow (around the 9.0 s cut)
    wf = max(0.0, 1 - abs(t - 9.0) / 0.18)
    if wf > 0:
        canvas = canvas * (1 - wf) + 255 * wf
    # two black frames between snow and storm
    if 14.93 <= t < 15.0:
        canvas[:] = 0
    # words
    for w, a, b in WORD_T:
        if a <= t < b:
            al = min(smooth01((t - a) / 0.2), smooth01((b - t) / 0.25))
            canvas = over(canvas, WORDS[w], al)
    # the title
    if t >= 22.6:
        ta = smooth01((t - 22.95) / 0.6)
        canvas = over(canvas, TL['title'], ta)
        canvas = over(canvas, TL['sub'], smooth01((t - 23.45) / 0.5))
        canvas = over(canvas, TL['line'], smooth01((t - 24.0) / 0.6))
    # film grain (only where the picture is)
    g = rng.normal(0, 4.0, (OH // 2, OW // 2)).astype(np.float32)
    g = cv2.resize(g, (OW, OH), interpolation=cv2.INTER_LINEAR)[..., None]
    canvas[TOP:TOP + IH] += g[TOP:TOP + IH]
    # fade in from black, and out at the end
    k = smooth01((t - 0.6) / 0.6) * (1 - smooth01((t - 25.5) / 0.5))
    canvas *= k
    canvas[:TOP] = 0
    canvas[TOP + IH:] = 0
    return np.clip(canvas, 0, 255).astype(np.uint8)

if __name__ == '__main__':
    out = sys.argv[1]
    only = sys.argv[2:]  # optional times for stills
    if only:
        for s in only:
            cv2.imwrite(f'/tmp/trailer2/still-{s}.jpg', frame_at(float(s)))
        sys.exit(0)
    n = int(DUR * FPS)
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out], stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(frame_at(i / FPS).tobytes())
        if i % 60 == 0:
            print('frame', i, flush=True)
    p.stdin.close()
    p.wait()
