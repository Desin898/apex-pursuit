# Dev helper (4F.1): Air One in a real online pursuit race, host + one guest over the relay.
# Both cars are driven by a simple bot. Records the helicopter every frame on both screens and
# checks that the guest sees it where the host has it, moving smoothly, and that it keeps up.
#
#   (cd dist && python3 -m http.server 8901) &  PORT=8787 node server/relay.mjs &
#   python3 tools/airtest.py [picture.png]
import asyncio, json, math, sys
from playwright.async_api import async_playwright

RELAY = 'http://localhost:8787/?room=air1'
SHOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/airtest.png'
FAILS = []

def check(ok, what):
    print(('  PASS ' if ok else '  FAIL ') + what)
    if not ok: FAILS.append(what)

async def player(b, name, quality, size):
    ctx = await b.new_context(viewport={'width': size[0], 'height': size[1]})
    st = {'quality': quality, 'qualityChosen': True, 'name': name, 'music': False, 'raceType': 'pursuit', 'weather': 'clear', 'timeOfDay': 'night', 'laps': 5, 'rivals': True, 'airSupport': 'heat3'}
    await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(st))
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e, n=name: print(n, 'pageerror', e))
    pg.on('console', lambda m, n=name: print(n, 'console', m.type, m.text[:300]) if m.type in ('error',) or 'THREE' in m.text and 'toNonIndexed' not in m.text else None)
    return pg

async def boot(pg):
    await pg.goto(RELAY)
    await pg.wait_for_function('!!window.__apex && __apex.screens.current==="home"', timeout=180000)
    await pg.evaluate("__apex.__render=__apex.post.render.bind(__apex.post); __apex.post.render=()=>{}")
    await pg.wait_for_function("!document.getElementById('online-dlg').hidden", timeout=30000)
    await pg.click('#ol-joinhere')

AUTO = """(()=>{const g=__apex; const orig=g.input.poll.bind(g.input); g.input.poll=(dt)=>{const a=orig(dt); const r=g.race, me=r.player, S=g.world.samples, N=S.length; const j=(me.trackIndex+Math.round((6+me.s.speed*0.45)/2))%N; const t=S[j]; let e=Math.atan2(t.x-me.s.x,t.z-me.s.z)-me.s.yaw; while(e>Math.PI)e-=2*Math.PI; while(e<-Math.PI)e+=2*Math.PI; a.steer=Math.max(-1,Math.min(1,-e*3)); a.analogSteer=true; const k=S[(me.trackIndex+20)%N]; const bend=Math.abs(Math.atan2(k.tx,k.tz)-Math.atan2(t.tx,t.tz)); a.throttle=me.s.speed<(bend>0.25?24:36)?1:0; a.brake=me.s.speed>(bend>0.25?30:44)?1:0; return a;}})()"""

# every frame: wall clock, the helicopter (sim) and, on screen, the model's position
REC = """(()=>{window.__hl=[];const g=__apex;const f=()=>{const h=g.race.pursuit&&g.race.pursuit.heli;if(h&&h.active){const me=g.race.player;window.__hl.push([Date.now(),h.x,h.y,h.z,h.lx,h.lz,h.mode,me.s.x,me.s.z,me.s.speed,h.tactic,me.s.yaw,(p=>p&&p.target?[p.target.s.x,p.target.s.z,p.target.name]:0)(g.race.pursuit.air)]);}if(window.__hl.length<20000)requestAnimationFrame(f)};requestAnimationFrame(f);return 1})()"""

def at(log, t):
    # host position at wall time t (linear between frames)
    for i in range(1, len(log)):
        if log[i][0] >= t:
            a, b = log[i - 1], log[i]
            u = 0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
            return [a[k] + (b[k] - a[k]) * u for k in (1, 2, 3, 4, 5)]
    return None

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        A = await player(b, 'Host', 'low', (400, 240))
        B = await player(b, 'Guest', 'medium', (960, 540))
        print('1. host and guest join, night pursuit race')
        await boot(A)
        await A.wait_for_function("__apex.online.status==='online' && __apex.online.isHost && __apex.state==='playing'", timeout=60000)
        await boot(B)
        await B.wait_for_function("__apex.online.status==='online' && __apex.state==='playing' && __apex.race.cars.some(c=>c.remote&&!c.netId.startsWith('ai'))", timeout=90000)
        await B.evaluate("__apex.online.pressStart()")
        await A.evaluate("__apex.online.pressStart()")
        await A.wait_for_function("__apex.online.phase==='race' && __apex.race.countdown<=0", timeout=60000)
        for pg in (A, B): await pg.evaluate(AUTO)
        print('2. Heat 3.4: Air One comes')
        await A.evaluate("(()=>{const p=__apex.race.pursuit;p.joined=true;p.heat=3.4;return 1})()")
        await A.wait_for_function("__apex.race.pursuit.heli.mode==='chase'", timeout=60000)
        await B.wait_for_function("__apex.race.pursuit.heli.active", timeout=20000)
        # no smoke screens in the way of the picture at the end
        await A.evaluate("(()=>{const a=__apex.race.pursuit.air;a.dropsOn=false;return 1})()")
        for pg in (A, B): await pg.evaluate(REC)
        await A.wait_for_timeout(22000)
        la = json.loads(await A.evaluate("JSON.stringify(window.__hl)"))
        lb = json.loads(await B.evaluate("JSON.stringify(window.__hl)"))
        print(f'   frames recorded: host {len(la)}, guest {len(lb)}')

        # where the guest shows it vs where the host has it at the same moment
        offs = []
        for r in lb:
            h = at(la, r[0])
            if h: offs.append(math.dist(h[:3], r[1:4]))
        offs.sort()
        mean = sum(offs) / max(1, len(offs)); p95 = offs[int(len(offs) * 0.95)] if offs else 99
        print(f'   guest vs host position: mean {mean:.1f} m, 95% within {p95:.1f} m')
        check(len(offs) > 50 and p95 < 9, 'the guest sees Air One where the host has it')

        # smoothness on the guest: how much the step from one frame to the next changes
        def jumps(log):
            v = []
            for i in range(1, len(log)):
                dt = (log[i][0] - log[i - 1][0]) / 1000
                if dt <= 0: continue
                v.append((math.dist(log[i][1:4], log[i - 1][1:4]) / dt, dt))
            sp = [x[0] for x in v]
            mean_sp = sum(sp) / max(1, len(sp))
            # steps more than twice or less than half the average speed: a stutter
            bad = sum(1 for s in sp if mean_sp > 5 and (s > mean_sp * 2 or s < mean_sp * 0.5))
            return mean_sp, bad / max(1, len(sp))
        # frame times here are uneven (software rendering), so the host's own figure is the yardstick
        hs, hb = jumps(la); gs, gb = jumps(lb)
        print(f'   speed host {hs * 3.6:.0f} km/h, guest {gs * 3.6:.0f} km/h; uneven frames host {hb * 100:.1f}%, guest {gb * 100:.1f}%')
        check(gb < hb * 1.5 + 0.02, 'Air One moves as smoothly on the guest as on the host')

        # keeping up with the car it chases (on the host)
        json.dump({'host': la, 'guest': lb}, open('/tmp/airtest-log.json', 'w'))
        # (the first seconds are its arrival from 150 m out)
        t0 = next((r[0] for r in la if r[6] == 'chase'), 0) + 6000
        d = [math.hypot(r[1] - r[7], r[3] - r[8]) for r in la if r[6] == 'chase' and r[0] > t0]
        # how far behind the car it is (ahead of it, on a low pass, doesn't count as falling behind)
        # (Air One may chase either player: measured from the car it's after)
        back = [-((r[1] - r[12][0]) * math.sin(r[11]) + (r[3] - r[12][1]) * math.cos(r[11])) for r in la if r[6] == 'chase' and r[0] > t0 and r[12]]
        d = [math.hypot(r[1] - r[12][0], r[3] - r[12][1]) for r in la if r[6] == 'chase' and r[0] > t0 and r[12]]
        print('   chasing:', sorted(set(r[12][2] for r in la if r[12])))
        tac = {}
        for r in la:
            if r[6] == 'chase' and r[0] > t0: tac[r[10]] = tac.get(r[10], 0) + 1
        print('   what it did:', ', '.join(f'{k} {v * 100 // max(1, len(d))}%' for k, v in tac.items()))
        cs = sum(r[9] for r in la) / max(1, len(la))
        if d:
            print(f'   chasing at {cs * 3.6:.0f} km/h: Air One {sum(d) / len(d):.0f} m from the car on average, at most {max(d):.0f} m')
        if d:
            ds = sorted(d)
            print(f'   after its arrival: 95% of the time within {ds[int(len(ds) * 0.95)]:.0f} m')
            bs = sorted(back)
            print(f'   behind the car: 95% of the time less than {bs[int(len(bs) * 0.95)]:.0f} m (worst {bs[-1]:.0f} m)')
        check(bool(d) and sorted(back)[int(len(back) * 0.95)] < 60, 'Air One keeps up with the car in a real race')
        beam = [math.hypot(r[4] - r[12][0], r[5] - r[12][1]) for r in la if r[6] == 'chase' and r[12]]
        if beam: print(f'   searchlight on the car: mean {sum(beam) / len(beam):.1f} m off')

        print('3. a picture from the guest')
        # looking past the car Air One is chasing (the host's, on the guest's screen) up at it
        await B.evaluate("""(()=>{const g=__apex;g.post.render=g.__render;window.__follow=true;const f=()=>{if(!window.__follow)return;const h=g.race.pursuit.heli,me=g.race.cars.find(c=>c.remote&&!c.netId.startsWith('ai'))||g.race.player;
          const dx=h.x-me.s.x,dz=h.z-me.s.z,d=Math.hypot(dx,dz)||1;
          g.shotCam=[me.s.x-dx/d*16,me.s.y+3,me.s.z-dz/d*16,h.x*0.6+me.s.x*0.4,h.y*0.55,h.z*0.6+me.s.z*0.4,62];requestAnimationFrame(f)};f();return 1})()""")
        await B.wait_for_timeout(2500)
        print('   guest view:', await B.evaluate("""(()=>{const g=__apex,v=g.pview.heli,h=g.race.pursuit.heli,c=g.rig.camera;const p=v.root.position.clone().project(c);
          return JSON.stringify({vis:v.root.visible,cone:v.cone.visible,root:[v.root.position.x|0,v.root.position.y|0,v.root.position.z|0],sim:[h.x|0,h.y|0,h.z|0],cam:[c.position.x|0,c.position.y|0,c.position.z|0],scr:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(3)],inScene:!!v.root.parent,shot:g.shotCam&&g.shotCam.map(x=>x|0)})})()"""))
        await B.screenshot(path=SHOT)
        print('   saved', SHOT)
        if len(sys.argv) > 2:
            print('   debug:', await B.evaluate("""(()=>{const g=__apex,v=g.pview.heli,r=g.renderer;const calls=()=>{g.post.render(g.time,0,0,0);return r.info.render.calls};
              const a=calls();v.root.visible=false;const b=calls();v.root.visible=true;
              let mats=[];v.root.traverse(o=>{if(o.isMesh)mats.push([o.name||o.material.type,o.material.visible,o.material.opacity,o.frustumCulled,o.layers.mask])});
              return JSON.stringify({withHeli:a,without:b,mats:mats.slice(0,8),mw:v.root.matrixWorld.elements.slice(12,15).map(x=>x|0),comp:!!g.post.composer})})()"""))
            await B.evaluate("""(()=>{const g=__apex;window.__follow=false;const h=g.race.pursuit.heli;g.shotCam=[h.x+14,h.y-4,h.z+14,h.x,h.y,h.z,55];return 1})()""")
            await B.wait_for_timeout(1500)
            await B.screenshot(path=SHOT.replace('.png', '-close.png'))
        await b.close()
    print('\nALL PASS' if not FAILS else f'\n{len(FAILS)} FAILED: ' + '; '.join(FAILS))

asyncio.run(main())
