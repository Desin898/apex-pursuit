# Apex Pursuit trailer tools (5D): rec.py records shots from the running game (python3 rec.py shots-*.json),
# render.py cuts the recorded frames into the trailer, soundtrack.py synthesises the music and effects.
# Records real in-game footage frame by frame (virtual clock) from headless Chrome.
# usage: python3 rec.py spec.json
import sys, json, asyncio, pathlib, base64, time
from playwright.async_api import async_playwright

import os
URL = os.environ.get('URL', 'http://localhost:8901/index.html')  # dist/ served, with your cars/ pack beside it for the GT3 RS
BASE = {'quality': 'high', 'qualityChosen': True, 'camera': 0, 'debug': False, 'v42': True, 'lensDrops': 'off',
        'venue': 'hanagiri-pass', 'target60': False, 'fpsCap': 'unlimited', 'music': False, 'radioVoice': False,
        'airCutIn': False, 'laps': 3, 'difficulty': 'hard'}
CLOCK = """(()=>{const raf=window.requestAnimationFrame.bind(window);let cb=null;window.__vt=0;window.__manual=false;
window.requestAnimationFrame=function(f){if(window.__manual){cb=f;return 1;}return raf(t=>{window.__vt=t;f(t)})};
window.__step=function(n,ms){for(let i=0;i<n;i++){const f=cb;cb=null;window.__vt+=ms;if(f)f(window.__vt);}return !!cb};})()"""
LIB = open(pathlib.Path(__file__).with_name('camlib.js')).read()

async def run(spec):
    out = pathlib.Path(spec['out']); out.mkdir(parents=True, exist_ok=True)
    W, H = spec.get('w', 1920), spec.get('h', 1080)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1)
        st = dict(BASE, **spec.get('settings', {}))
        await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(st))
        await ctx.add_init_script(CLOCK)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL)
        await pg.wait_for_function('!!window.__apex', timeout=240000)
        await pg.wait_for_timeout(4000)
        await pg.evaluate("(()=>{__apex.screens.show('event');return 1})()")
        await pg.wait_for_timeout(800)
        await pg.evaluate("(()=>{document.getElementById('event-start').click();return 1})()")
        await pg.wait_for_function("__apex.state==='playing'", timeout=300000, polling=250)
        await pg.evaluate("(()=>{window.__manual=true;return 1})()")
        await pg.wait_for_timeout(1500)
        print('setup →', await pg.evaluate(LIB), flush=True)
        if spec.get('setup'): print('setup2 →', await pg.evaluate(spec['setup']), flush=True)
        for sh in spec['shots']:
            if sh.get('only') is False: continue
            if sh.get('pre'): print(sh['name'], 'pre →', await pg.evaluate(sh['pre']), flush=True)
            await pg.evaluate("(()=>{__T.begin(%s);return 1})()" % json.dumps(sh.get('cam', {})))
            d = out / sh['name']; d.mkdir(exist_ok=True)
            t0 = time.time()
            ev = {int(k): v for k, v in sh.get('events', {}).items()}
            for i in range(sh['frames']):
                if i in ev: await pg.evaluate(ev[i])
                data = await pg.evaluate("(()=>{__step(1,1000/30);return __T.grab()})()")
                if i == 0: print(sh['name'], 'canvas', await pg.evaluate("__T.size()"), flush=True)
                (d / f'{i:04d}.jpg').write_bytes(base64.b64decode(data.split(',', 1)[1]))
                if i % 15 == 0: print(sh['name'], i, f'{(time.time()-t0)/(i+1):.2f}s/f', await pg.evaluate("__T.info()"), flush=True)
            print('done', sh['name'], flush=True)
        for l in logs[:15]: print(l)
        await b.close()

asyncio.run(run(json.load(open(sys.argv[1]))))
