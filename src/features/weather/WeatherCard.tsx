import { AlertTriangle, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, Info, MapPin, Moon, RefreshCw, Sun, ThumbsUp, Wind } from 'lucide-react';
import { useEffect } from 'react';
import { cx } from '@/components/ui';
import { adviceFor, bestHour, dayConditions, describeCode, fmtTemp, type AdviceActivity, type WeatherKind } from '@/core/weather/weather';
import { enableWeather, refreshWeather, useWeather } from './store';

export function WeatherIcon({ code, isDay = true, className }: { code: number; isDay?: boolean; className?: string }) {
  const kind: WeatherKind = describeCode(code).kind;
  const Icon =
    kind === 'clear' ? (isDay ? Sun : Moon)
    : kind === 'partly' ? CloudSun
    : kind === 'cloudy' ? Cloud
    : kind === 'fog' ? CloudFog
    : kind === 'drizzle' ? CloudDrizzle
    : kind === 'rain' ? CloudRain
    : kind === 'snow' ? CloudSnow
    : CloudLightning;
  return <Icon className={className} aria-hidden />;
}

function AdviceList({ items }: { items: ReturnType<typeof adviceFor> }) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {items.map((a) => {
        const Icon = a.level === 'warn' ? AlertTriangle : a.level === 'ok' ? ThumbsUp : Info;
        return (
          <li key={a.text} className={cx('flex gap-2 rounded-xl px-3 py-2 text-[13px] leading-snug', a.level === 'warn' ? 'bg-warn/12 text-warn' : a.level === 'ok' ? 'bg-ok/10 text-ok' : 'bg-raised text-muted')}>
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{a.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function EnablePrompt({ compact }: { compact?: boolean }) {
  const w = useWeather();
  const busy = w.status === 'locating' || w.status === 'loading';
  return (
    <section className={cx('flex items-center gap-3 rounded-3xl border border-line bg-surface', compact ? 'p-4' : 'p-5')}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-muted">
        <CloudSun className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Clima para entrenar</p>
        <p className="text-[13px] text-muted">
          {w.status === 'denied' ? 'Sin permiso de ubicación: activalo en los ajustes del navegador.' : w.error ?? 'Pronóstico y consejos según tu zona (ubicación aproximada, queda en tu teléfono).'}
        </p>
      </div>
      <button type="button" disabled={busy} onClick={() => void enableWeather()} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink disabled:opacity-60">
        <MapPin className="size-4" aria-hidden /> {busy ? 'Buscando…' : 'Activar'}
      </button>
    </section>
  );
}

const updatedLabel = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  return h < 24 ? `hace ${h} h` : 'hace más de un día';
};

/**
 * Clima de ahora con consejos para la actividad del día.
 * activity: qué se va a hacer (cambia los consejos; fuerza es bajo techo).
 */
export function WeatherCard({ activity = 'run', compact = false, showPrompt = true }: { activity?: AdviceActivity; compact?: boolean; showPrompt?: boolean }) {
  const w = useWeather();
  useEffect(() => {
    void refreshWeather();
  }, []);

  if (!w.coords || (!w.forecast && w.status !== 'loading')) return showPrompt ? <EnablePrompt compact={compact} /> : null;
  if (!w.forecast) return <div className="h-28 animate-pulse rounded-3xl bg-surface" aria-label="Cargando el clima" />;

  const f = w.forecast;
  const today = f.days[0];
  const { label } = describeCode(f.now.code);
  const tips = adviceFor(activity, {
    temp: f.now.temp,
    apparent: f.now.apparent,
    code: f.now.code,
    windKmh: f.now.windKmh,
    precipProb: Math.max(f.now.precipProb, ...f.hours.slice(0, 3).map((h) => h.precipProb)),
    uv: today?.uvMax,
    isDay: f.now.isDay,
  });
  const best = activity !== 'strength' ? bestHour(f.hours) : null;
  const nowHour = Number(f.now.time.slice(11, 13));

  return (
    <section className={cx('rounded-3xl border border-line bg-surface', compact ? 'p-4' : 'p-5')} aria-label="Clima">
      <div className="flex items-center gap-3">
        <WeatherIcon code={f.now.code} isDay={f.now.isDay} className={cx('shrink-0 text-accent', compact ? 'size-9' : 'size-11')} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className={cx('num font-bold leading-none', compact ? 'text-[26px]' : 'text-[32px]')}>{fmtTemp(f.now.temp)}</span>
            <span className="text-[15px] leading-tight font-medium">{label}</span>
          </p>
          <p className="text-[13px] text-muted">
            Sensación {fmtTemp(f.now.apparent)}
            {today && ` · máx ${fmtTemp(today.tMax)} / mín ${fmtTemp(today.tMin)}`}
          </p>
        </div>
        <button type="button" aria-label="Actualizar el clima" onClick={() => void refreshWeather(true)} className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-muted">
          <RefreshCw className={cx('size-4', w.status === 'loading' && 'animate-spin')} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1">
          <Droplets className="size-3.5" aria-hidden /> {f.now.precipProb}% lluvia
        </span>
        <span className="inline-flex items-center gap-1">
          <Wind className="size-3.5" aria-hidden /> {Math.round(f.now.windKmh)} km/h
        </span>
        {best && Number(best.time.slice(11, 13)) !== nowHour && (
          <span className="inline-flex items-center gap-1 font-medium text-ink">Mejor hora: {Number(best.time.slice(11, 13))} h</span>
        )}
      </div>

      {!compact && <HourStrip hours={f.hours.slice(0, 12)} />}

      <AdviceList items={tips} />

      <p className="mt-2 text-[11px] text-faint">
        {w.stale ? 'Sin conexión: ' : ''}Actualizado {updatedLabel(f.fetchedAt)} · Open-Meteo
      </p>
    </section>
  );
}

function HourStrip({ hours }: { hours: { time: string; temp: number; code: number; precipProb: number }[] }) {
  return (
    <ol className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Próximas horas">
      {hours.map((h, i) => (
        <li key={h.time} className="flex min-w-12 flex-col items-center gap-1 rounded-xl bg-raised/60 px-1.5 py-2">
          <span className="text-[11px] text-muted">{i === 0 ? 'Ahora' : `${Number(h.time.slice(11, 13))} h`}</span>
          <WeatherIcon code={h.code} isDay={Number(h.time.slice(11, 13)) >= 7 && Number(h.time.slice(11, 13)) < 20} className="size-4" />
          <span className="num text-[13px] font-semibold">{fmtTemp(h.temp)}</span>
          <span className={cx('num text-[10px]', h.precipProb >= 40 ? 'text-accent' : 'text-faint')}>{h.precipProb}%</span>
        </li>
      ))}
    </ol>
  );
}

/** Pronóstico de un día puntual del plan (hasta 7 días). null si no hay datos para esa fecha. */
export function DayForecast({ date, activity }: { date: string; activity: AdviceActivity }) {
  const w = useWeather();
  const d = w.forecast?.days.find((x) => x.date === date);
  if (!d) return null;
  const tips = adviceFor(activity, dayConditions(d));
  return (
    <section className="rounded-3xl border border-line bg-surface p-5" aria-label="Pronóstico del día">
      <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">Pronóstico</p>
      <div className="mt-2 flex items-center gap-3">
        <WeatherIcon code={d.code} className="size-9 shrink-0 text-accent" />
        <div>
          <p className="text-[16px] font-semibold">
            {describeCode(d.code).label} · <span className="num">{fmtTemp(d.tMin)} / {fmtTemp(d.tMax)}</span>
          </p>
          <p className="text-[13px] text-muted">
            {d.precipProbMax}% lluvia · viento hasta {Math.round(d.windMaxKmh)} km/h
          </p>
        </div>
      </div>
      <AdviceList items={tips} />
    </section>
  );
}
