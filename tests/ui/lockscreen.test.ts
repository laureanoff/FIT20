import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockScreenEnabled, lockScreenText, setLockScreenEnabled, startLockScreen, stopLockScreen, updateLockScreen } from '@/features/running/lockscreen';

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
      setLockScreenEnabled(true);
    });
  });
});
