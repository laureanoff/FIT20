import { ExternalLink, ListMusic, Music2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner, cx } from '@/components/ui';
import { type Playlist, SPOTIFY_APP_URL, connectSpotify, myPlaylists } from './spotify';
import { useSpotifyConfigured, useSpotifyPlayer } from './useSpotify';

/** Ícono genérico de música para identificar la sección. */
export function MusicMark({ className }: { className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-full bg-[#1ED760] text-black', className)} aria-hidden>
      <Music2 className="size-[55%]" />
    </span>
  );
}

/**
 * Reproductor compacto para usar mientras entrenás.
 * Si Spotify no está configurado no se muestra; si no está conectado, ofrece conectarlo.
 */
export function MusicCard({ className }: { className?: string }) {
  const sp = useSpotifyPlayer();
  const [lists, setLists] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const configured = useSpotifyConfigured();

  if (!configured || !sp.connected) {
    return (
      <section className={cx('flex items-center gap-3 rounded-3xl border border-line bg-surface p-4', className)}>
        <MusicMark className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Música con Spotify</p>
          <p className="text-[13px] text-muted">{connectError ?? 'Elegí una playlist y controlala sin salir de FIT 20.'}</p>
        </div>
        {configured ? (
          <button
            type="button"
            onClick={() => void connectSpotify().catch((e: Error) => setConnectError(e.message))}
            className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#1ED760] px-4 text-[14px] font-semibold text-black"
          >
            Conectar
          </button>
        ) : (
          <Link to="/perfil/musica" className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#1ED760] px-4 text-[14px] font-semibold text-black">
            Activar
          </Link>
        )}
      </section>
    );
  }

  const t = sp.playback?.track;
  return (
    <section className={cx('rounded-3xl border border-line bg-surface p-4', className)} aria-label="Música">
      <div className="flex items-center gap-3">
        {t?.image ? <img src={t.image} alt="" className="size-14 shrink-0 rounded-xl object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-raised"><Music2 className="size-6 text-muted" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          {t ? (
            <>
              <p className="truncate text-[15px] font-semibold">{t.name}</p>
              <p className="truncate text-[13px] text-muted">{t.artists}</p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold">{sp.loaded ? 'Nada sonando' : 'Conectando…'}</p>
              <p className="text-[13px] text-muted">Elegí una playlist para arrancar.</p>
            </>
          )}
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-faint">
            <Music2 className="size-3" aria-hidden /> Spotify{sp.playback?.device ? ` · ${sp.playback.device}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setLists((v) => !v)} aria-expanded={lists} className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium', lists ? 'bg-ink text-bg' : 'bg-raised')}>
          <ListMusic className="size-4" aria-hidden /> Playlists
        </button>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Tema anterior" disabled={sp.busy || !t} onClick={() => void sp.previous()} className="grid size-11 place-items-center rounded-full text-ink disabled:opacity-35">
            <SkipBack className="size-5 fill-current" />
          </button>
          <button
            type="button"
            aria-label={sp.playback?.isPlaying ? 'Pausar música' : 'Reproducir música'}
            disabled={sp.busy || !t}
            onClick={() => void sp.toggle()}
            className="grid size-12 place-items-center rounded-full bg-ink text-bg disabled:opacity-35"
          >
            {sp.playback?.isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
          </button>
          <button type="button" aria-label="Tema siguiente" disabled={sp.busy || !t} onClick={() => void sp.next()} className="grid size-11 place-items-center rounded-full text-ink disabled:opacity-35">
            <SkipForward className="size-5 fill-current" />
          </button>
        </div>
      </div>

      {sp.error && sp.error.code !== 'network' && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-warn/12 px-3 py-2.5 text-[13px] text-warn">
          <span className="flex-1">{sp.error.message}</span>
          {sp.error.code === 'no_device' && (
            <a href={SPOTIFY_APP_URL} className="inline-flex shrink-0 items-center gap-1 font-semibold underline">
              Abrir Spotify <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          {sp.error.code === 'expired' && (
            <Link to="/perfil/musica" className="shrink-0 font-semibold underline">
              Reconectar
            </Link>
          )}
        </div>
      )}

      {lists && <PlaylistPicker onPick={(uri) => void sp.playPlaylist(uri).then(() => setLists(false))} onClose={() => setLists(false)} />}
    </section>
  );
}

function PlaylistPicker({ onPick, onClose }: { onPick: (uri: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    myPlaylists()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">Tus playlists</p>
        <button type="button" aria-label="Cerrar playlists" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted">
          <X className="size-4" />
        </button>
      </div>
      {error ? (
        <p className="text-[13px] text-warn">{error}</p>
      ) : !items ? (
        <Spinner label="Cargando playlists…" />
      ) : !items.length ? (
        <p className="text-[13px] text-muted">No tenés playlists guardadas en Spotify.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p.uri)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left active:bg-raised">
                {p.image ? <img src={p.image} alt="" className="size-11 shrink-0 rounded-lg object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-raised"><ListMusic className="size-5 text-muted" aria-hidden /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{p.name}</span>
                  {p.tracks > 0 && <span className="block text-[12px] text-muted">{p.tracks} temas</span>}
                </span>
                <Play className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
