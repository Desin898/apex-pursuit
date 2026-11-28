# Before / after pictures for Phase 5C: every Hanagiri zone in Clear, Rain at night and Snow,
# the wheels close up, and a car driven into a steep bank.
#
# usage:
#   (cd <5B.1 build>/dist && python3 -m http.server 8902) & (cd dist && python3 -m http.server 8901) &
#   python3 tools/compare5c.py http://localhost:8902/index.html http://localhost:8901/index.html docs/5c [group...]
#
# Headless Chrome draws with a software GPU (SwiftShader): slow, and the frame rate means nothing.
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

W, H = 960, 540
BASE = {'quality': 'high', 'qualityChosen': True, 'raceType': 'circuit', 'camera': 0, 'debug': False, 'v42': True, 'lensDrops': 'off', 'venue': 'hanagiri-pass', 'laps': 2}
FREEZE = """(()=>{const g=__apex;g.rig.update=function(){};
const s=document.createElement('style');s.textContent='#hud,#hud *,.toast{display:none!important}';document.head.appendChild(s);return 'frozen'})()"""
HIDE_HUD = """(()=>{const s=document.createElement('style');s.textContent='#hud,#hud *,.toast{display:none!important}';document.head.appendChild(s);return 'ok'})()"""

def road(km, up=2.3, ahead=26, look_up=1.5, side=0.0, fov=62):
    """a camera on the road at lap km (from the start line), looking ahead along it"""
    return f"""(()=>{{const Wd=__apex.world,S=Wd.samples,N=S.length;const i=(Wd.startIndex+Math.round({km}*500))%N,a=S[i],b=S[(i+{ahead})%N];
const c=__apex.rig.camera;c.position.set(a.x+a.nx*{side},a.y+{up},a.z+a.nz*{side});c.up.set(0,1,0);c.lookAt(b.x+b.nx*{side},b.y+{look_up},b.z+b.nz*{side});c.fov={fov};c.updateProjectionMatrix();return 'ok'}})()"""

ZONES = [
    ('1-village', road(0.33, ahead=40)),
    ('2-forest', road(2.05, ahead=30)),
    ('3-switchbacks', road(4.62, ahead=30, look_up=3)),
    ('4-high-pass', road(5.9, ahead=40, look_up=2)),
    ('5-cliff', road(6.92, ahead=28, look_up=6, side=-2)),
    ('6-valley', road(8.35, ahead=60, look_up=40)),
]
WHEEL = """(()=>{const s=__apex.race.player.s,c=__apex.rig.camera;const f=[Math.sin(s.yaw),Math.cos(s.yaw)],l=[Math.cos(s.yaw),-Math.sin(s.yaw)];const wx=s.x+f[0]*1.4+l[0]*0.84,wz=s.z+f[1]*1.4+l[1]*0.84;c.position.set(wx+l[0]*1.3+f[0]*0.6,s.y+0.55,wz+l[1]*1.3+f[1]*0.6);c.up.set(0,1,0);c.lookAt(wx,s.y+0.33,wz);c.fov=40;c.updateProjectionMatrix();return 'ok'})()"""
# drive the player's car into a steep bank beside the road (the switchbacks), then watch it from the side
BANK_SETUP = """(()=>{const g=__apex,Wd=g.world,S=Wd.samples,N=S.length;g.race.countdown=0;
const H=(x,z)=>Wd.heightAt(x,z);let best=-1,bs=1,bh=0;
for(let i=0;i<N;i+=3){const s=S[i];for(const sd of [1,-1]){const o=Wd.roadBand+1;const x0=s.x+s.nx*o*sd,z0=s.z+s.nz*o*sd;
 const h=H(s.x+s.nx*(o+7)*sd,s.z+s.nz*(o+7)*sd)-H(x0,z0);if(h<=bh)continue;
 const ex=s.x+s.nx*(Wd.roadBand-0.4)*sd,ez=s.z+s.nz*(Wd.roadBand-0.4)*sd;
 if(Wd.barrierRuns.some(r=>r.pts.some(p=>Math.hypot(p.x-ex,p.z-ez)<5)))continue;
 if(Wd.trees.some(t=>Math.hypot(t.x-x0,t.z-z0)<9))continue;
 const other=Wd.nearestTrack(s.x+s.nx*(o+8)*sd,s.z+s.nz*(o+8)*sd);if(other&&Math.abs(other.index-i)>40&&Math.abs(other.index-i)<N-40)continue;
 bh=h;best=i;bs=sd;}}
const s=S[best];const yaw=Math.atan2(s.nx*bs,s.nz*bs);const p=g.race.player;p.physics.reset(s.x+s.nx*(Wd.roadBand-4)*bs,s.z+s.nz*(Wd.roadBand-4)*bs,yaw);p.s.vx=Math.sin(yaw)*14;p.s.vz=Math.cos(yaw)*14;
window.__bank={x:s.x,z:s.z,nx:s.nx*bs,nz:s.nz*bs,tx:s.tx,tz:s.tz};return 'bank '+bh.toFixed(1)+' m over 7 m'})()"""
BANK_CAM = """(()=>{const b=window.__bank,s=__apex.race.player.s,c=__apex.rig.camera;__apex.rig.update=function(){};c.position.set(s.x-b.tx*9-b.nx*4,s.y+2.2,s.z-b.tz*9-b.nz*4);c.up.set(0,1,0);c.lookAt(s.x,s.y+0.8,s.z);c.fov=55;c.updateProjectionMatrix();return 'ok'})()"""

GROUPS = {
    'clear': {'title': 'Clear, dusk', 'settings': {'weather': 'clear', 'timeOfDay': 'dusk'}, 'spots': [(n + '-clear', js) for n, js in ZONES]},
    'rain': {'title': 'Rain, night', 'settings': {'weather': 'rain', 'timeOfDay': 'night', 'rainStrength': 'heavy'}, 'spots': [(n + '-rain-night', js) for n, js in ZONES]},
    'snow': {'title': 'Snow, dusk', 'settings': {'weather': 'snow', 'timeOfDay': 'dusk', 'rainStrength': 'light'}, 'spots': [(n + '-snow', js) for n, js in ZONES]},
    'wheels': {'title': 'Wheels', 'settings': {'weather': 'clear', 'timeOfDay': 'dusk'}, 'spots': [('7-wheel-close-up', WHEEL)]},
    'bank': {'title': 'Into a steep bank', 'settings': {'weather': 'clear', 'timeOfDay': 'dusk'}, 'live': True, 'spots': [('8-car-against-a-bank', None)]},
}

async def shoot(browser, url, group, out, tag):
    settings = dict(BASE, **group['settings'])
    ctx = await browser.new_context(viewport={'width': W, 'height': H})
    await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(settings))
    pg = await ctx.new_page()
    await pg.goto(url)
    await pg.wait_for_function('!!window.__apex', timeout=180000)
    await pg.wait_for_timeout(5000)
    await pg.evaluate("(()=>{__apex.screens.show('event');return 1})()")
    await pg.wait_for_timeout(1000)
    await pg.evaluate("(()=>{document.getElementById('event-start').click();return 1})()")
    await pg.wait_for_function("__apex.state==='playing'", timeout=240000, polling=250)
    await pg.wait_for_timeout(9000)  # trees' textures and cards bake once loaded
    files = []
    if group.get('live'):
        await pg.evaluate(HIDE_HUD)
        print(tag, await pg.evaluate(BANK_SETUP), flush=True)
        await pg.wait_for_timeout(3500)
        await pg.evaluate(BANK_CAM)
        await pg.wait_for_timeout(600)
        f = out / f'.{tag}-{group["spots"][0][0]}.png'
        await pg.screenshot(path=str(f), timeout=180000)
        files.append((group['spots'][0][0], f))
    else:
        await pg.evaluate(FREEZE)
        for name, js in group['spots']:
            await pg.evaluate(js)
            await pg.wait_for_timeout(3500)
            f = out / f'.{tag}-{name}.png'
            await pg.screenshot(path=str(f), timeout=180000)
            files.append((name, f))
    await ctx.close()
    return files

def label(img, text):
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
    except Exception:
        font = ImageFont.load_default()
    d.rectangle([0, 0, 14 + len(text) * 12, 32], fill=(0, 0, 0))
    d.text((8, 5), text, fill=(255, 255, 255), font=font)

async def main(before, after, outdir, which):
    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        for key in which:
            g = GROUPS[key]
            bf = await shoot(b, before, g, out, 'before')
            af = await shoot(b, after, g, out, 'after')
            for (name, f0), (_, f1) in zip(bf, af):
                i0, i1 = Image.open(f0).convert('RGB'), Image.open(f1).convert('RGB')
                label(i0, f'BEFORE (5B.1) - {g["title"]}')
                label(i1, f'AFTER (5C) - {g["title"]}')
                sbs = Image.new('RGB', (W * 2 + 8, H), (20, 20, 20))
                sbs.paste(i0, (0, 0))
                sbs.paste(i1, (W + 8, 0))
                sbs.save(out / f'{name}.jpg', quality=86)
                f0.unlink()
                f1.unlink()
                print('wrote', out / f'{name}.jpg', flush=True)
        await b.close()

if __name__ == '__main__':
    which = sys.argv[4:] or list(GROUPS.keys())
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'docs/5c', which))
