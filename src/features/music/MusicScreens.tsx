import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBox, SectionTitle, Spinner } from '@/components/ui';
import { MusicCard, MusicMark } from './MusicCard';
import { clientIdFromEnv, connectSpotify, disconnectSpotify, finishSpotifyLogin, redirectUri, setClientId, validClientId } from './spotify';
import { useSpotifyConfigured, useSpotifyConnected } from './useSpotify';

/** Perfil → Música. */
export function MusicSettingsScreen() {
  const connected = useSpotifyConnected();
  const [error, setError] = useState<string | null>(null);
  const configured = useSpotifyConfigured();

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      <Link to="/perfil" className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start px-2 text-[14px] text-muted">
        <ArrowLeft className="size-4" aria-hidden /> Perfil
      </Link>
      <h1 className="text-[26px] font-bold tracking-tight">Música</h1>

      <Card>
        <div className="flex items-start gap-3">
          <MusicMark className="size-11" />
          <div>
            <p className="text-[17px] font-bold">Spotify</p>
            <p className="text-[14px] text-muted">
              {connected ? 'Conectado. Controlás la música desde la salida de cardio y la sesión de fuerza.' : 'Elegí una playlist, pausá y pasá de tema sin salir de FIT 20.'}
            </p>
          </div>
        </div>
        {!configured ? (
          <SetupClientId />
        ) : connected ? (
          <Button variant="ghost" className="mt-3 -mb-2 w-full" onClick={() => disconnectSpotify()}>
            Desconectar Spotify
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => void connectSpotify('/perfil/musica').catch((e: Error) => setError(e.message))}
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#1ED760] text-[15px] font-semibold text-black"
          >
            Conectar Spotify
          </button>
        )}
      </Card>
      {error && <ErrorBox>{error}</ErrorBox>}

      {connected && <MusicCard />}

      <Card>
        <SectionTitle>Cómo funciona</SectionTitle>
        <ul className="flex flex-col gap-2 text-[14px]">
          {[
            'La música suena en la app de Spotify: sigue con el celu bloqueado y nunca se corta por FIT 20.',
            'Controlar la reproducción (play, pausa, temas, playlists) requiere Spotify Premium.',
            'Si dice que no hay dispositivo, abrí Spotify, poné play una vez y volvé.',
            'En la salida de cardio elegí "Con música" para que FIT 20 no tome el audio; los avisos por voz bajan la música un momento.',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        {configured && !clientIdFromEnv() && (
          <button type="button" onClick={() => setClientId('')} className="mt-3 text-[12px] text-faint underline">
            Cambiar el Client ID de Spotify
          </button>
        )}
      </Card>
    </div>
  );
}

/** Activación única: crear la app en Spotify for Developers y pegar su Client ID. */
function SetupClientId() {
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const ok = validClientId(value);
  const uri = redirectUri();
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-raised p-4 text-[14px]">
      <p className="font-semibold">Activalo una vez (5 minutos)</p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted">
        <li>
          Entrá a{' '}
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">
            developer.spotify.com/dashboard
          </a>{' '}
          con tu cuenta de Spotify (tiene que ser Premium) y tocá <b className="text-ink">Create app</b>.
        </li>
        <li>
          Nombre: FIT 20. En <b className="text-ink">Redirect URI</b> pegá esta dirección:
          <span className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-surface px-2 py-1.5 text-[12px] break-all text-ink">{uri}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(uri).then(() => setCopied(true))}
              className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink"
            >
              {copied ? 'Copiada' : 'Copiar'}
            </button>
          </span>
        </li>
        <li>
          En <b className="text-ink">APIs used</b> marcá <b className="text-ink">Web API</b>, aceptá los términos y guardá.
        </li>
        <li>
          Abrí la app creada → <b className="text-ink">Settings</b>, copiá el <b className="text-ink">Client ID</b> y pegalo acá:
        </li>
      </ol>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Client ID (32 letras y números)"
        aria-label="Client ID de Spotify"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-h-12 rounded-xl border border-line bg-surface px-3 font-mono text-[14px] text-ink focus:border-accent focus:outline-none"
      />
      {value && !ok && <p className="text-[12px] text-warn">El Client ID tiene 32 caracteres (letras de la a a la f y números).</p>}
      <Button disabled={!ok} onClick={() => setClientId(value)}>
        Guardar
      </Button>
      <p className="text-[12px] text-faint">El Client ID no es una contraseña: identifica a FIT 20 ante Spotify. Queda guardado en este teléfono.</p>
    </div>
  );
}

/** /spotify/callback: Spotify vuelve acá después de autorizar. */
export function SpotifyCallbackScreen() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return; // el código de Spotify sirve una sola vez (StrictMode monta dos veces)
    done.current = true;
    finishSpotifyLogin(search)
      .then((back) => navigate(back, { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [search, navigate]);
  if (!error) return <Spinner label="Conectando Spotify…" />;
  return (
    <div className="flex flex-col gap-4 pt-6">
      <ErrorBox>{error}</ErrorBox>
      <Link to="/perfil/musica" className="text-center text-[15px] font-semibold underline">
        Volver a Música
      </Link>
    </div>
  );
}
