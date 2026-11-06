import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceEvery, cardioAudioMode, setCardioAudioMode, splitPhrase, voiceEnabled } from '@/features/running/voice';
import { lockScreenEnabled, lockScreenText, setLockScreenEnabled, startLockScreen, stopLockScreen, updateLockScreen } from '@/features/running/lockscreen';

describe('avisos por voz', () => {
  it('arma la frase de cada km y en bici cada 5 km', () => {
    expect(splitPhrase('run', 3, 1025, 340)).toBe('Kilómetro 3. Tiempo: 17 minutos 5 segundos. Último kilómetro a 5 40.');
    expect(splitPhrase('walk', 1, 600, 605)).toBe('Kilómetro 1. Tiempo: 10 minutos. Último kilómetro a 10 cero 5.');
    expect(splitPhrase('bike', 10, 3720, 750)).toBe('Kilómetro 10. Tiempo: 1 hora 2 minutos. Velocidad: 24 kilómetros por hora.');
    expect(announceEvery('bike')).toBe(5);
    expect(announceEvery('run')).toBe(1);
  });
  it('por defecto la música sigue sonando y la voz está activada', () => {
    localStorage.clear();
    expect(cardioAudioMode()).toBe('music');
    expect(voiceEnabled()).toBe(true);
    setCardioAudioMode('lock');
    expect(cardioAudioMode()).toBe('lock');
    localStorage.clear();
  });
});

describe('pantalla de bloqueo', () => {
  it('arma los textos del panel', () => {
    expect(lockScreenText({ activityLabel: 'Running', distanceKm: 5.234, elapsedMs: 1_694_000, rate: '5:24/km', running: true, targetKm: 8 })).toEqual({
      title: '5,23 km · 28:14',
      artist: 'Running · 5:24/km · objetivo 8 km',
      album: 'FIT 20',
    });
    expect(lockScreenText({ activityLabel: 'Bici', distanceKm: 0, elapsedMs: 3_725_000, rate: null, running: false }).title).toBe('0,00 km · 1:02:05');
    expect(lockScreenText({ activityLabel: 'Bici', distanceKm: 0, elapsedMs: 0, rate: null, running: false }).artist).toBe('Bici en pausa');
  });

  it('se puede apagar y recuerda la preferencia', () => {
    localStorage.clear();
    expect(lockScreenEnabled()).toBe(false); // por defecto "con música": no toma el audio
    setLockScreenEnabled(true);
    expect(lockScreenEnabled()).toBe(true);
    setLockScreenEnabled(false);
    expect(lockScreenEnabled()).toBe(false);
    setLockScreenEnabled(true);
  });

  describe('con Media Session', () => {
    const handlers = new Map<string, (() => void) | null>();
    const ms = { metadata: null as unknown, playbackState: 'none', setActionHandler: (a: string, h: (() => void) | null) => handlers.set(a, h), setPositionState: vi.fn() };
    beforeEach(() => {
      handlers.clear();
      setLockScreenEnabled(true);
      Object.defineProperty(navigator, 'mediaSession', { value: ms, configurable: true });
      vi.stubGlobal('MediaMetadata', class {
        constructor(init: object) {
          Object.assign(this, init);
        }
      });
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    });
    afterEach(() => {
      stopLockScreen();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('muestra el avance, pausa/reanuda desde el bloqueo y se limpia al terminar', async () => {
      const onPause = vi.fn();
      const onResume = vi.fn();
      expect(await startLockScreen({ onPause, onResume })).toBe(true);
      updateLockScreen({ activityLabel: 'Caminata', distanceKm: 1.5, elapsedMs: 900_000, rate: '10:00/km', running: true });
      expect((ms.metadata as { title: string }).title).toBe('1,50 km · 15:00');
      expect(ms.playbackState).toBe('playing');
      expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 1800, position: 900, playbackRate: 1 });

      handlers.get('pause')!();
      expect(onPause).toHaveBeenCalled();
      handlers.get('play')!();
      expect(onResume).toHaveBeenCalled();
      expect(handlers.get('nexttrack')).toBeNull();

      stopLockScreen();
      expect(ms.metadata).toBeNull();
      expect(ms.playbackState).toBe('none');
    });

    it('si no está activado no toca nada', async () => {
      setLockScreenEnabled(false);
      expect(await startLockScreen({ onPause: vi.fn(), onResume: vi.fn() })).toBe(false);
    });
  });
});

describe('notificación en vivo (datos para el servidor)', () => {
  it('arma la fila con límites y programa la próxima', async () => {
    const { liveRow, liveInterval, setLiveInterval } = await import('@/features/running/liveSync');
    localStorage.clear();
    expect(liveInterval()).toBe(0);
    setLiveInterval(1);
    expect(liveInterval()).toBe(1);
    const now = new Date('2026-11-06T13:00:00Z');
    const row = liveRow({ activity: 'run', status: 'running', elapsed_s: 600.4, distance_km: 2.12345, pace_s_per_km: 283.24, target_km: 8 }, 'u1', 1, now, 'next');
    expect(row).toMatchObject({ user_id: 'u1', elapsed_s: 600, distance_km: 2.123, pace_s_per_km: 283.2, interval_min: 1, next_push_at: '2026-11-06T13:00:40.000Z' });
    expect(liveRow({ activity: 'run', status: 'paused', elapsed_s: 10, distance_km: 0, pace_s_per_km: 12, target_km: null }, 'u1', 2, now, 'none')).toMatchObject({ pace_s_per_km: null, next_push_at: null });
    expect('next_push_at' in liveRow({ activity: 'bike', status: 'running', elapsed_s: 10, distance_km: 0, pace_s_per_km: null, target_km: null }, 'u1', 5, now)).toBe(false);
  });
});
