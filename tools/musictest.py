# Dev helper (4G.2): online music follows the host.
# Host and two friends over the relay. Each gets a small library of short generated tracks:
#   Host: "Six Days" and "Night Dancer"; Ben: "Six Days" (a different file, same song);
#   Cara: nothing. Checks that Ben plays the host's track in time, that a track Ben doesn't
#   have leaves him quiet (and says what's playing), that Cara stays quiet, that a stop on the
#   host stops Ben, and that "Everyone plays their own" gives Ben his own music back.
#
#   PORT=8787 node server/relay.mjs &   python3 tools/musictest.py
import asyncio, json
from playwright.async_api import async_playwright

RELAY = 'http://localhost:8787/?room=mus1'
FAILS = []

def check(ok, what):
    print(('  PASS ' if ok else '  FAIL ') + what)
    if not ok: FAILS.append(what)

# a quiet tone as a WAV file, `secs` long, so <audio> has something real to play and seek
LIB = """((list)=>{const g=__apex,m=g.music;
  const wav=(secs,hz)=>{const sr=8000,n=sr*secs,b=new ArrayBuffer(44+n*2),v=new DataView(b);const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
    w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i*hz*6.283/sr)*800,true);return URL.createObjectURL(new Blob([b],{type:'audio/wav'}))};
  m.tracks=list.map(([id,title,artist,hz])=>({id,title,artist,album:'',dur:90,cover:'',src:wav(90,hz),source:'mine'}));
  m.off.clear();m.state='stopped';m.unlock(false);return m.tracks.length})"""

STATE = "JSON.stringify((m=>({t:m.current&&m.current.title,id:m.current&&m.current.id,st:m.state,pos:+m.position.toFixed(2),f:m.followingHost,miss:m.hostMissing}))(__apex.music))"

async def player(b, name, extra=None):
    ctx = await b.new_context(viewport={'width': 400, 'height': 240})
    st = {'quality': 'low', 'qualityChosen': True, 'name': name, 'music': False, 'raceType': 'circuit', 'weather': 'clear', 'timeOfDay': 'dusk', 'laps': 5, 'rivals': True}
    if extra: st.update(extra)
    await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(st))
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e, n=name: print(n, 'pageerror', e))
    return pg

async def join(pg):
    await pg.goto(RELAY)
    await pg.wait_for_function('!!window.__apex && __apex.screens.current==="home"', timeout=180000)
    await pg.evaluate("__apex.post.render=()=>{}")
    await pg.wait_for_function("!document.getElementById('online-dlg').hidden", timeout=30000)
    await pg.click('#ol-joinhere')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'])
        A = await player(b, 'Host'); B = await player(b, 'Ben'); C = await player(b, 'Cara')
        print('1. three players join')
        await join(A)
        await A.wait_for_function("__apex.online.status==='online' && __apex.online.isHost", timeout=60000)
        await join(B)
        await B.wait_for_function("__apex.online.status==='online' && !__apex.online.isHost", timeout=90000)
        await join(C)
        await C.wait_for_function("__apex.online.status==='online' && !__apex.online.isHost", timeout=90000)
        await A.evaluate(LIB + "([['pk-01','Six Days','DJ Shadow',220],['pk-14','Night Dancer','imase',330]])")
        await B.evaluate(LIB + "([['mine-77','Six Days (Remix)','DJ Shadow',220],['mine-80','Some Other Song','Ben Band',440]])")
        await C.evaluate(LIB + "([])")

        print('2. the host plays "Six Days" from 20 s in')
        await A.evaluate("(()=>{const m=__apex.music;m.playTrack('pk-01');const a=m.audio;const go=()=>{a.currentTime=20};a.readyState>=1?go():a.addEventListener('loadedmetadata',go,{once:true});return 1})()")
        await A.wait_for_timeout(4000)
        a = json.loads(await A.evaluate(STATE)); bb = json.loads(await B.evaluate(STATE)); c = json.loads(await C.evaluate(STATE))
        print('   host', a); print('   ben ', bb); print('   cara', c)
        check(bb['f'] and bb['t'] == 'Six Days (Remix)' and bb['st'] == 'playing', 'Ben plays the same song from his own library (matched by title and artist)')
        check(abs(bb['pos'] - a['pos']) < 1.5, f"…and in time with the host ({abs(bb['pos'] - a['pos']):.2f} s apart)")
        check(c['f'] and c['st'] != 'playing' and 'Six Days' in c['miss'], "Cara doesn't have it: quiet, and she's told what the host is playing")

        print('3. Ben tries to skip')
        await B.evaluate("__apex.music.next()")
        bb = json.loads(await B.evaluate(STATE))
        check(bb['t'] == 'Six Days (Remix)', 'his skip waits: the host picks the music')

        print('4. the host plays a track Ben doesn\'t have')
        await A.evaluate("__apex.music.playTrack('pk-14')")
        await A.wait_for_timeout(2500)
        bb = json.loads(await B.evaluate(STATE)); print('   ben ', bb)
        check(bb['st'] != 'playing' and 'Night Dancer' in bb['miss'], 'Ben goes quiet and sees "Night Dancer · imase, not in your music"')

        print('5. back to "Six Days", then the host stops the music')
        await A.evaluate("__apex.music.playTrack('pk-01')")
        await A.wait_for_timeout(2500)
        bb = json.loads(await B.evaluate(STATE))
        check(bb['st'] == 'playing' and bb['t'] == 'Six Days (Remix)', 'Ben picks it up again')
        await A.evaluate("__apex.music.toggle()")
        await A.wait_for_timeout(2000)
        bb = json.loads(await B.evaluate(STATE))
        check(bb['st'] != 'playing', 'the host stops: Ben stops')

        print('6. Ben switches to "Everyone plays their own"')
        await A.evaluate("__apex.music.toggle()")
        await A.wait_for_timeout(1500)
        await B.evaluate("(()=>{__apex.settings.onlineMusic='mine';__apex.music.unlock(true);return 1})()")
        await B.wait_for_timeout(1500)
        await B.evaluate("__apex.music.state==='playing'||__apex.music.next()")
        await B.wait_for_timeout(1000)
        bb = json.loads(await B.evaluate(STATE)); print('   ben ', bb)
        check(not bb['f'] and bb['st'] == 'playing', 'Ben plays his own music again')

        # how much the music adds to the host's messages
        size = await A.evaluate("JSON.stringify([...(__apex.online.transport.lastSent?[__apex.online.transport.lastSent]:[])]).length")
        mu = await A.evaluate("JSON.stringify(['pk-01','Six Days','DJ Shadow',123.4,1]).length")
        print(f'   music adds {mu} bytes to each host update')
        await b.close()
    print('\nALL PASS' if not FAILS else f'\n{len(FAILS)} FAILED: ' + '; '.join(FAILS))

asyncio.run(main())
