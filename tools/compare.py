# Before / after screenshots at fixed spots (Phase 4C).
# Loads two builds of the game (e.g. the previous phase and this one) in headless Chrome, holds
# the camera at the same six spots in both, and writes side-by-side images to docs/compare/.
#
# usage:
#   (cd <before>/dist && python3 -m http.server 8902) & (cd dist && python3 -m http.server 8901) &
#   python3 tools/compare.py http://localhost:8902/index.html http://localhost:8901/index.html docs/compare
#
# Headless Chrome draws with a software GPU (SwiftShader), so this is slow (a few minutes) and
# the frame rate means nothing; the pictures are what count.
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

W, H = 960, 540

# Camera spots use the track samples so they stay on the circuit if it changes:
#   ('sample', i, side offset m, height m, look-ahead samples, look height, fov)
# or fixed world coordinates: ('fixed', x, y, z, lx, ly, lz, fov)
GROUPS = [
    {
        'name': 'Dusk, clear',
        'settings': {'weather': 'clear', 'timeOfDay': 'dusk'},
        'spots': [
            ('1-start-straight', ('sample', 8, 0, 2.2, 26, 1.0, 62)),
            ('2-trackside-grass', ('sample', 300, 14, 1.6, 40, 1.2, 60)),
            ('3-hills', ('fixed', 300, 30, 300, 900, 60, 900, 60)),
            ('4-overview', ('fixed', 0, 140, 90, 1200, 120, 90, 60)),
        ],
    },
    {'name': 'Night, rain', 'settings': {'weather': 'rain', 'timeOfDay': 'night', 'rainStrength': 'heavy'}, 'spots': [('5-night-rain', ('sample', 120, -3, 1.8, 30, 1.0, 62))]},
    {'name': 'Dusk, rain', 'settings': {'weather': 'rain', 'timeOfDay': 'dusk', 'rainStrength': 'heavy'}, 'spots': [('6-dusk-rain', ('sample', 520, 9, 2.0, 30, 1.0, 62))]},
]

BASE = {'quality': 'high', 'qualityChosen': True, 'raceType': 'circuit', 'laps': 3, 'camera': 0, 'debug': False, 'v42': True, 'lensDrops': 'off'}

FREEZE = """(()=>{const g=__apex;g.rig.update=function(){};
const s=document.createElement('style');s.textContent='#hud,#hud *{display:none!important}';document.head.appendChild(s);return 'frozen'})()"""

def place_js(spot):
    if spot[0] == 'fixed':
        _, x, y, z, lx, ly, lz, fov = spot
        return f"(()=>{{const c=__apex.rig.camera;c.position.set({x},{y},{z});c.up.set(0,1,0);c.lookAt({lx},{ly},{lz});c.fov={fov};c.updateProjectionMatrix();return 'ok'}})()"
    _, i, off, h, ahead, lh, fov = spot
    return f"""(()=>{{const S=__apex.world.samples,N=S.length,a=S[{i}%N],b=S[({i}+{ahead})%N];const c=__apex.rig.camera;
c.position.set(a.x+a.nx*{off},{h},a.z+a.nz*{off});c.up.set(0,1,0);c.lookAt(b.x+b.nx*{off},{lh},b.z+b.nz*{off});c.fov={fov};c.updateProjectionMatrix();return 'ok'}})()"""

async def shoot(browser, url, group, out, tag):
    settings = dict(BASE, **group['settings'])
    ctx = await browser.new_context(viewport={'width': W, 'height': H})
    await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(settings))
    pg = await ctx.new_page()
    await pg.goto(url)
    await pg.wait_for_function('!!window.__apex', timeout=120000)
    await pg.wait_for_timeout(6000)
    await pg.evaluate("(()=>{__apex.screens.show('event');return 1})()")
    await pg.wait_for_timeout(1000)
    await pg.evaluate("(()=>{document.getElementById('event-start').click();return 1})()")
    await pg.wait_for_function("__apex.state==='playing'", timeout=180000, polling=200)
    await pg.wait_for_timeout(1500)
    await pg.evaluate(FREEZE)
    files = []
    for name, spot in group['spots']:
        await pg.evaluate(place_js(spot))
        await pg.wait_for_timeout(3000)
        f = out / f'.{tag}-{name}.png'
        await pg.screenshot(path=str(f))
        files.append((name, f))
    await ctx.close()
    return files

def label(img, text):
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    except Exception:
        font = ImageFont.load_default()
    d.rectangle([0, 0, 12 + len(text) * 13, 34], fill=(0, 0, 0))
    d.text((8, 5), text, fill=(255, 255, 255), font=font)

async def main(before, after, outdir):
    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        for g in GROUPS:
            bf = await shoot(b, before, g, out, 'before')
            af = await shoot(b, after, g, out, 'after')
            for (name, f0), (_, f1) in zip(bf, af):
                i0, i1 = Image.open(f0).convert('RGB'), Image.open(f1).convert('RGB')
                label(i0, f'BEFORE (4B.2) - {g["name"]}')
                label(i1, f'AFTER (4C) - {g["name"]}')
                sbs = Image.new('RGB', (W * 2 + 8, H), (20, 20, 20))
                sbs.paste(i0, (0, 0))
                sbs.paste(i1, (W + 8, 0))
                sbs.save(out / f'{name}.jpg', quality=88)
                f0.unlink()
                f1.unlink()
                print('wrote', out / f'{name}.jpg', flush=True)
        await b.close()

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'docs/compare'))
