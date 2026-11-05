"""
Prueba de humo end-to-end de FIT20 SIN conexión (Playwright + Chrome).

Recorre todos los módulos como lo haría una persona: onboarding, plan de entrenamiento,
sesión de fuerza, carrera manual, nutrición, plan de alimentación, progreso y perfil.
Simula una sesión iniciada (no toca Supabase: todas las llamadas a *.supabase.co se bloquean)
y verifica que todo quede guardado en el dispositivo, en la cola de sincronización.

Uso:
    npm run build && npx vite preview --port 4174 &
    python3 scripts/e2e_smoke.py [carpeta-capturas]

Requiere: pip install playwright && playwright install chromium (o Chrome en /usr/bin/google-chrome).
"""
import base64
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-shots'
BASE = os.environ.get('BASE', 'http://localhost:4174')
UID = '22222222-2222-4222-8222-222222222222'
STORAGE_KEY = os.environ.get('SB_KEY', 'sb-krlhvdrrjqioohucqmfz-auth-token')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
os.makedirs(OUT, exist_ok=True)


def b64(o):
    return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')


exp = int(time.time()) + 86400 * 30
jwt = b64({'alg': 'HS256', 'typ': 'JWT'}) + '.' + b64({'sub': UID, 'exp': exp, 'role': 'authenticated', 'email': 'demo@fit20.app'}) + '.sig'
session = {
    'access_token': jwt, 'refresh_token': 'x', 'token_type': 'bearer', 'expires_in': 86400 * 30, 'expires_at': exp,
    'user': {'id': UID, 'email': 'demo@fit20.app', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-11-05T00:00:00Z'},
}

errors = []
steps = []


def step(name):
    steps.append(name)
    print('·', name, flush=True)


with sync_playwright() as p:
    kw = {'executable_path': CHROME} if os.path.exists(CHROME) else {}
    browser = p.chromium.launch(args=['--no-sandbox'], **kw)
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='es-AR', timezone_id='America/Buenos_Aires',
                              service_workers='block')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and 'ERR_' not in m.text and 'Failed to fetch' not in m.text and errors.append(m.text))
    page.route('**/*.supabase.co/**', lambda r: r.abort())
    shot = lambda n: page.screenshot(path=f'{OUT}/{n}.png', full_page=True)
    wait = page.wait_for_timeout

    step('login visible')
    page.goto(BASE + '/login'); wait(800); shot('01-login')
    page.evaluate('([k,v]) => localStorage.setItem(k, v)', [STORAGE_KEY, json.dumps(session)])
    page.goto(BASE + '/'); wait(9500)

    step('onboarding')
    page.get_by_role('button', name='Continuar sin conexión').click(); wait(400)
    page.get_by_label('Nombre').fill('Lau Fernández')
    page.get_by_label('Fecha de nacimiento').fill('1995-03-10')
    page.get_by_label('Altura').fill('178')
    page.get_by_label('Peso actual').fill('82,4')
    page.get_by_label('Peso objetivo (opcional)').fill('77')
    page.get_by_role('button', name='Continuar').click(); wait(300)
    page.get_by_role('radio', name='Recomposición').click()
    page.get_by_role('button', name='Continuar').click(); wait(300)
    page.get_by_role('radio', name='Intermedio').click()
    page.get_by_role('radio', name='Corro a veces').click()
    page.get_by_role('button', name='Continuar').click(); wait(300)
    for d in ['Martes', 'Jueves', 'Domingo', 'Sábado']:
        page.get_by_role('button', name=d).click()  # todos los días menos ninguno: lun-dom
    page.get_by_role('button', name='Continuar').click(); wait(300)
    page.get_by_role('button', name='Mancuernas').click()
    page.get_by_role('button', name='Continuar').click(); wait(300)
    page.get_by_role('button', name='Continuar').click(); wait(300)
    page.get_by_role('button', name='Empezar').click(); wait(1500)
    shot('02-inicio')

    step('plan de entrenamiento')
    page.get_by_role('link', name='Entrenar').first.click(); wait(500)
    page.get_by_role('link', name='Crear mi plan').click(); wait(500)
    page.get_by_role('button', name='Crear plan de 30 días').click(); wait(1500)
    shot('03-plan')

    step('sesión de fuerza o carrera de hoy')
    page.locator('a[href^="/entrenar/dia/"]').first.click(); wait(600)
    if page.get_by_role('button', name='Empezar sesión').count():
        page.get_by_role('button', name='Empezar sesión').click(); wait(300)
        page.get_by_role('button', name='Continuar').click(); wait(800)
        if page.get_by_role('button', name='Empezar').count():
            page.get_by_role('button', name='Empezar').click(); wait(800)
        page.get_by_label('Registrar serie 1').click(); wait(500)
        page.get_by_role('button', name='Terminar ahora').click(); wait(300)
        page.get_by_role('button', name='7', exact=True).click()
        page.get_by_role('button', name='Guardar entrenamiento').click(); wait(1200)
    shot('04-sesion')

    step('carrera manual')
    page.goto(BASE + '/running/manual'); wait(1000)
    page.get_by_label('Distancia').fill('5,2')
    page.get_by_label('Tiempo').fill('27:45')
    page.get_by_role('button', name='Guardar').click(); wait(1200)
    shot('05-carrera')

    step('nutrición y plan de alimentación')
    page.goto(BASE + '/nutricion'); wait(1000)
    page.get_by_role('button', name='+ 500 ml').click(); wait(300)
    page.get_by_role('link', name='Plan de alimentación').click(); wait(600)
    page.get_by_role('button', name='Armar mi semana').click(); wait(1500)
    page.get_by_role('button', name='Lo comí').first.click(); wait(800)
    shot('06-plan-comidas')

    step('progreso')
    page.goto(BASE + '/progreso/medir'); wait(800)
    page.get_by_label('Peso').fill('81,9')
    page.get_by_role('button', name='Guardar', exact=True).click(); wait(800)
    shot('07-progreso')

    step('inicio con "Para hoy" y perfil')
    page.goto(BASE + '/'); wait(1500)
    shot('08-inicio-final')
    page.goto(BASE + '/perfil'); wait(1000)
    shot('09-perfil')

    counts = page.evaluate("""() => new Promise(res => { const r = indexedDB.open('fit20-%s'); r.onsuccess = () => {
        const t = r.result.transaction('outbox').objectStore('outbox').getAll();
        t.onsuccess = () => { const c = {}; t.result.forEach(o => c[o.entity] = (c[o.entity]||0)+1); res(c); }; }; })""" % UID)
    browser.close()

print('\nCola de sincronización:', counts)
expected = ['profiles', 'user_settings', 'training_plans', 'training_days', 'running_sessions', 'water_logs', 'meal_plan_days', 'food_logs', 'body_measurements']
missing = [e for e in expected if e not in counts]
if errors or missing:
    print('ERRORES:', errors[:10], 'FALTAN:', missing)
    sys.exit(1)
print('OK:', len(steps), 'pasos sin errores')
