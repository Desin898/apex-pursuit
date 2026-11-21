# Dev helper: drive the built game in headless Chrome (software WebGL) and save screenshots.
# usage: python3 tools/playtest.py <script.json>
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright

async def main(spec):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--autoplay-policy=no-user-gesture-required','--mute-audio'])
        ctx = await b.new_context(viewport={'width':spec.get('w',1280),'height':spec.get('h',720)})
        settings = spec.get('settings', {'quality':'high','qualityChosen':True})
        await ctx.add_init_script("try{localStorage.setItem('apex-pursuit-settings-v1', JSON.stringify(%s))}catch(e){}" % json.dumps(settings))
        if spec.get('init'): await ctx.add_init_script(spec['init'])
        pg = await ctx.new_page()
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and 'GPU stall' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        if spec.get('mirror_cdn'):
            root = pathlib.Path('node_modules/three')
            async def handle(route):
                url = route.request.url
                rel = url.split('/npm/three@')[1].split('/',1)[1]
                f = root/rel
                if f.exists(): await route.fulfill(body=f.read_bytes(), content_type='text/javascript')
                else: await route.abort()
            await pg.route('https://cdn.jsdelivr.net/**', handle)
            await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.goto(spec['url'])
        try: await pg.wait_for_function('!!window.__apex', timeout=90000)
        except Exception as e: logs.append(f'boot wait failed: {e}')
        n=0
        for step in spec['steps']:
            op = step[0]
            try:
                if op=='wait': await pg.wait_for_timeout(step[1])
                elif op=='down': await pg.keyboard.down(step[1])
                elif op=='up': await pg.keyboard.up(step[1])
                elif op=='press': await pg.keyboard.press(step[1])
                elif op=='js': 
                    r = await pg.evaluate(step[1])
                    if r is not None: print('js →', r)
                elif op=='shot':
                    await pg.screenshot(path=f"{spec['out']}{n}.png"); n+=1
                elif op=='click': await pg.mouse.click(step[1], step[2])
            except Exception as e: logs.append(f'step {step}: {e}')
        for l in logs[:40]: print(l)
        await b.close()
asyncio.run(main(json.load(open(sys.argv[1]))))
