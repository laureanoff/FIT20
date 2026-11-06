import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Playback, SpotifyError, getPlayback, next, onSpotifyChange, pause, play, playPlaylist, previous, spotifyConfigured, spotifyConnected } from './spotify';

export function useSpotifyConfigured(): boolean {
  return useSyncExternalStore(onSpotifyChange, spotifyConfigured, spotifyConfigured);
}

export function useSpotifyConnected(): boolean {
  return useSyncExternalStore(onSpotifyChange, spotifyConnected, spotifyConnected);
}

/**
 * Estado de la reproducción, consultado cada 5 s con la pantalla visible (y al volver a la app).
 * Los comandos actualizan la vista al instante y después confirman con Spotify.
 */
export function useSpotifyPlayer(active = true) {
  const connected = useSpotifyConnected();
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<SpotifyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!spotifyConnected()) return;
    try {
      setPlayback(await getPlayback());
      setError((e) => (e && (e.code === 'network' || e.code === 'rate') ? null : e));
    } catch (e) {
      if (e instanceof SpotifyError) setError(e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!active || !connected || !spotifyConfigured()) return;
    let stop = false;
    const loop = async () => {
      if (stop) return;
      if (document.visibilityState === 'visible' && navigator.onLine) await refresh();
      timer.current = setTimeout(() => void loop(), 5000);
    };
    void loop();
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active, connected, refresh]);

  const run = useCallback(
    async (fn: () => Promise<void>, optimistic?: (p: Playback | null) => Playback | null) => {
      setBusy(true);
      setError(null);
      if (optimistic) setPlayback((p) => optimistic(p));
      try {
        await fn();
        setTimeout(() => void refresh(), 600); // Spotify tarda un instante en reflejar el cambio
      } catch (e) {
        setError(e instanceof SpotifyError ? e : new SpotifyError('other', 'No se pudo controlar Spotify.'));
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    connected,
    loaded,
    playback,
    error,
    busy,
    refresh,
    toggle: () => (playback?.isPlaying ? run(pause, (p) => p && { ...p, isPlaying: false }) : run(play, (p) => p && { ...p, isPlaying: true })),
    next: () => run(next),
    previous: () => run(previous),
    playPlaylist: (uri: string) => run(() => playPlaylist(uri), (p) => p && { ...p, isPlaying: true }),
  };
}
