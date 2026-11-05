import { MailCheck, WifiOff } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ErrorBox, Field, Wordmark } from '@/components/ui';
import { authErrorMessage, useAuth } from '@/app/auth';
import { useOnline } from '@/app/data';
import { backendMissing, supabase } from '@/lib/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const online = useOnline();
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <div className="pt-10 pb-8">
        <Wordmark className="text-[28px]" />
      </div>
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
      {!online && (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-warn/12 px-4 py-3 text-[14px] text-warn">
          <WifiOff className="size-4 shrink-0" aria-hidden /> Sin conexión: esta pantalla necesita internet.
        </p>
      )}
      {backendMissing && (
        <div className="mt-5">
          <ErrorBox>Falta configurar Supabase: completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local (ver SETUP.md).</ErrorBox>
        </div>
      )}
      <div className="mt-7 flex flex-1 flex-col">{children}</div>
      {footer && <div className="py-8 text-center text-[15px] text-muted">{footer}</div>}
    </main>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!EMAIL_RE.test(email.trim())) return setError('Revisá el email.');
    if (!password) return setError('Ingresá tu contraseña.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(authErrorMessage(err));
  }

  return (
    <AuthLayout
      title="Hola de nuevo"
      subtitle="Tu entrenamiento, tu running y tu alimentación en un solo lugar."
      footer={
        <>
          ¿No tenés cuenta?{' '}
          <Link to="/registro" className="font-semibold text-ink underline underline-offset-4">
            Creala gratis
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" loading={busy} disabled={backendMissing} className="mt-2">
          Iniciar sesión
        </Button>
        <Link to="/recuperar" className="self-center py-2 text-[14px] text-muted underline underline-offset-4">
          Olvidé mi contraseña
        </Link>
      </form>
    </AuthLayout>
  );
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Usá al menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Combiná letras y números.';
  return null;
}

export function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Revisá el email.';
    const pw = passwordProblem(password);
    if (pw) next.password = pw;
    if (confirm !== password) next.confirm = 'Las contraseñas no coinciden.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) return setErrors({ form: authErrorMessage(error) });
    // Con "Confirm email" activado no hay sesión hasta confirmar.
    if (!data.session) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthLayout title="Revisá tu email" footer={<Link to="/login" className="font-semibold text-ink underline underline-offset-4">Volver a iniciar sesión</Link>}>
        <div className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-5">
          <MailCheck className="size-8 text-accent" aria-hidden />
          <p className="text-[15px]">
            Te enviamos un enlace a <strong>{sentTo}</strong>. Abrilo desde este dispositivo para activar tu cuenta.
          </p>
          <p className="text-[14px] text-muted">¿No llegó? Mirá en spam o promociones; puede tardar unos minutos.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Creá tu cuenta"
      subtitle="Después armamos tu perfil en menos de 2 minutos."
      footer={
        <>
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="font-semibold text-ink underline underline-offset-4">
            Iniciá sesión
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field label="Contraseña" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres, con letras y números." value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Field label="Repetí la contraseña" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        {errors.form && <ErrorBox>{errors.form}</ErrorBox>}
        <Button type="submit" loading={busy} disabled={backendMissing} className="mt-2">
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RecoverScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!EMAIL_RE.test(email.trim())) return setError('Revisá el email.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/nueva-clave` });
    setBusy(false);
    if (err) return setError(authErrorMessage(err));
    setSent(true);
  }

  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te mandamos un enlace para elegir una nueva." footer={<Link to="/login" className="font-semibold text-ink underline underline-offset-4">Volver</Link>}>
      {sent ? (
        <p className="rounded-3xl border border-line bg-surface p-5 text-[15px]">
          Si hay una cuenta con <strong>{email.trim()}</strong>, vas a recibir el enlace en unos minutos.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" loading={busy} disabled={backendMissing}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function NewPasswordScreen() {
  const { clearRecovering } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(authErrorMessage(err));
    clearRecovering();
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Nueva contraseña">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Contraseña nueva" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres, con letras y números." value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" loading={busy}>
          Guardar
        </Button>
      </form>
    </AuthLayout>
  );
}
