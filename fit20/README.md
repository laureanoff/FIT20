# FIT 20

Entrenador personal digital: planes de entrenamiento personalizados, running con GPS, nutrición, progreso físico y estadísticas. **Offline-first**: todo lo esencial funciona sin internet y se sincroniza con la nube al reconectar.

PWA instalable en iPhone y Android · React + TypeScript + Vite · Supabase · IndexedDB (Dexie).

## Estado

| Fase | Estado |
|---|---|
| Núcleo de dominio (motor de planes, nutrición, temporizadores, running, sincronización) | ✅ Implementado y testeado |
| Biblioteca de 106 ejercicios · base de 100 alimentos argentinos | ✅ |
| Base de datos: esquema, RLS, Storage privado, catálogo | ✅ Migraciones verificadas en Postgres |
| Edge Functions (eliminar cuenta, asistente IA opcional) | ✅ Escritas · pendiente de deploy |
| Interfaz (pantallas, navegación, PWA, IndexedDB) | 🚧 Siguiente etapa |
| Proyectos Supabase / GitHub / Vercel nuevos | ⏳ Ver [SETUP.md](SETUP.md) |

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
npm test            # suite completa con Vitest (incluye UI, cuando esté)
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
