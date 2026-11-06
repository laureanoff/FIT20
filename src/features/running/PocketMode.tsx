import { useEffect, useRef, useState } from 'react';

/**
 * Modo bolsillo: pantalla casi negra con tiempo, km y ritmo, mientras la app sigue abierta.
 * Así el GPS sigue midiendo (el iPhone lo pausa si bloqueás el celu) y la música de Spotify sigue sonando.
 * Ignora los toques accidentales; para salir hay que mantener apretado 1 segundo.
 * En pantallas OLED el negro casi no gasta batería; el texto se mueve un poco cada minuto para no marcar la pantalla.
 */
export function PocketMode({ time, km, rate, paused, onExit }: { time: string; km: string; rate: string; paused: boolean; onExit: () => void }) {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockOk = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    const t = setInterval(() => setShift({ x: Math.round(Math.random() * 24 - 12), y: Math.round(Math.random() * 40 - 20) }), 60_000);
    return () => clearInterval(t);
  }, []);

  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      navigator.vibrate?.(40);
      onExit();
    }, 1000);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modo bolsillo"
      className="fixed inset-0 z-[60] flex touch-none flex-col items-center justify-center bg-black text-[#5c5c5c] select-none"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex flex-col items-center gap-2 transition-transform duration-1000" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
        {paused && <p className="text-[15px] font-semibold tracking-widest text-[#7a5c1e] uppercase">En pausa</p>}
        <p className="num text-[84px] leading-none font-bold" aria-label={`Tiempo ${time}`}>
          {time}
        </p>
        <p className="num text-[44px] leading-none font-semibold">
          {km} <span className="text-[22px]">km</span>
        </p>
        <p className="num mt-1 text-[22px]">{rate}</p>
      </div>
      <div className="pb-safe absolute inset-x-0 bottom-10 flex flex-col items-center gap-3 px-8 text-center">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-[#1a1a1a]">
          <div className={holding ? 'h-full w-full origin-left animate-[grow_1s_linear] bg-[#5c5c5c]' : 'h-full w-0'} />
        </div>
        <p className="text-[13px] text-[#444]">Mantené apretado para salir</p>
        <p className="text-[12px] text-[#333]">
          {wakeLockOk
            ? 'La pantalla queda encendida para que el GPS siga midiendo. Bajá el brillo para ahorrar batería.'
            : 'Para que el GPS siga midiendo, poné Ajustes → Pantalla y brillo → Bloqueo automático en "Nunca" durante la salida.'}
        </p>
      </div>
      <style>{'@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}'}</style>
    </div>
  );
}
