import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpotifyError,
  codeChallenge,
  disconnectSpotify,
  finishSpotifyLogin,
  getPlayback,
  myPlaylists,
  next,
  play,
  setClientId,
  spotifyConfigured,
  spotifyConnected,
  toTrack,
  validClientId,
} from '@/features/music/spotify';

const CID = '0123456789abcdef0123456789abcdef';
type Call = { url: string; init?: RequestInit };
let calls: Call[];
let responder: (url: string, init?: RequestInit) => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  responder = () => json({});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function connect(expiresAt = Date.now() + 3_600_000) {
  setClientId(CID);
  localStorage.setItem('fit20:spotify', JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_at: expiresAt }));
}

describe('Spotify: configuración e inicio de sesión', () => {
  it('valida el Client ID', () => {
    expect(spotifyConfigured()).toBe(false);
    expect(validClientId('abc')).toBe(false);
    setClientId(` ${CID} `);
    expect(spotifyConfigured()).toBe(true);
  });

  it('PKCE: desafío S256 del RFC 7636', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('al volver de Spotify cambia el código por tokens y vuelve a la pantalla de origen', async () => {
    setClientId(CID);
    sessionStorage.setItem('fit20:spotify-verifier', JSON.stringify({ verifier: 'v'.repeat(64), state: 'st' }));
    sessionStorage.setItem('fit20:spotify-return', '/running/en-curso');
    responder = () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    expect(await finishSpotifyLogin('?code=CODE&state=st')).toBe('/running/en-curso');
    const body = new URLSearchParams(String(calls[0]!.init!.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v'.repeat(64));
    expect(body.get('client_id')).toBe(CID);
    expect(spotifyConnected()).toBe(true);
    disconnectSpotify();
    expect(spotifyConnected()).toBe(false);
  });

  it('rechaza un estado distinto o la cancelación', async () => {
    setClientId(CID);
    sessionStorage.setItem('fit20:spotify-verifier', JSON.stringify({ verifier: 'v', state: 'st' }));
    await expect(finishSpotifyLogin('?code=C&state=otro')).rejects.toThrow(/venció/);
    await expect(finishSpotifyLogin('?error=access_denied')).rejects.toThrow(/Cancelaste/);
  });
});

describe('Spotify: reproducción', () => {
  it('lee lo que suena', async () => {
    connect();
    responder = () =>
      json({
        is_playing: true,
        progress_ms: 1000,
        device: { name: 'iPhone de Lau' },
        item: { name: 'Tema', uri: 'spotify:track:1', duration_ms: 200000, artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] } },
      });
    const p = (await getPlayback())!;
    expect(p.track).toMatchObject({ name: 'Tema', artists: 'A, B', image: 'small' });
    expect(p.device).toBe('iPhone de Lau');
    expect(calls[0]!.init!.headers).toMatchObject({ Authorization: 'Bearer AT' });
    responder = () => new Response(null, { status: 204 });
    expect(await getPlayback()).toBeNull(); // nada sonando
  });

  it('renueva el token vencido antes de llamar', async () => {
    connect(Date.now() - 1000);
    responder = (url) => (url.includes('/api/token') ? json({ access_token: 'NEW', expires_in: 3600 }) : new Response(null, { status: 204 }));
    await play();
    expect(calls[0]!.url).toContain('accounts.spotify.com/api/token');
    expect(calls[1]!.init!.headers).toMatchObject({ Authorization: 'Bearer NEW' });
    expect(JSON.parse(localStorage.getItem('fit20:spotify')!).refresh_token).toBe('RT'); // conserva el anterior si no manda otro
  });

  it('sin dispositivo activo usa el teléfono; sin Premium lo explica', async () => {
    connect();
    let n = 0;
    responder = (url) => {
      if (url.endsWith('/me/player/next') && n++ === 0) return json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404);
      if (url.includes('/devices')) return json({ devices: [{ id: 'PHONE', is_active: false, type: 'Smartphone' }] });
      return new Response(null, { status: 204 });
    };
    await next();
    expect(calls.at(-1)!.url).toContain('/me/player/next?device_id=PHONE');

    responder = () => json({ error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }, 403);
    await expect(play()).rejects.toMatchObject({ code: 'premium' });
  });

  it('si la sesión de Spotify se revocó, pide reconectar', async () => {
    connect(Date.now() - 1000);
    responder = () => json({ error: 'invalid_grant' }, 400);
    await expect(getPlayback()).rejects.toBeInstanceOf(SpotifyError);
    expect(spotifyConnected()).toBe(false);
  });

  it('lista playlists con el formato nuevo (items) y el viejo (tracks)', async () => {
    connect();
    responder = () => json({ items: [{ id: '1', uri: 'spotify:playlist:1', name: 'Correr', images: [{ url: 'x', width: 300 }], items: { total: 40 } }, null, { id: '2', uri: 'u2', name: 'Fuerza', images: null, tracks: { total: 12 } }] });
    expect(await myPlaylists()).toEqual([
      { id: '1', uri: 'spotify:playlist:1', name: 'Correr', image: 'x', tracks: 40 },
      { id: '2', uri: 'u2', name: 'Fuerza', image: null, tracks: 12 },
    ]);
    expect(toTrack(null)).toBeNull();
  });
});
