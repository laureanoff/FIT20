import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Button, Spinner } from '@/components/ui';
import { LoginScreen, NewPasswordScreen, RecoverScreen, SignupScreen } from '@/features/auth/AuthScreens';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { ProfileEditScreen, ProfileScreen } from '@/features/profile/ProfileScreen';
import { backendMissing } from '@/lib/supabase';
import { AppLayout, ComingSoon, SECTIONS } from './AppLayout';
import { AuthProvider, useAuth } from './auth';
import { DataProvider, useData } from './data';

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

function AppRoutes() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Spinner />;
  if (recovering) return <NewPasswordScreen />;

  if (!session || backendMissing) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/registro" element={<SignupScreen />} />
        <Route path="/recuperar" element={<RecoverScreen />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <DataProvider key={session.user.id} userId={session.user.id} email={session.user.email ?? ''}>
      <UserGate />
    </DataProvider>
  );
}

/** Decide entre onboarding y app según el perfil local (y la primera descarga en un dispositivo nuevo). */
function UserGate() {
  const { profile, initialPullDone } = useData();
  const [waitedLong, setWaitedLong] = useState(false);
  const [skipPull, setSkipPull] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaitedLong(true), 8000);
    return () => clearTimeout(t);
  }, []);

  if (profile === undefined || initialPullDone === undefined) return <Spinner />;

  // Dispositivo nuevo: antes de pedir el onboarding, traer el perfil que la cuenta ya pudiera tener.
  if (!profile && !initialPullDone && !skipPull) {
    return (
      <div className="mx-auto max-w-md px-5">
        <Spinner label="Cargando tu cuenta…" />
        {(waitedLong || !navigator.onLine) && (
          <div className="-mt-24 flex flex-col items-center gap-3 text-center">
            <p className="text-[14px] text-muted">No pudimos conectarnos todavía. Si es tu primera vez en FIT 20 podés seguir; si ya tenés un perfil, conectate para recuperarlo.</p>
            <Button variant="secondary" onClick={() => setSkipPull(true)}>
              Continuar sin conexión
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!profile || !profile.onboarding_completed) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingScreen />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardScreen />} />
        <Route path="entrenar" element={<ComingSoon {...SECTIONS.train} />} />
        <Route path="running" element={<ComingSoon {...SECTIONS.run} />} />
        <Route path="nutricion" element={<ComingSoon {...SECTIONS.food} />} />
        <Route path="progreso" element={<ComingSoon {...SECTIONS.progress} />} />
        <Route path="perfil" element={<ProfileScreen />} />
        <Route path="perfil/:section" element={<ProfileEditScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
