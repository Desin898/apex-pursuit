# Dev helper (4C.2): three players, the way friends at home would play.
#   Asha hosts (opens the relay's own link), Ben opens the same link, Cara runs the downloaded
#   single-file game and joins by pasting the link. Pursuit race, rain, dusk, 3 laps.
# Checks: lobby + Ready + Start, a late joiner waits instead of resetting the race, a friend who
# drops out mid-race is taken over by the AI, a wrong room password is refused, and a 150 ms
# delay on one player's connection still shows their car close to where it really is.
#
#   (cd dist && python3 -m http.server 8901) &  PORT=8787 node server/relay.mjs &
#   python3 tools/nettest.py
import asyncio, json, sys
from playwright.async_api import async_playwright

RELAY = 'http://localhost:8787/?room=t3'
FILE = 'http://localhost:8901/index.html'  # stands in for play/ApexPursuit.html (not served by the relay)
INFO = """(()=>{const g=__apex,o=g.online,r=g.race;return JSON.stringify({st:o.status,host:o.isHost,ph:o.phase,wait:o.waiting,ready:o.ready,
lobby:o.lobby.map(x=>x.name+(x.host?'*':'')+(x.ready?'+':'')+(x.waiting?'~':'')),kinds:r.cars.map(c=>c.isPlayer?'P':c.remote?(c.netId.startsWith('ai')?'a':'R'):'A').join(''),
cd:+r.countdown.toFixed(1),t:+r.time.toFixed(1),pz:!!r.pursuit,mirror:!!(r.pursuit&&r.pursuit.mirror),laps:r.targetLaps,w:g.env.conditions.weather,tod:g.env.conditions.time,
names:r.cars.map(c=>c.name).join(','),why:o.failReason})})()"""
FAILS = []

def check(ok, what):
    print(('  PASS ' if ok else '  FAIL ') + what)
    if not ok: FAILS.append(what)

async def player(b, name, extra=None):
    ctx = await b.new_context(viewport={'width': 400, 'height': 240})
    st = {'quality': 'low', 'qualityChosen': True, 'name': name, 'music': False, 'raceType': 'pursuit', 'weather': 'rain', 'timeOfDay': 'dusk', 'laps': 3, 'rivals': True}
    if extra: st.update(extra)
    await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(st))
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e, n=name: print(n, 'pageerror', e))
    return pg

async def boot(pg, url):
    await pg.goto(url)
    await pg.wait_for_function('!!window.__apex && __apex.screens.current==="home"', timeout=120000)
    await pg.evaluate("__apex.post.render=()=>{}")  # skip drawing: software rendering is slow here

async def info(pg):
    return json.loads(await pg.evaluate(INFO))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'])
        A = await player(b, 'Asha'); B = await player(b, 'Ben'); C = await player(b, 'Cara')

        print('1. Asha hosts from the relay link')
        await boot(A, RELAY)
        await A.wait_for_function("!document.getElementById('online-dlg').hidden", timeout=30000)
        check(True, 'the Online panel opens by itself on a race link')
        await A.click('#ol-joinhere')
        await A.wait_for_function("__apex.online.status==='online' && __apex.online.isHost && __apex.state==='playing'", timeout=60000)
        await A.wait_for_timeout(1500)
        a = await info(A); print('   A', a)
        check(a['ph'] == 'lobby' and a['cd'] > 4, 'new grid waits in the lobby before the lights')
        check(a['pz'] and not a['mirror'], 'host runs the police (pursuit race)')

        print('2. Ben opens the same link; Cara pastes the link into the downloaded game')
        await boot(B, RELAY)
        await B.wait_for_function("!document.getElementById('online-dlg').hidden", timeout=30000)
        await B.click('#ol-joinhere')
        await B.wait_for_function("__apex.online.status==='online' && __apex.state==='playing' && __apex.race.cars.some(c=>c.remote&&!c.netId.startsWith('ai'))", timeout=60000)
        await boot(C, FILE)
        await C.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await C.wait_for_function("!document.getElementById('online-dlg').hidden", timeout=10000)
        await C.fill('#ol-link', RELAY)
        await C.click('#ol-join')
        await C.wait_for_function("__apex.online.status==='online' && __apex.state==='playing' && __apex.race.cars.filter(c=>c.remote&&!c.netId.startsWith('ai')).length===2", timeout=60000)
        await C.wait_for_timeout(2500)
        a = await info(A); bb = await info(B); c = await info(C); print('   A', a); print('   B', bb); print('   C', c)
        check(len(a['lobby']) == 3 and len(bb['lobby']) == 3 and len(c['lobby']) == 3, 'all three see three players in the lobby')
        check(c['kinds'].count('P') == 1 and c['kinds'].count('R') == 2 and c['kinds'].count('a') == 5, 'Cara: her car, 2 friends, 5 AI (8 on the grid)')
        check(c['w'] == 'rain' and c['tod'] == 'dusk' and c['laps'] == 3, "Cara gets the host's rain, dusk, 3 laps")
        await B.evaluate("__apex.online.pressStart()")
        await A.wait_for_timeout(1200)
        a = await info(A)
        check(any(x.startswith('Ben') and '+' in x for x in a['lobby']) and a['ph'] == 'lobby', 'host sees Ben Ready; still waiting for Cara')
        await C.evaluate("__apex.online.pressStart()")
        await A.wait_for_function("__apex.online.phase==='race'", timeout=20000)
        check(True, 'everyone Ready: the race starts by itself')
        await A.wait_for_function("__apex.race.countdown<=0", timeout=30000)
        await B.wait_for_timeout(1500)
        bb = await info(B)
        check(bb['ph'] == 'race' and bb['cd'] <= 0.5, 'the guests are racing too')
        check(bb['mirror'], "guests see the host's police")

        # 4E: Air One: the host flies it and drops a charge; a guest sees both in the same place
        await A.evaluate("""(()=>{const p=__apex.race.pursuit,me=__apex.race.player,h=p.air.heli;p.joined=true;h.active=true;h.mode='chase';h.x=me.s.x+20;h.z=me.s.z;h.y=30;p.air.dropAhead(me,'charge',1,160);return 1})()""")
        await A.wait_for_timeout(1500)
        ha = json.loads(await A.evaluate("JSON.stringify({h:__apex.race.pursuit.heli.active,d:__apex.race.pursuit.air.drops.map(d=>[d.id,d.x,d.z,d.kind])})"))
        hb = json.loads(await B.evaluate("JSON.stringify({h:__apex.race.pursuit.heli.active,d:__apex.race.pursuit.air.drops.map(d=>[d.id,d.x,d.z,d.kind])})"))
        same = bool(ha['d']) and any(abs(x[1]-y[1]) < 0.2 and abs(x[2]-y[2]) < 0.2 and x[3] == y[3] for x in ha['d'] for y in hb['d'])
        check(hb['h'] and same, "a guest sees Air One and its drop where the host put it")

        # 150 ms extra delay on Ben's outgoing states, like a friend in another city
        await B.evaluate("""(()=>{const ws=__apex.online.transport.ws;const send=ws.send.bind(ws);ws.send=(m)=>setTimeout(()=>{try{send(m)}catch(e){}},150);})()""")
        AUTO = """(()=>{const g=__apex; const orig=g.input.poll.bind(g.input); g.input.poll=(dt)=>{const a=orig(dt); const r=g.race, me=r.player, S=g.world.samples, N=S.length; const j=(me.trackIndex+Math.round((6+me.s.speed*0.4)/2))%N; const t=S[j]; let e=Math.atan2(t.x-me.s.x,t.z-me.s.z)-me.s.yaw; while(e>Math.PI)e-=2*Math.PI; while(e<-Math.PI)e+=2*Math.PI; a.steer=Math.max(-1,Math.min(1,-e*3)); a.analogSteer=true; a.throttle=me.s.speed<26?1:0; return a;}})()"""
        for pg in (A, B, C): await pg.evaluate(AUTO)
        await A.wait_for_timeout(8000)
        idb = await B.evaluate("__apex.online.transport.myId()")
        seen = json.loads(await A.evaluate("(id)=>{const c=__apex.race.cars.find(c=>c.netId===id);return JSON.stringify([c.s.x,c.s.z])}", idb))
        true_ = json.loads(await B.evaluate("JSON.stringify([__apex.race.player.s.x,__apex.race.player.s.z])"))
        off = ((seen[0] - true_[0]) ** 2 + (seen[1] - true_[1]) ** 2) ** 0.5
        print(f'   Asha sees Ben {off:.1f} m from where he really is (150 ms extra delay, ~25 m/s)')
        check(off < 12, 'a laggy friend still shows close to where they are')
        rid = await A.evaluate("__apex.online.raceId")

        print('3. Ben drops out mid-race')
        await B.context.close()
        await A.wait_for_timeout(9000)
        a = await info(A); c = await info(C); print('   A', a); print('   C', c)
        check(a['kinds'].count('R') == 1 and 'Ben (AI)' in a['names'], "host: the AI took over Ben's car")
        check('Ben (AI)' in c['names'] and c['kinds'].count('R') == 1, "Cara sees Ben's car carry on as 'Ben (AI)'")
        ben_car = json.loads(await A.evaluate("JSON.stringify(__apex.race.cars.filter(c=>c.name==='Ben (AI)').map(c=>[+c.s.speed.toFixed(1), c.s.y>-10]))"))
        await A.wait_for_timeout(3000)
        ben_car2 = json.loads(await A.evaluate("JSON.stringify(__apex.race.cars.filter(c=>c.name==='Ben (AI)').map(c=>[+c.s.speed.toFixed(1), c.s.y>-10]))"))
        print('   Ben (AI) speed m/s:', ben_car, ben_car2)
        check(len(ben_car2) == 1 and ben_car2[0][1] and max(ben_car[0][0], ben_car2[0][0]) > 3, "Ben's car keeps driving")
        check(await A.evaluate("__apex.online.raceId") == rid, 'the race carried on (no reset)')

        print('4. Dev joins mid-race')
        D = await player(b, 'Dev')
        await boot(D, FILE)
        await D.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await D.fill('#ol-link', RELAY)
        await D.click('#ol-join')
        await D.wait_for_function("__apex.online.status==='online' && __apex.online.waiting", timeout=60000)
        await D.wait_for_timeout(2500)
        a = await info(A); d = await info(D); print('   A', a); print('   D', d)
        check(await A.evaluate("__apex.online.raceId") == rid and a['ph'] == 'race', 'the running race was not reset')
        check(d['wait'] and any('Dev' in x and '~' in x for x in a['lobby']), 'Dev waits for the next race')
        check(await D.evaluate("!document.getElementById('lobby').hidden"), 'Dev sees the waiting panel')

        print('5. A wrong room password is refused')
        F = await player(b, 'Fin')
        await boot(F, FILE)
        await F.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await F.fill('#ol-link', 'http://localhost:8787/?room=locked')
        await F.fill('#ol-pass', 'secret')
        await F.click('#ol-join')
        await F.wait_for_function("__apex.online.status==='online'", timeout=60000)
        E = await player(b, 'Eve')
        await boot(E, FILE)
        await E.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await E.fill('#ol-link', 'http://localhost:8787/?room=locked')
        await E.fill('#ol-pass', 'guess')
        await E.click('#ol-join')
        await E.wait_for_function("__apex.online.status==='unavailable'", timeout=60000)
        e = await info(E)
        check('password' in e['why'].lower(), f"wrong password refused: \"{e['why']}\"")
        check(await E.evaluate("!document.getElementById('online-dlg').hidden"), 'the Online panel comes back with the reason')

        await b.close()
    print('')
    print('ALL PASS' if not FAILS else f'{len(FAILS)} FAILED: ' + '; '.join(FAILS))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
