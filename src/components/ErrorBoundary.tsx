import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Qué mostrar si falla; recibe un reintento. */
  fallback: (retry: () => void, error: Error) => ReactNode;
}

/** Evita que un error en una parte (p. ej. el mapa sin conexión) deje la pantalla en negro. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FIT 20:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) return this.props.fallback(() => this.setState({ error: null }), this.state.error);
    return this.props.children;
  }
}

/** Pantalla de error genérica para toda la app (los datos están a salvo en el dispositivo). */
export function AppCrash({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[22px] font-bold">Algo salió mal</h1>
      <p className="text-[15px] text-muted">Tus datos están guardados en este dispositivo. Probá de nuevo; si sigue pasando, cerrá y volvé a abrir la app.</p>
      <div className="flex gap-2">
        <button type="button" onClick={retry} className="min-h-12 rounded-2xl bg-raised px-5 font-semibold">
          Reintentar
        </button>
        <button type="button" onClick={() => window.location.assign('/')} className="min-h-12 rounded-2xl bg-accent px-5 font-semibold text-accent-ink">
          Ir al inicio
        </button>
      </div>
    </main>
  );
}
