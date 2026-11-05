import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Button, Spinner } from '@/components/ui';
import { LoginScreen, NewPasswordScreen, RecoverScreen, SignupScreen } from '@/features/auth/AuthScreens';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { ProfileEditScreen, ProfileScreen } from '@/features/profile/ProfileScreen';
import { AddFoodScreen, CustomFoodScreen, EditFoodLogScreen, NutritionScreen, TargetsScreen } from '@/features/nutrition/NutritionScreens';
import { CompareScreen, MeasureScreen, NewPhotoScreen, PhotoScreen, ProgressScreen } from '@/features/progress/ProgressScreens';
import { LiveRunScreen } from '@/features/running/LiveRunScreen';
import { ManualRunScreen, RunDetailScreen, RunningHome } from '@/features/running/RunningScreens';
import { DayScreen } from '@/features/training/DayScreen';
import { HistoryScreen, WorkoutDetailScreen } from '@/features/training/HistoryScreens';
import { ExerciseDetailScreen, LibraryScreen } from '@/features/training/LibraryScreens';
import { PlanBuilderScreen } from '@/features/training/PlanBuilderScreen';
import { SessionScreen } from '@/features/training/SessionScreen';
import { TrainScreen } from '@/features/training/TrainScreen';
import { backendMissing } from '@/lib/supabase';
import { AppLayout } from './AppLayout';
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
        <Route path="entrenar" element={<TrainScreen />} />
        <Route path="entrenar/nuevo" element={<PlanBuilderScreen />} />
        <Route path="entrenar/dia/:id" element={<DayScreen />} />
        <Route path="entrenar/sesion/:id" element={<SessionScreen />} />
        <Route path="entrenar/biblioteca" element={<LibraryScreen />} />
        <Route path="entrenar/ejercicio/:id" element={<ExerciseDetailScreen />} />
        <Route path="entrenar/historial" element={<HistoryScreen />} />
        <Route path="entrenar/historial/:id" element={<WorkoutDetailScreen />} />
        <Route path="running" element={<RunningHome />} />
        <Route path="running/en-curso" element={<LiveRunScreen />} />
        <Route path="running/manual" element={<ManualRunScreen />} />
        <Route path="running/:id" element={<RunDetailScreen />} />
        <Route path="nutricion" element={<NutritionScreen />} />
        <Route path="nutricion/agregar" element={<AddFoodScreen />} />
        <Route path="nutricion/registro/:id" element={<EditFoodLogScreen />} />
        <Route path="nutricion/alimento-nuevo" element={<CustomFoodScreen />} />
        <Route path="nutricion/objetivos" element={<TargetsScreen />} />
        <Route path="progreso" element={<ProgressScreen />} />
        <Route path="progreso/medir" element={<MeasureScreen />} />
        <Route path="progreso/foto-nueva" element={<NewPhotoScreen />} />
        <Route path="progreso/foto/:id" element={<PhotoScreen />} />
        <Route path="progreso/comparar" element={<CompareScreen />} />
        <Route path="perfil" element={<ProfileScreen />} />
        <Route path="perfil/:section" element={<ProfileEditScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
