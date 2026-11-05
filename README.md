# FIT 20

Entrenador personal digital: planes de entrenamiento personalizados, running con GPS, nutrición, progreso físico y estadísticas. **Offline-first**: todo lo esencial funciona sin internet y se sincroniza con la nube al reconectar.

PWA instalable en iPhone y Android · React + TypeScript + Vite · Supabase · IndexedDB (Dexie).

## Estado

| Fase | Estado |
|---|---|
| Núcleo de dominio (motor de planes, nutrición, temporizadores, running, sincronización) | ✅ Implementado y testeado |
| Biblioteca de 106 ejercicios · base de 100 alimentos argentinos | ✅ |
| Base de datos: esquema, RLS, Storage privado, catálogo | ✅ Aplicada en el proyecto Supabase `fit20` |
| Edge Functions (eliminar cuenta, asistente IA opcional) | ✅ Desplegadas |
| Fase 1: shell, navegación, IndexedDB, auth, onboarding, perfil, dashboard | ✅ |
| Fase 2: biblioteca, generador de planes, calendario, sesión de fuerza con temporizador, historial | ✅ |
| Fase 3: running con GPS, mapa, registro manual, parciales y marcas | ✅ |
| Fase 4: nutrición (buscador, porciones, agua, objetivos, comidas guardadas, alimentos propios) | ✅ |
| Fase 5: progreso (peso, medidas, fotos privadas, gráficos, antes y después) | ✅ |
| Plan de alimentación según el objetivo (semana de comidas, cambiar, rearmar, "Lo comí") | ✅ |
| Fase 6–7: conflictos visibles, notificaciones, pulido PWA | 🚧 Siguiente etapa |
| Supabase `fit20` (São Paulo) | ✅ Creado y configurado |
| GitHub (`laureanoff/FIT20`) | ✅ |
| Vercel (https://fit20.vercel.app) | ✅ |

Detalle de arquitectura, decisiones y plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar con el proyecto Supabase de FIT 20
npm run dev
```

## Pruebas

```bash
npm run test:core   # typecheck estricto + 64 tests del núcleo (sin red ni navegador)
npm run test:db     # migraciones + RLS sobre un Postgres local descartable
npm test            # núcleo + Vitest (IndexedDB, sincronización en la app, formularios)
```

`test:db` necesita PostgreSQL 15+ instalado localmente. No toca ningún proyecto de Supabase.

## Catálogo

Ejercicios y alimentos viven en `src/data/` (los usa la app offline) y se publican a la base con:

```bash
npm run seed:generate   # regenera supabase/migrations/…_seed_catalog.sql
```

## Seguridad

- Nunca commitear `.env*` (ya están en `.gitignore`).
- El frontend solo usa la URL y la clave pública (anon/publishable) de Supabase.
- La `service_role` y la clave de IA existen únicamente como secrets de las Edge Functions.
