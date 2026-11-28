# 5C: screenshots at chosen spots in headless Chrome (software GPU: slow, frame rate means nothing).
# usage: python3 tools/shots.py <url> <spec.json>
#   spec: {"out": dir, "w":, "h":, "groups": [{"settings": {...}, "shots": [[name, js, waitMs], ...], "setup": js}]}
# Each shot's js places the camera (or the car); the HUD is hidden and the camera rig frozen.
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright

BASE = {'quality': 'high', 'qualityChosen': True, 'raceType': 'circuit', 'camera': 0, 'debug': False, 'v42': True, 'lensDrops': 'off'}
FREEZE = """(()=>{const g=__apex;g.rig.update=function(){};
const s=document.createElement('style');s.textContent='#hud,#hud *,.toast,#toast{display:none!important}';document.head.appendChild(s);return 'frozen'})()"""

async def run(url, spec):
    out = pathlib.Path(spec['out']); out.mkdir(parents=True, exist_ok=True)
    W, H = spec.get('w', 1280), spec.get('h', 720)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        for g in spec['groups']:
            ctx = await b.new_context(viewport={'width': W, 'height': H})
            st = dict(BASE, **g.get('settings', {}))
            await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(st))
            pg = await ctx.new_page()
            logs = []
            pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None)
            pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
            await pg.goto(url)
            await pg.wait_for_function('!!window.__apex', timeout=180000)
            await pg.wait_for_timeout(5000)
            await pg.evaluate("(()=>{__apex.screens.show('event');return 1})()")
            await pg.wait_for_timeout(800)
            await pg.evaluate("(()=>{document.getElementById('event-start').click();return 1})()")
            await pg.wait_for_function("__apex.state==='playing'", timeout=240000, polling=250)
            await pg.wait_for_timeout(g.get('settle', 1500))
            if g.get('setup'):
                r = await pg.evaluate(g['setup'])
                if r is not None: print('setup →', r)
            if not g.get('live'): await pg.evaluate(FREEZE)
            for name, js, wait in g['shots']:
                r = await pg.evaluate(js)
                if r is not None and r != 'ok': print(name, '→', r)
                await pg.wait_for_timeout(wait)
                await pg.screenshot(path=str(out / f'{name}.png'))
                print('shot', name, flush=True)
            for l in logs[:12]: print(l)
            await ctx.close()
        await b.close()

asyncio.run(run(sys.argv[1], json.load(open(sys.argv[2]))))
