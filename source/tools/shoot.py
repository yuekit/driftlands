# Headless screenshot harness: python3 tools/shoot.py steps.json [W H] [query] [outdir]
# Runs dist/test.html in Chromium (SwiftShader), serves three.js locally, runs scripted steps, saves PNGs.
import sys, json, time, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
THREE_DIR = os.path.join(ROOT, 'node_modules/three/build')
steps = json.load(open(sys.argv[1]))
W = int(sys.argv[2]) if len(sys.argv) > 2 else 960
H = int(sys.argv[3]) if len(sys.argv) > 3 else 540
QUERY = sys.argv[4] if len(sys.argv) > 4 else ''
OUT = sys.argv[5] if len(sys.argv) > 5 else os.path.join(ROOT, 'shots')
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'), args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(path=os.path.join(THREE_DIR, r.request.url.split('/')[-1].replace('.min.js', '.js')), content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto('file://' + os.path.join(ROOT, os.environ.get('PAGE', 'dist/test.html')) + QUERY, timeout=120000)
    t = time.time()
    try:
        pg.wait_for_function('window.__dl && window.__dl.state==="title"', timeout=240000)
    except Exception as e:
        print('timeout waiting', e)
    print('ready in', round(time.time() - t, 1), 's')
    for s in steps:
        if s.get('js'):
            try: r = pg.evaluate(s['js'])
            except Exception as e: r = 'ERR ' + str(e)
            if r is not None: print(s.get('name', '-'), '->', r)
        if s.get('wait'): pg.wait_for_timeout(s['wait'])
        if s.get('name'):
            pg.screenshot(path=os.path.join(OUT, s['name'] + '.png'), timeout=240000)
            print('shot', s['name'], round(time.time() - t, 1), 's')
    print('\n'.join(logs[-40:]))
    b.close()
