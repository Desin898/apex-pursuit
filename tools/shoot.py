# Dev helper: load a local HTML page in headless Chrome (software WebGL) and run a JS snippet per screenshot.
import sys, json, asyncio
from playwright.async_api import async_playwright
async def main(url, shots, out_prefix, wait_expr='window.ready===true', size=(1280,720)):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':size[0],'height':size[1]})
        errs=[]
        pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
        await pg.goto(url)
        try:
            await pg.wait_for_function(wait_expr, timeout=60000)
        except Exception as e:
            errs.append(f'wait failed: {e}')
        for i,(js,delay) in enumerate(shots):
            if js: 
                try: await pg.evaluate(js)
                except Exception as e: errs.append(f'eval {i}: {e}')
            await pg.wait_for_timeout(delay)
            await pg.screenshot(path=f'{out_prefix}{i}.png')
        for e in errs[:40]: print(e)
        await b.close()
if __name__=='__main__':
    spec=json.load(open(sys.argv[1]))
    asyncio.run(main(spec['url'], spec['shots'], spec['out'], spec.get('wait','window.ready===true'), tuple(spec.get('size',[1280,720]))))
