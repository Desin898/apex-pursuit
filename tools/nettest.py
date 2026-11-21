# Dev helper: two headless browsers join the same relay room and race together.
import asyncio, json
from playwright.async_api import async_playwright
URL='http://localhost:8787/?room=t'
INFO="""(()=>{const g=window.__apex,o=g.online,r=g.race;return JSON.stringify({status:o.status,kind:o.transportKind,host:o.isHost,players:o.players.map(p=>p.name+(p.host?'*':'')),cars:r.cars.length,kinds:r.cars.map(c=>c.isPlayer?'P':c.remote?(c.netId.startsWith('ai')?'a':'R'):'A').join(''),paints:r.cars.map(c=>c.paint).join(''),grid:r.cars.map(c=>c.grid).join(''),cd:+r.countdown.toFixed(2),t:+r.time.toFixed(1),place:r.player.place,me:[+r.player.s.x.toFixed(1),+r.player.s.z.toFixed(1)],gone:r.cars.filter(c=>c.gone).length})})()"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--mute-audio'])
        pages=[]
        for i,name in enumerate(['Asha','Ben']):
            ctx = await b.new_context(viewport={'width':320,'height':180})
            await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps({'quality':'low','qualityChosen':True,'name':name,'paint':2}))
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e, n=name: print(n,'pageerror',e))
            pg.on('console', lambda m, n=name: print(n, m.type, m.text) if m.type=='error' else None)
            pages.append(pg)
        A,B=pages
        await A.goto(URL); await A.wait_for_function('!!window.__apex && __apex.screens.current==="home"', timeout=90000)
        await A.evaluate("__apex.screens.navs && 0"); await A.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await A.wait_for_timeout(4000)
        print('A alone   ', await A.evaluate(INFO))
        await B.goto(URL); await B.wait_for_function('!!window.__apex && __apex.screens.current==="home"', timeout=90000)
        await B.evaluate("document.querySelectorAll('.menu-item')[3].click()")
        await B.wait_for_timeout(6000)
        print('A with B  ', await A.evaluate(INFO))
        print('B joined  ', await B.evaluate(INFO))
        # skip drawing so both pages run at full speed in this software-rendered test
        for pg in (A,B): await pg.evaluate("__apex.post.render=()=>{}; __apex.car && 0")
        # drive both players with a simple follow-the-track autopilot injected through the input manager
        AUTO = """(()=>{const g=__apex; const orig=g.input.poll.bind(g.input); g.input.poll=(dt)=>{const a=orig(dt); const r=g.race, me=r.player, S=g.world.samples, N=S.length; const j=(me.trackIndex+Math.round((6+me.s.speed*0.4)/2))%N; const t=S[j]; let e=Math.atan2(t.x-me.s.x,t.z-me.s.z)-me.s.yaw; while(e>Math.PI)e-=2*Math.PI; while(e<-Math.PI)e+=2*Math.PI; let k=0; for(let q=0;q<60;q++)k=Math.max(k,Math.abs(S[(me.trackIndex+q)%N].curv)); const vmax=Math.min(80,Math.sqrt(GRIP/Math.max(k,1e-4))); a.steer=Math.max(-1,Math.min(1,-e*3)); a.analogSteer=true; a.throttle=me.s.speed<vmax?1:0; a.brake=me.s.speed>vmax+3?0.8:0; return a;}})()"""
        await A.evaluate(AUTO.replace('GRIP','10')); await B.evaluate(AUTO.replace('GRIP','9'))
        ida = await A.evaluate("__apex.online.transport.myId()"); idb = await B.evaluate("__apex.online.transport.myId()")
        for k in range(8):
            await A.wait_for_timeout(5000)
            ia=json.loads(await A.evaluate(INFO)); ib=json.loads(await B.evaluate(INFO))
            seenB = json.loads(await B.evaluate("""(id)=>{const r=__apex.race;const h=r.cars.find(c=>c.netId===id);return JSON.stringify({pos:[+h.s.x.toFixed(1),+h.s.z.toFixed(1)],v:+(h.s.speed*3.6).toFixed(0),order:r.cars.slice().sort((a,b)=>a.place-b.place).map(c=>c.isPlayer?'Ben':c.netId.startsWith('ai')?'ai'+c.netId.slice(3):c.netId===id?'Asha':'?').join(' ')})}""", ida))
            trueA = json.loads(await A.evaluate("""(()=>{const r=__apex.race;const s=r.player.s;return JSON.stringify({pos:[+s.x.toFixed(1),+s.z.toFixed(1)],v:+(s.speed*3.6).toFixed(0),order:r.cars.slice().sort((a,b)=>a.place-b.place).map(c=>c.isPlayer?'Asha':c.driver?'ai'+c.grid:'Ben').join(' '),fps:+__apex.fps.toFixed(0)})})()"""))
            err = ((seenB['pos'][0]-trueA['pos'][0])**2+(seenB['pos'][1]-trueA['pos'][1])**2)**0.5
            print(f"t={ia['t']:>5} fps={trueA['fps']} A at {trueA['pos']} {trueA['v']}km/h | B sees A at {seenB['pos']} (off by {err:.1f} m)")
            print('     A order:', trueA['order']); print('     B order:', seenB['order'])
        await A.close()
        await B.bring_to_front()
        await B.wait_for_timeout(9000)
        print('B after A left', await B.evaluate(INFO))
        await b.close()
asyncio.run(main())
