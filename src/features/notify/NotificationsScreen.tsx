import { ArrowLeft, Bell, BellOff, CloudSun, MapPin, Send, Share, Smartphone } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBox, SectionTitle, Spinner, Toggle, cx } from '@/components/ui';
import { enableWeather, useWeather } from '@/features/weather/store';
import {
  DEFAULT_PREFS,
  type NotificationPrefs,
  currentSubscription,
  disablePush,
  enablePush,
  loadPrefs,
  localTimezone,
  markPushOn,
  permission,
  pushSupport,
  savePrefs,
  sendTest,
} from './push';

type Status = 'loading' | 'off' | 'on';

export function NotificationsScreen() {
  const support = pushSupport();
  const weather = useWeather();
  const [status, setStatus] = useState<Status>('loading');
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'test'>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const sub = await currentSubscription();
      const p = await loadPrefs().catch((e: Error) => {
        if (!cancel) setError(e.message);
        return null;
      });
      if (cancel) return;
      setStatus(sub && permission() === 'granted' ? 'on' : 'off');
      markPushOn(!!sub);
      setPrefs(p ?? { ...DEFAULT_PREFS, timezone: localTimezone() });
    })();
    return () => {
      cancel = true;
    };
  }, []);

  function update(patch: Partial<NotificationPrefs>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setNote(null);
    if (status !== 'on') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePrefs(next)
        .then(() => {
          setError(null);
          setNote('Guardado');
        })
        .catch((e: Error) => setError(e.message));
    }, 500);
  }

  async function onEnable() {
    setBusy('enable');
    setError(null);
    try {
      await enablePush();
      if (prefs) await savePrefs({ ...prefs, timezone: localTimezone(), ...(weather.coords ?? {}) });
      markPushOn(true);
      setStatus('on');
      setNote('¡Listo! Te van a llegar los avisos en este dispositivo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onDisable() {
    setBusy('disable');
    setError(null);
    try {
      await disablePush();
      markPushOn(false);
      setStatus('off');
      setNote('Desactivadas en este dispositivo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy('test');
    setError(null);
    setNote(null);
    try {
      const r = await sendTest();
      setNote(r.delivered ? 'Enviada: en unos segundos te llega.' : 'No hay dispositivos activos para recibirla.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onWeatherLocation() {
    await enableWeather();
  }

  // Cuando se activa la ubicación del clima con los avisos encendidos, guardarla.
  useEffect(() => {
    if (status === 'on' && prefs && weather.coords && (prefs.lat !== weather.coords.lat || prefs.lon !== weather.coords.lon)) update({ lat: weather.coords.lat, lon: weather.coords.lon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather.coords, status]);

  if (status === 'loading' || !prefs) return <Spinner />;
  const on = status === 'on';

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      <Link to="/perfil" className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start px-2 text-[14px] text-muted">
        <ArrowLeft className="size-4" aria-hidden /> Perfil
      </Link>
      <h1 className="text-[26px] font-bold tracking-tight">Notificaciones</h1>

      <section className={cx('rounded-3xl p-5', on ? 'border border-line bg-surface' : 'bg-accent text-accent-ink')}>
        <div className="flex items-start gap-3">
          <span className={cx('grid size-11 shrink-0 place-items-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-accent-ink/10')}>
            {on ? <Bell className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold">{on ? 'Activas en este dispositivo' : 'Recibí tus avisos'}</p>
            <p className={cx('mt-0.5 text-[14px]', on ? 'text-muted' : 'opacity-75')}>
              {on ? 'Te llegan aunque la app esté cerrada.' : 'Qué te toca entrenar hoy, con el clima, y un recordatorio si no llegaste a hacerlo. Te llegan aunque la app esté cerrada.'}
            </p>
          </div>
        </div>
        <DeviceAction support={support} on={on} busy={busy} onEnable={onEnable} onDisable={onDisable} />
      </section>

      {error && <ErrorBox>{error}</ErrorBox>}
      {note && !error && (
        <p role="status" className="rounded-2xl bg-ok/10 px-4 py-3 text-[14px] text-ok">
          {note}
        </p>
      )}

      <Card className={cx(!on && 'opacity-60')}>
        <SectionTitle>Qué avisos</SectionTitle>
        <fieldset disabled={!on} className="flex flex-col gap-2">
          <Toggle label="Aviso de la mañana" description="La sesión de hoy y cómo va a estar el día" checked={prefs.morning_enabled} onChange={(v) => update({ morning_enabled: v })} />
          {prefs.morning_enabled && <TimeRow label="Hora del aviso" value={prefs.morning_time} onChange={(v) => update({ morning_time: v })} />}
          <div className="my-1 h-px bg-line" />
          <Toggle label="Recordatorio si no entrenaste" description="Solo si la sesión del día sigue pendiente" checked={prefs.evening_enabled} onChange={(v) => update({ evening_enabled: v })} />
          {prefs.evening_enabled && <TimeRow label="Hora del recordatorio" value={prefs.evening_time} onChange={(v) => update({ evening_time: v })} />}
          <div className="my-1 h-px bg-line" />
          <Toggle label="Incluir el clima" description="Temperatura, lluvia, mejor hora para salir y consejos" checked={prefs.include_weather} onChange={(v) => update({ include_weather: v })} />
        </fieldset>
        {on && prefs.include_weather && !weather.coords && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-raised p-3">
            <CloudSun className="size-5 shrink-0 text-muted" aria-hidden />
            <p className="flex-1 text-[13px] text-muted">{weather.status === 'denied' ? 'Sin permiso de ubicación: activalo en los ajustes del navegador.' : 'Para el clima necesitamos tu zona (aproximada, ~1 km).'}</p>
            <button type="button" onClick={() => void onWeatherLocation()} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-[13px] font-semibold text-accent-ink">
              <MapPin className="size-3.5" aria-hidden /> Usar mi zona
            </button>
          </div>
        )}
        <p className="mt-3 text-[12px] text-faint">Zona horaria: {prefs.timezone}. Pueden llegar hasta 15 minutos después de la hora elegida.</p>
      </Card>

      {on && (
        <Button variant="secondary" loading={busy === 'test'} onClick={() => void onTest()}>
          <Send className="size-4" aria-hidden /> Enviarme una de prueba
        </Button>
      )}
    </div>
  );
}

function TimeRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 pl-1">
      <span className="text-[14px] text-muted">{label}</span>
      <input
        type="time"
        step={300}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="num min-h-11 rounded-xl border border-line bg-raised px-3 text-[16px] font-semibold text-ink focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function DeviceAction({ support, on, busy, onEnable, onDisable }: { support: ReturnType<typeof pushSupport>; on: boolean; busy: string | null; onEnable: () => void; onDisable: () => void }) {
  let hint: ReactNode = null;
  if (support === 'ios-needs-install') {
    hint = (
      <span className="flex items-start gap-2">
        <Share className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>En iPhone las notificaciones funcionan con la app instalada: tocá Compartir → «Agregar a inicio», abrí FIT 20 desde el ícono y volvé acá.</span>
      </span>
    );
  } else if (support === 'unsupported') hint = 'Este navegador no permite notificaciones push. Probá con Chrome, Edge, Firefox o Safari actualizado.';
  else if (support === 'dev') hint = 'Las notificaciones funcionan en la versión publicada (no en modo desarrollo).';
  else if (permission() === 'denied') hint = 'Las notificaciones están bloqueadas para este sitio: habilitalas en los ajustes del navegador y volvé a intentar.';

  if (hint) {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-2xl bg-accent-ink/10 px-3 py-2.5 text-[13px]">
        {typeof hint === 'string' && <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />}
        {hint}
      </p>
    );
  }
  return on ? (
    <Button variant="ghost" className="mt-3 -mb-2 w-full" loading={busy === 'disable'} onClick={onDisable}>
      Desactivar en este dispositivo
    </Button>
  ) : (
    <button
      type="button"
      disabled={busy === 'enable'}
      onClick={onEnable}
      className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent-ink text-[15px] font-semibold text-accent disabled:opacity-60"
    >
      <Bell className="size-4" aria-hidden /> {busy === 'enable' ? 'Activando…' : 'Activar notificaciones'}
    </button>
  );
}
