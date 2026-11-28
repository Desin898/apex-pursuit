# Apex Pursuit trailer soundtrack v2: heavier, bass-led trailer sound. All synthesised (no samples).
# Same hit points as v1: 2.6 4.6 6.0 7.2 8.2 | 9.0 HIT | 11.0 12.4 13.8 | 14.93 drop | 15.0 HIT | 16.4 17.6 19.0 |
# 19.2 thunder | 21.0 | 22.6 BOOM (title) | 24.4 distant thunder | fade 25.4-26
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import soundfile as sf

SR = 48000
DUR = 26.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(11)
BUS = {k: np.zeros((N, 2)) for k in ('music', 'drums', 'sub', 'fx', 'engine', 'amb')}

def filt(x, kind, f, order=4):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output='sos'), x, axis=0)

def ramp(points):
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)

def seg(t0, dur):
    i0 = max(0, int(t0 * SR)); n = min(int(dur * SR), N - i0)
    return i0, n, np.arange(n) / SR

def put(bus, i0, x, g=1.0, pan=0.0, width=0.0):
    """mono x (or stereo) into a bus at sample i0"""
    n = min(len(x), N - i0)
    if n <= 0: return
    x = x[:n]
    if x.ndim == 1:
        if width:
            d = int(width * SR / 1000)
            xr = np.concatenate([np.zeros(d), x])[:n]
            st = np.stack([x, xr], 1)
        else:
            st = np.stack([x, x], 1)
        st = st * np.array([np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))]) * np.sqrt(2)
    else:
        st = x
    BUS[bus][i0:i0 + n] += st * g

def reverb(x, secs=2.0, wet=0.35, tone=6000, seed=0):
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    env = np.exp(-np.arange(n) / (SR * secs / 6.5))
    out = np.zeros_like(x)
    for ch in range(2):
        ir = r.normal(0, 1, n) * env
        ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir = filt(ir, 'lowpass', tone)
        ir /= np.sqrt((ir ** 2).sum())
        out[:, ch] = fftconvolve(x[:, ch], ir)[: len(x)]
    return x * (1 - wet) + out * wet * 1.4

def soft(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)

def saw(ph):
    return 2 * ((ph / (2 * np.pi)) % 1) - 1

# ── building blocks ───────────────────────────────────────────────────────────
def sub_drop(t0, f0=70, f1=30, dur=3.0, g=1.0):
    """808-style sub: a pitch dive and a long round tail"""
    i0, n, tt = seg(t0, dur)
    f = f1 + (f0 - f1) * np.exp(-tt / 0.18)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = soft(x * 1.4, 1.5) * np.exp(-tt / (dur / 3.2)) * np.minimum(1, tt / 0.004)
    put('sub', i0, x, g)

def kick(t0, g=1.0, f0=150, f1=45, dec=0.28, click=0.4):
    i0, n, tt = seg(t0, 0.9)
    f = f1 + (f0 - f1) * np.exp(-tt / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / dec)
    x += filt(rng.normal(0, 1, n), 'bandpass', [1500, 6000]) * np.exp(-tt / 0.006) * click
    put('drums', i0, soft(x * 1.3, 1.6), g)

def taiko(t0, g=1.0, f0=95, pan=0.0):
    """big low drum: skin thump, body, room"""
    i0, n, tt = seg(t0, 1.6)
    f = f0 * (1 + 0.6 * np.exp(-tt / 0.03))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.32)
    body += 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.52) / SR) * np.exp(-tt / 0.18)
    skin = filt(rng.normal(0, 1, n), 'bandpass', [120, 1400]) * np.exp(-tt / 0.06) * 0.8
    put('drums', i0, soft((body + skin) * 1.2, 1.4), g, pan, width=0.6)

def snare(t0, g=1.0):
    i0, n, tt = seg(t0, 0.5)
    x = filt(rng.normal(0, 1, n), 'bandpass', [900, 8000]) * np.exp(-tt / 0.09)
    x += np.sin(2 * np.pi * 190 * tt) * np.exp(-tt / 0.05) * 0.7
    put('drums', i0, x, g, width=0.8)

def hat(t0, g=1.0, open_=False):
    i0, n, tt = seg(t0, 0.25)
    x = filt(rng.normal(0, 1, n), 'highpass', 8000) * np.exp(-tt / (0.06 if open_ else 0.015))
    put('drums', i0, x, g, pan=rng.uniform(-0.3, 0.3))

def braam(t0, root=36.71, dur=3.0, g=1.0):
    """the trailer horn: a stack of detuned saws an octave apart, filter opening, overdriven"""
    i0, n, tt = seg(t0, dur)
    x = np.zeros(n)
    for mult in (1, 2, 3, 4):
        for det in (-0.12, 0, 0.13):
            ph = 2 * np.pi * root * mult * (1 + det / 100 * mult) * tt + rng.uniform(0, 6)
            x += saw(ph) / mult ** 0.6
    env = np.minimum(1, tt / 0.03) * np.exp(-tt / (dur / 2.4))
    # filter opens on the attack then closes: approximate with two low-passed layers crossfaded
    bright = filt(x, 'lowpass', 2200)
    dark = filt(x, 'lowpass', 380)
    a = np.exp(-tt / 0.35)
    y = soft((bright * a + dark * (1 - a)) * 0.35, 2.2) * env
    put('music', i0, y, g, width=12)

def impact(t0, g=1.0, root=36.71, big=True):
    sub_drop(t0, 75, 30, 3.6 if big else 2.0, 1.0 * g)
    kick(t0, 1.0 * g, 160, 42, 0.45, 0.6)
    taiko(t0, 0.8 * g, 70)
    i0, n, tt = seg(t0, 2.5)
    crash = filt(rng.normal(0, 1, n), 'bandpass', [400, 9000]) * np.exp(-tt / 0.35) * 0.5
    put('fx', i0, crash, g, width=9)
    if big:
        braam(t0, root, 3.2, 0.9 * g)

def whoosh(t0, g=1.0, pan=0.0, length=0.55):
    i0, n, tt = seg(t0 - length * 0.65, length)
    x = rng.normal(0, 1, n)
    out = np.zeros(n)
    for j, fc in enumerate(np.geomspace(4000, 350, 7)):
        w = np.exp(-((tt / length - j / 6) ** 2) / (2 * 0.09 ** 2))
        out += filt(x, 'bandpass', [fc * 0.7, fc * 1.4]) * w
    out *= np.sin(np.pi * np.clip(tt / length, 0, 1)) ** 1.5
    put('fx', i0, out, g * 0.6, pan, width=4)

def reverse_swell(t_end, dur=1.2, g=1.0):
    """a reversed cymbal/noise swell landing on t_end"""
    i0, n, tt = seg(t_end - dur, dur)
    x = filt(rng.normal(0, 1, n), 'bandpass', [600, 9000]) * (tt / dur) ** 2.4
    put('fx', i0, x, g, width=7)

def riser(t0, t1, g=1.0):
    """Shepard-style rising tones plus noise: tension into a hit"""
    i0, n, tt = seg(t0, t1 - t0)
    T_ = t1 - t0
    x = np.zeros(n)
    for k in range(5):
        fr = 110 * 2 ** ((k + tt / T_ * 1.5) % 5)
        amp = np.exp(-((np.log2(fr / 440)) ** 2) / 2.2)
        x += np.sin(2 * np.pi * np.cumsum(fr) / SR) * amp
    nz = filt(rng.normal(0, 1, n), 'bandpass', [800, 6000]) * 0.5
    y = (x * 0.25 + nz * 0.5) * (tt / T_) ** 2
    put('fx', i0, y, g, width=6)

# ── DUSK 0-9: low tension, a ticking pulse that builds, the engine ────────────
drone = (np.sin(2 * np.pi * 36.71 * t) + 0.5 * np.sin(2 * np.pi * 55.0 * t + 1) + 0.3 * saw(2 * np.pi * 73.42 * t * 1.002))
drone = filt(drone, 'lowpass', 320)
put('music', 0, drone * ramp([(0, 0), (0.8, 0.22), (8.6, 0.55), (9.0, 0.0), (26, 0)]) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.2 * t)), 1.0, width=15)
# the ticking ostinato: muted plucks on a minor figure, 16ths at 140 bpm, filter opening as it builds
BEAT = 60 / 140
notes = [73.42, 73.42, 110.0, 73.42, 87.31, 73.42, 110.0, 98.0]
k = 0
tb = 0.6
while tb < 8.95:
    f = notes[k % len(notes)] * 2
    i0, n, tt = seg(tb, 0.2)
    x = saw(2 * np.pi * f * tt) + 0.5 * saw(2 * np.pi * f * 1.005 * tt)
    cut = 500 + 2200 * min(1, (tb - 0.6) / 8.3)
    x = filt(x, 'lowpass', cut) * np.exp(-tt / 0.07) * (0.6 if k % 4 else 1.0)
    put('music', i0, x, 0.10 * (0.4 + 0.6 * min(1, (tb - 0.6) / 6)), pan=0.35 if k % 2 else -0.35)
    tb += BEAT / 4
    k += 1
# a heartbeat kick on the beat from 2.6, then 8ths from 7.2
tb = 2.6
while tb < 8.95:
    kick(tb, 0.5 if tb < 7.2 else 0.65, 120, 45, 0.25, 0.2)
    tb += BEAT if tb < 7.2 else BEAT / 2
# medium hits on the dusk cuts
for c, gg in ((2.6, 0.55), (4.6, 0.6), (6.0, 0.5), (7.2, 0.7)):
    sub_drop(c, 60, 34, 1.4, gg)
    taiko(c, 0.6 * gg, 85)
braam(4.6, 36.71, 2.0, 0.45)
braam(7.2, 41.2, 1.8, 0.55)
riser(7.2, 9.0, 0.6)
reverse_swell(9.0, 1.4, 0.7)

# ── SNOW 9-14.93: the big hit, a driving beat with sub bass ───────────────────
impact(9.0, 1.3, 36.71)
tb = 9.0
bar = 0
while tb < 14.85:
    for s16 in range(4):
        st = tb + s16 * BEAT / 4
        if st >= 14.85: break
        # a rolling sub bass on 16ths, ducked by the kick
        i0, n, tt = seg(st, BEAT / 4)
        f = 36.71 if bar % 4 < 3 else 32.70
        x = soft(np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * 2 * f * tt), 1.3) * np.exp(-tt / 0.09) * (0.5 if s16 == 0 else 1.0)
        put('sub', i0, x, 0.42)
        hat(st, 0.18 if s16 % 2 else 0.1)
    kick(tb, 0.9)
    if bar % 2 == 1: snare(tb, 0.35)
    tb += BEAT
    bar += 1
for c in (11.0, 12.4, 13.8):
    taiko(c, 0.75, 80)
    sub_drop(c, 65, 33, 1.2, 0.6)
# wind, the glare build, the drop to black
wind = filt(rng.normal(0, 1, N), 'bandpass', [180, 1100]) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.27 * t + 1)) * ramp([(8.9, 0), (9.3, 1), (14.6, 1), (14.93, 0)])
put('amb', 0, wind, 0.10, width=11)
riser(13.6, 14.93, 0.7)
reverse_swell(14.93, 1.1, 0.6)

# ── STORM 15-22.6: taiko ensemble, braams, rain, thunder ─────────────────────
impact(15.0, 1.35, 32.70)
rain = np.stack([filt(rng.normal(0, 1, N), 'bandpass', [500, 6500]) for _ in range(2)], 1) * ramp([(14.95, 0), (15.05, 1), (25.0, 0.8), (26, 0)])[:, None]
BUS['amb'] += rain * 0.055
rumble_bed = filt(np.cumsum(rng.normal(0, 1, N)) * 0.002, 'bandpass', [25, 120])
put('amb', 0, rumble_bed * ramp([(15, 0), (15.5, 1), (22.6, 1), (23.5, 0.4), (26, 0)]), 0.8)
# taiko pattern: 1 . . 1 . 1 1 .  (8ths), with a low tom answering
pat = [1, 0, 0, 1, 0, 1, 1, 0]
tb = 15.0
j = 0
while tb < 22.45:
    if pat[j % 8]: taiko(tb, 0.7 if j % 8 else 0.95, 90 if j % 8 else 75, pan=-0.25 if j % 2 else 0.25)
    if j % 8 == 4: snare(tb, 0.4)
    hat(tb + BEAT / 4, 0.08)
    tb += BEAT / 2
    j += 1
# the bass: a pulsing low synth bass in 8ths, minor, sidechain-like pumping
bt = np.zeros(N)
roots = [(15.0, 32.70), (17.6, 29.14), (19.0, 32.70), (21.0, 27.50)]
for a, (st, f) in enumerate(roots):
    en = roots[a + 1][0] if a + 1 < len(roots) else 22.6
    i0, n, tt = seg(st, en - st)
    x = soft(saw(2 * np.pi * f * tt) * 0.6 + np.sin(2 * np.pi * f * tt), 1.5)
    pump = 1 - 0.75 * np.exp(-((tt % (BEAT / 2)) / 0.06))
    bt[i0:i0 + n] = x * pump
put('sub', 0, filt(bt, 'lowpass', 220), 0.5)
for c, r in ((16.4, 32.70), (17.6, 29.14), (19.0, 32.70), (21.0, 27.50)):
    impact(c, 0.7, r, big=c in (17.6, 21.0))
# the thunder: a sharp multi-stroke crack, then a long rolling rumble
i0, n, tt = seg(19.2, 6.0)
cr = np.zeros(n)
for dt_, gg in ((0.0, 1.0), (0.04, 0.6), (0.1, 0.85), (0.19, 0.45), (0.33, 0.3)):
    j0 = int(dt_ * SR); m = int(0.3 * SR)
    cr[j0:j0 + m] += rng.normal(0, 1, m) * np.exp(-np.arange(m) / SR / 0.03) * gg
cr = filt(cr, 'highpass', 300)
roll = filt(np.cumsum(rng.normal(0, 1, n)) * 0.003, 'lowpass', 160) * np.minimum(1, tt / 0.15) * np.exp(-tt / 1.6) * (0.7 + 0.3 * np.sin(2 * np.pi * 1.3 * tt))
put('fx', i0, cr, 0.7, width=14)
put('amb', i0, roll, 1.8, width=20)
sub_drop(19.2, 55, 26, 3.0, 0.7)
# drop-out before the title: everything ducks at 22.35, reverse swell into the boom
riser(21.0, 22.6, 0.5)
reverse_swell(22.6, 1.6, 0.9)

# the drop-out: the bed falls away just before the title boom
for kk, lo_ in (('music', 0.05), ('drums', 0.05), ('sub', 0.05), ('engine', 0.0), ('amb', 0.35)):
    BUS[kk] *= ramp([(0, 1), (22.25, 1), (22.42, lo_), (26, lo_)])[:, None]
# ── TITLE 22.6-26 ────────────────────────────────────────────────────────────
sub_drop(22.6, 80, 25, 4.0, 1.7)
kick(22.6, 1.1, 120, 30, 0.9, 0.5)
taiko(22.6, 1.0, 60)
braam(22.6, 27.50, 4.0, 1.5)
i0, n, tt = seg(22.6, 3.4)
put('fx', i0, filt(rng.normal(0, 1, n), 'bandpass', [300, 7000]) * np.exp(-tt / 0.5) * 0.45, 1.0, width=10)
# a high shimmering tone over the title (A minor, soft)
for f, gg in ((440.0, 0.04), (659.25, 0.03), (880.0, 0.02)):
    i0, n, tt = seg(23.0, 3.0)
    x = np.sin(2 * np.pi * f * tt + 0.6 * np.sin(2 * np.pi * 5 * tt)) * np.minimum(1, tt / 0.8) * np.exp(-tt / 2.5)
    put('music', i0, x, gg, width=8)
i0, n, tt = seg(24.42, 1.6)
put('amb', i0, filt(np.cumsum(rng.normal(0, 1, n)) * 0.003, 'lowpass', 140) * np.minimum(1, tt / 0.3) * np.exp(-tt / 0.7), 2.0, width=15)

# ── the car: a flat-six (3 firings per turn), gear changes, pops on the lift ──
rpm = ramp([(0, 1000), (0.5, 1100), (0.9, 7200), (2.2, 8600), (2.3, 6400), (3.6, 8400), (3.7, 6600), (4.55, 8200), (4.62, 4200), (4.8, 7600), (5.9, 8700), (6.0, 6800),
            (7.1, 8800), (7.2, 7000), (8.2, 8600), (8.25, 7400), (8.95, 9000), (9.0, 6000), (10.6, 8200), (10.7, 6500), (12.3, 8300), (12.4, 6800), (14.0, 8500), (14.9, 8800),
            (15.0, 6200), (16.3, 8400), (16.4, 6700), (17.5, 8300), (17.6, 6400), (19.0, 8600), (19.1, 7000), (21.0, 8400), (22.3, 8800), (22.5, 3000), (26, 1200)])
fire = rpm / 60 * 3
ph = 2 * np.pi * np.cumsum(fire) / SR
eng = np.zeros(N)
for h in range(1, 18):
    w = 1 / h ** 0.85 * (1.4 if h in (2, 3, 6) else 1)
    eng += np.sin(h * ph + rng.uniform(0, 6)) * w
eng += 0.5 * np.sin(0.5 * ph)  # the half-order rumble of an uneven exhaust
eng = soft(eng * 0.9, 2.0)
eng += filt(rng.normal(0, 1, N), 'bandpass', [200, 2500]) * 0.25 * (rpm / 9000)
eng = filt(eng, 'lowpass', 3800)
egain = ramp([(0, 0), (0.4, 0.22), (2.6, 0.5), (8.95, 0.55), (9.0, 0.3), (14.9, 0.32), (15.0, 0.28), (22.3, 0.32), (22.5, 0.0), (26, 0)])
put('engine', 0, eng * egain, 0.3, width=3)
# exhaust pops on the lifts
for tp in (2.25, 3.65, 4.6, 6.0, 7.2, 9.02, 15.02, 22.45):
    for q in range(rng.integers(2, 5)):
        i0, n, tt = seg(tp + q * rng.uniform(0.03, 0.09), 0.08)
        put('engine', i0, filt(rng.normal(0, 1, n), 'bandpass', [150, 2500]) * np.exp(-tt / 0.012), 0.35, pan=rng.uniform(-0.3, 0.3))

# whooshes on the cuts
for k_, c in enumerate([2.6, 4.6, 6.0, 7.2, 8.2, 11.0, 12.4, 13.8, 16.4, 17.6, 21.0]):
    whoosh(c, 0.5, pan=0.5 if k_ % 2 else -0.5)

# ── mix ──────────────────────────────────────────────────────────────────────
mix = (reverb(BUS['music'], 2.4, 0.35, 5000, 1) * 1.0 + reverb(BUS['drums'], 1.8, 0.28, 7000, 2) * 1.0 +
       BUS['sub'] * 0.85 + reverb(BUS['fx'], 2.0, 0.3, 7000, 3) * 0.9 + BUS['engine'] * 0.9 + reverb(BUS['amb'], 1.2, 0.2, 6000, 4) * 1.0)
# keep the sub mono and clean under 120 Hz
lo = filt(mix.mean(1), 'lowpass', 110)
hi = mix - filt(mix, 'lowpass', 110)
mix = hi + lo[:, None]
# a gentle bass lift and a glue limiter
mix += filt(mix, 'lowpass', 90) * 0.2
mix *= ramp([(0, 0), (0.3, 1), (25.4, 1), (26, 0)])[:, None]
mix /= np.abs(mix).max()
mix = soft(mix * 1.2, 1.1) * 0.95
sf.write('/tmp/trailer2/soundtrack-raw.wav', mix.astype(np.float32), SR)
print('ok')
