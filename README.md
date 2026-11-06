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
| Fase 6: sincronización en la app, indicador de estado, conflictos visibles con "usar la de este dispositivo" | ✅ |
| Fase 7: PWA instalable (íconos, atajos, guía para iPhone/Android, actualización sin cortes), "Para hoy", exportar datos, prueba end-to-end | ✅ |
| Cardio: running, caminata y bici con el mismo GPS; planes que combinan fuerza + cardio | ✅ |
| Clima (Open-Meteo): pronóstico, mejor hora para salir y consejos según la actividad | ✅ |
| Notificaciones push: aviso de la mañana (sesión + clima) y recordatorio de la noche | ✅ |
| Supabase `fit20` (São Paulo) | ✅ Creado y configurado |
| GitHub (`laureanoff/FIT20`) | ✅ |
| Vercel (https://fit20.vercel.app) | ✅ |

## Clima y notificaciones

- **Clima**: en Inicio, Cardio y cada día del plan. Usa tu ubicación aproximada (~1 km), que queda en el teléfono; si salís con GPS la toma de ahí sin volver a pedir permiso.
- **Notificaciones**: Perfil → Notificaciones → *Activar*. Elegís la hora del aviso de la mañana (qué entrenás hoy + clima) y, si querés, un recordatorio a la noche solo cuando la sesión sigue pendiente. En **iPhone** primero hay que instalar la app (Compartir → *Agregar a inicio*) y activarlas desde ahí (iOS 16.4 o más nuevo).
- **Música (Spotify)**: Perfil → Música. Se activa una vez creando una app en developer.spotify.com (requiere Premium) y pegando su Client ID; después, en la salida de cardio y en la sesión de fuerza ves qué suena, pausás, pasás de tema y elegís playlists. La música suena en la app de Spotify. Opcional: `VITE_SPOTIFY_CLIENT_ID` en Vercel para no pegarlo en cada teléfono.
- **Audio en la salida**: "Con música" (por defecto) no toca el audio del teléfono; avisos por voz cada km (cada 5 km en bici).
- **Modo bolsillo**: pantalla negra con tiempo, km y ritmo mientras la app sigue abierta (Wake Lock). Es la única forma de que el GPS siga midiendo en iPhone: Safari pausa la ubicación de las apps web con el celu bloqueado (no existe permiso de ubicación en segundo plano para la web). Wake Lock funciona en la app instalada desde iOS 18.4.
- **Notificación en vivo**: en la salida elegís cada cuánto (1, 2 o 5 min). El teléfono informa tiempo, distancia y ritmo a `live_sessions` y `pg_cron` (cada minuto, solo si hay alguna pendiente) le pide a `send-reminders` que mande la notificación, que reemplaza a la anterior. Llega aunque escuches Spotify y aunque el iPhone congele la app; con el celu bloqueado la distancia se estima con tu ritmo (≈). Las "Actividades en vivo" de iOS solo existen para apps nativas.
- **Pantalla bloqueada**: durante una salida con GPS, km, tiempo y ritmo aparecen en la pantalla de bloqueo (panel de "reproduciendo ahora"), con pausa/reanudar sin desbloquear. Se puede apagar antes de largar. Usa un tono inaudible para que el sistema lo muestre, así que puede pausar la música de otra app.
- Cómo funciona: `pg_cron` llama cada 15 min a la Edge Function `send-reminders`, que calcula la hora local de cada persona y manda Web Push (VAPID). Las claves viven en Supabase Vault.

## Usarla sin internet

1. La primera vez, con conexión: abrí https://fit20.vercel.app e iniciá sesión (espera unos segundos en el inicio).
2. Instalala: **iPhone** → Safari → Compartir → *Agregar a inicio*. **Android** → Chrome → ⋮ → *Instalar app*.
3. Desde ahí funciona sin conexión: plan, entrenamiento, GPS, comidas, peso y fotos se guardan en el teléfono y se suben solos al reconectar.

Necesitan internet: crear la cuenta / iniciar sesión, sincronizar entre dispositivos, el fondo del mapa en zonas no vistas, actualizar el clima (sin conexión se ve el último pronóstico) y activar las notificaciones. En iPhone el GPS se pausa si la app queda en segundo plano.

Detalle de arquitectura, decisiones y plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar con el proyecto Supabase de FIT 20
npm run dev
```

## Pruebas

```bash
npm run test:core   # typecheck estricto + 69 tests del núcleo (sin red ni navegador)
npm run test:db     # migraciones + RLS sobre un Postgres local descartable
npm test            # núcleo + Vitest (IndexedDB, sincronización, entrenamiento, running, nutrición, progreso)
python3 scripts/e2e_smoke.py  # recorrido completo en Chrome sin conexión (ver el encabezado del script)
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
