import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { Loader2 } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-colors active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100',
        variant === 'primary' && 'bg-accent text-accent-ink',
        variant === 'secondary' && 'bg-raised text-ink',
        variant === 'ghost' && 'text-muted hover:text-ink',
        variant === 'danger' && 'bg-danger/15 text-danger',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  suffix,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; suffix?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      <div
        className={cx(
          'flex items-center rounded-xl border bg-surface transition-colors focus-within:border-accent',
          error ? 'border-danger' : 'border-line',
        )}
      >
        <input
          id={id}
          {...input}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-d` : undefined}
          className="min-h-12 w-full min-w-0 bg-transparent px-4 text-[16px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
        />
        {suffix && <span className="pr-4 text-sm text-muted">{suffix}</span>}
      </div>
      {(error || hint) && (
        <p id={`${id}-d`} className={cx('text-[13px]', error ? 'text-danger' : 'text-faint')}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Chip({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'min-h-11 rounded-full border px-4 text-[14px] font-medium transition-colors',
        selected ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Opción grande seleccionable (objetivo, nivel…). */
export function OptionCard({ selected, onClick, title, description, icon }: { selected: boolean; onClick: () => void; title: string; description?: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors',
        selected ? 'border-accent bg-accent/10' : 'border-line bg-surface',
      )}
    >
      {icon && <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', selected ? 'bg-accent text-accent-ink' : 'bg-raised text-muted')}>{icon}</span>}
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold">{title}</span>
        {description && <span className="text-[13px] text-muted">{description}</span>}
      </span>
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-3xl border border-line bg-surface p-5', className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-[15px]">{label}</span>
        {description && <span className="text-[13px] text-muted">{description}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-raised transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-accent-ink" />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-10 rounded-xl text-[14px] font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Marca FIT20 con los colores del logo: "FIT" en lima y "20" en el color del texto, en cursiva pesada. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-baseline font-black tracking-tight italic', className)} aria-label="FIT20">
      <span className="wm-fit text-accent">FIT</span>
      <span>20</span>
    </span>
  );
}

/** Logo completo (pantallas de bienvenida). */
export function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="FIT20" width={640} height={640} className={cx('rounded-3xl', className)} />;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger/12 px-4 py-3 text-[14px] text-danger">
      {children}
    </p>
  );
}
