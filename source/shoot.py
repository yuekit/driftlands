import sys, json, time
from playwright.sync_api import sync_playwright
OUT='/tmp/claude-0/-home-claude/a100ae81-7318-51f4-8687-2d3f996ace22/scratchpad/shots/'
THREE='/home/claude/driftlands/node_modules/three/build/three.module.min.js'
shots=json.load(open(sys.argv[1]))
W=int(sys.argv[2]) if len(sys.argv)>2 else 960; H=int(sys.argv[3]) if len(sys.argv)>3 else 540
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'])
    pg=b.new_page(viewport={'width':W,'height':H})
    logs=[]
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f"[pageerror] {e} {getattr(e,"stack","")}"))
    pg.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=THREE, content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto('file:///home/claude/driftlands/dist/test.html' + (sys.argv[4] if len(sys.argv) > 4 else ''))
    t=time.time()
    try:
        pg.wait_for_function('window.__dl && window.__dl.state==="title"', timeout=180000)
    except Exception as e:
        print('timeout waiting', e)
    print('ready in', round(time.time()-t,1),'s')
    for s in shots:
        if s.get('js'):
            try: r=pg.evaluate(s['js']); 
            except Exception as e: r=str(e)
            if r is not None: print(s.get('name'),'->',r)
        if s.get('wait'): pg.wait_for_timeout(s['wait'])
        if s.get('name'):
            pg.screenshot(path=OUT+s['name']+'.png', timeout=180000)
    print('\n'.join(logs[-40:]))
    b.close()
