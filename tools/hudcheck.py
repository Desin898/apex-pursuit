# Dev helper (Phase 4A): load a Pursuit Race in headless Chrome, put every HUD call-out on screen
# at once (radio line, toast, big pop, recovery prompt, Busted/Evade meters, sound hint), then at
# six window sizes check that no two visible HUD boxes overlap and none leaves the window.
# usage: python3 tools/hudcheck.py [url] [out-prefix]      (serve dist/ first, see README)
import sys, json, asyncio
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8901/index.html'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/prev/hud-'
SIZES = [(1920, 1080), (1280, 720), (1050, 750), (960, 540), (800, 600), (640, 360)]
import os
if os.environ.get('SIZES'): SIZES = [tuple(map(int, x.split('x'))) for x in os.environ['SIZES'].split(',')]
MODES = os.environ.get('MODES', 'chase,hood').split(',')
SETTINGS = {'quality': 'low', 'qualityChosen': True, 'raceType': 'pursuit', 'laps': 3, 'weather': 'rain', 'timeOfDay': 'night'}

START = """new Promise(r=>{__apex.screens.show('event');setTimeout(()=>{document.getElementById('event-start').click();
const t=setInterval(()=>{const g=__apex;if(g.state==='playing'&&!g.race.held){clearInterval(t);r('racing')}},100)},800)})"""

# Freeze the race and fill every slot the HUD has.
FILL = """(()=>{const g=__apex;g.timeScale=0;const p=g.race.pursuit;if(p){p.joined=true;p.heat=3.4;}
g.hud.radio('All units, roadblock is set ahead of the suspect in the run to the line.');
g.hud.toast('Chase near camera');
g.hud.pop('JUMP START','Held for 1.0 s',false,600);
document.getElementById('hud-alert').innerHTML='<div class="msg warn">Wrong way <small><kbd>R</kbd> rejoin · auto in 4 s</small></div>';
document.getElementById('hud-meters').hidden=false;document.getElementById('hud-sound').hidden=false;
document.getElementById('hud-hints').classList.remove('faded');
if(!document.getElementById('hc-style')){const st=document.createElement('style');st.id='hc-style';st.textContent='#hud-lane > *{animation:none!important;opacity:1}';document.head.appendChild(st)}return 'filled'})()"""

MEASURE = """(()=>{
const vis=el=>{if(!el)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||el.hidden)return false;
  for(let p=el;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||p.hidden||+c.opacity===0)return false;}const r=el.getBoundingClientRect();return r.width>1&&r.height>1};
const boxes={};
const add=(name,el)=>{if(vis(el)){const r=el.getBoundingClientRect();boxes[name]=[r.left,r.top,r.right,r.bottom]}};
add('top',document.getElementById('hud-top'));add('event',document.getElementById('hud-event'));
add('map',document.getElementById('map'));add('dial',document.getElementById('cluster'));
add('heat',document.getElementById('hud-heat'));add('meters',document.getElementById('hud-meters'));
add('alert',document.querySelector('#hud-alert .msg'));add('sound',document.getElementById('hud-sound'));
add('hints',document.getElementById('hud-hints'));add('pop',document.querySelector('#pop.on'));
add('mirror',document.getElementById('mirror'));
document.querySelectorAll('#hud-lane > *').forEach((e,i)=>add('lane'+i,e));
return JSON.stringify({w:innerWidth,h:innerHeight,scale:getComputedStyle(document.documentElement).getPropertyValue('--hud-scale'),boxes})})()"""

def problems(m):
    out = []
    W, H, B = m['w'], m['h'], m['boxes']
    names = list(B)
    for n in names:
        l, t, r, b = B[n]
        if l < -0.5 or t < -0.5 or r > W + 0.5 or b > H + 0.5:
            out.append(f'{n} leaves the window ({l:.0f},{t:.0f})-({r:.0f},{b:.0f})')
    for i, a in enumerate(names):
        for bn in names[i + 1:]:
            if a.startswith('lane') and bn.startswith('lane'):
                continue  # lines inside the lane are stacked by layout
            A, Bx = B[a], B[bn]
            ox = min(A[2], Bx[2]) - max(A[0], Bx[0])
            oy = min(A[3], Bx[3]) - max(A[1], Bx[1])
            if ox > 1 and oy > 1:
                out.append(f'{a} overlaps {bn} by {ox:.0f}×{oy:.0f} px')
    return out

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(SETTINGS))
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_function('!!window.__apex', timeout=90000)
        await pg.wait_for_timeout(6000)
        print(await pg.evaluate(START))
        failed = 0
        for mode in MODES:
            if mode == 'hood':
                await pg.evaluate("(()=>{const g=__apex;g.rig.setMode(g.rig.modeIndex('Hood'));g.settings.mirror=true;return 1})()")
            for (w, h) in SIZES:
                await pg.set_viewport_size({'width': w, 'height': h})
                await pg.wait_for_timeout(900)
                await pg.evaluate(FILL)
                await pg.wait_for_timeout(700)
                m = json.loads(await pg.evaluate(MEASURE))
                if os.environ.get('DEBUG'): print(await pg.evaluate("[...document.querySelectorAll('#hud-lane > *')].map(e=>{const c=getComputedStyle(e);const r=e.getBoundingClientRect();return [c.display,c.opacity,c.visibility,e.hidden,r.width,r.height].join(',')}).join(' | ')"))
                bad = problems(m)
                shot = f'{OUT}{mode}-{w}x{h}.png'
                await pg.screenshot(path=shot)
                status = 'PASS' if not bad else 'FAIL'
                failed += bool(bad)
                print(f'{status}  {mode:5s} {w}×{h} (HUD scale {m["scale"].strip()}): {len(m["boxes"])} boxes' + ('' if not bad else '\n      ' + '\n      '.join(bad)))
        for e in errs:
            print('pageerror', e)
        await b.close()
        sys.exit(1 if failed else 0)

asyncio.run(main())
