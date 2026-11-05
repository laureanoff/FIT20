# FIT 20 · Arquitectura y plan de implementación

## Auditoría inicial (5 de noviembre de 2026)

- **Proyecto existente:** ninguno. FIT 20 se inicializó desde cero en un repositorio propio.
- **Supabase:** la organización disponible ("Invictus", plan gratuito) tiene 3 proyectos de otros desarrollos. **No se usa ninguno**: FIT 20 va en un proyecto nuevo e independiente.
- **GitHub / Vercel:** sin acceso autorizado desde el entorno de desarrollo al momento de la auditoría; los proyectos se crean siguiendo [SETUP.md](../SETUP.md).
- **Entorno:** la instalación de paquetes npm estaba bloqueada, por eso se construyó primero todo lo que no depende de librerías externas (dominio, datos, base de datos) y se verificó con el runner de tests nativo de Node y un PostgreSQL local.

## Vista general

```
┌──────────────────────── Dispositivo (PWA) ────────────────────────┐
│  UI React + Tailwind                                               │
│     │  lee/escribe SIEMPRE local (respuesta instantánea, offline)  │
│     ▼                                                              │
│  Repositorios ──► IndexedDB (Dexie)  ◄── Service Worker (Workbox)  │
│     │                  ▲                 app shell precacheado     │
│     ▼                  │                                           │
│  Cola de sincronización (outbox) ── SupabaseRemote ─────────┐      │
└─────────────────────────────────────────────────────────────┼──────┘
                                                              ▼
                         Supabase: PostgreSQL + RLS · Auth · Storage privado
                                   Edge Functions: delete-account · ai-coach (opcional)
```

**Principio:** la UI nunca espera a la red. Cada cambio se guarda en IndexedDB y genera una operación en la cola; la cola sube los cambios cuando hay conexión y descarga los del servidor.

## Módulos

| Carpeta | Contenido | Depende de |
|---|---|---|
| `src/types/` | Tipos de dominio | — |
| `src/data/exercises/` | 106 ejercicios estructurados (patrón de movimiento, zonas de estrés articular, variantes) | — |
| `src/data/foods/` | 100 alimentos argentinos por 100 g, crudo/cocido separados, porciones | — |
| `src/core/planning/` | Motor determinístico de planes + reglas explícitas | data |
| `src/core/nutrition/` | Estimación energética segura, registro de comidas, buscador | data |
| `src/core/timer/` | Temporizador y cronómetro basados en timestamps | — |
| `src/core/running/` | GPS con filtrado, parciales, ritmo, marcas personales | — |
| `src/core/stats/` | Agregados semanales/mensuales, racha, consistencia | — |
| `src/core/sync/` | Cola de sincronización, fusión de cambios, conflictos | — |
| `src/lib/sync/` | Adaptador Supabase de la cola | core/sync |
| `src/app/` | Rutas, layout, auth y proveedor de datos (IndexedDB + sincronización) | core, lib |
| `src/lib/db/` | Base IndexedDB por usuario (Dexie) y repositorio: escribe local + encola en la misma transacción | core/sync |
| `src/lib/sync/engine.ts` | Ciclo de sincronización en la app: sube la cola, descarga por `updated_at`, estado para la UI | core/sync, lib/sync |
| `src/features/*` | Pantallas por módulo | core, lib |
| `supabase/` | Migraciones, catálogo, Edge Functions | — |

`src/core` no importa React, Dexie ni Supabase: es TypeScript puro, testeable y reutilizable.

## Motor de planes (sin IA, sin azar)

Reglas en `src/core/planning/rules.ts`; cada una tiene un test:

- **Días:** solo se entrena los días elegidos. Siempre hay ≥1 descanso completo por semana. Tope de días exigentes por nivel (4/5/6); los días extra pasan a recuperación activa. Máximo 2 días exigentes seguidos para principiantes, 3 para el resto.
- **Fuerza:** sesiones armadas por **patrones de movimiento** (sentadilla, bisagra, empuje, tracción, core…), no por músculo al azar. Split según días: cuerpo completo (1–3 días), torso/pierna (4), empuje/tracción/pierna (5–6). Dos días seguidos de fuerza nunca cargan los mismos grupos grandes.
- **Progresión:** mesociclos de 4 semanas (base → base → +1 serie → descarga −40%). Los ejercicios se mantienen dentro del mesociclo (sobrecarga progresiva) y rotan al siguiente.
- **Running:** el fondo inicial es ~80% de lo que la persona corre hoy. El volumen semanal crece ≤10% entre semanas de carga, **incluido el redondeo**, y baja en descarga. Sin experiencia → trote/caminata. Principiantes: sin intervalos las 2 primeras semanas.
- **Lesiones:** se excluyen ejercicios que cargan la zona declarada.
- **Tiempo:** el volumen se ajusta a los minutos disponibles.
- **Fatiga/dolor:** `adjustForReadiness` solo reduce o suspende, nunca agrega; ante dolor reemplaza ejercicios, suspende la carrera si es zona de impacto y recomienda evaluación profesional. `detectFatigue` sugiere reducir o descargar con RPE/fatiga altos sostenidos.
- **Sesiones perdidas:** no se duplican ni acumulan. `rescheduleDay` solo mueve a un día de descanso.

## Sincronización offline

- **IDs:** UUID generados en el dispositivo → reenviar no duplica (insert idempotente por id).
- **Versión:** el servidor incrementa `version` en cada update (trigger). Los updates son condicionales a la versión base (control optimista).
- **Cola:** cada operación guarda id, fecha, tipo, entidad, estado (`pending → syncing → synced | error`), intentos y backoff exponencial. Ediciones repetidas sobre el mismo registro se **fusionan**. Crear y borrar sin conexión no envía nada.
- **Orden:** padres antes que hijos (FK). Un error de red detiene el ciclo y reintenta con backoff.
- **Nada se borra hasta confirmar:** la operación se marca sincronizada solo con respuesta del servidor; los borrados son lógicos (`deleted_at`).
- **Conflictos** (versión del servidor más nueva):
  1. Cambios en **campos distintos** → se combinan (rebase).
  2. **Mismo campo**, registros personales (comidas, carreras, medidas…) → gana la edición más reciente; la otra queda registrada.
  3. **Mismo campo**, perfil/configuración/planes → se conserva el servidor y la versión local se guarda para que la persona elija.
  4. Borrado en otro dispositivo → se respeta el borrado y se avisa.
- **Cierre abrupto:** operaciones que quedaron "sincronizando" vuelven a pendientes al abrir.

## Cambios al esquema sugerido (y por qué)

| Cambio | Motivo |
|---|---|
| `running_gps_points` → `running_tracks` (un recorrido JSON por sesión) | Una hora de carrera son ~700 puntos: serían 700 operaciones de sync y 700 filas por carrera. |
| `sync_operations` vive en IndexedDB, no en Postgres | La cola es del dispositivo. La idempotencia en el servidor se logra con UUID + versión, sin tabla extra. |
| `version`, `updated_at`, `deleted_at` en todas las tablas | Control de concurrencia, descarga incremental y borrado sin pérdida. |
| `food_logs` guarda un snapshot de nombre y macros | Editar un alimento no altera el historial ya registrado. |
| `saved_meals` (nueva) | Comidas frecuentes reutilizables. |
| `training_days.planned` (jsonb) | El día planificado completo (ejercicios, carrera, instrucciones) viaja como una unidad. |
| `user_id` en tablas hijas + políticas que verifican al padre | RLS simple y rápida, y nadie puede colgar datos de un plan ajeno adivinando su UUID. |
| `average_pace_s` columna generada | El ritmo lo calcula la base: no puede quedar inconsistente. |

## Qué necesita internet

| Funciona sin internet | Necesita internet |
|---|---|
| Ver y generar planes, entrenar, temporizadores | Crear cuenta / iniciar sesión por primera vez |
| Registrar carreras (GPS es satelital, no usa datos) | Sincronizar entre dispositivos y respaldo en la nube |
| Registrar comidas, agua, peso y medidas | Subir y ver fotos de progreso desde otro dispositivo |
| Biblioteca de ejercicios y base de alimentos | Asistente IA (opcional) |
| Estadísticas y gráficos | Mapas de recorridos no vistos antes (los tiles se cachean) |

**Limitaciones de iOS:** Safari no permite GPS en segundo plano para PWAs; el seguimiento funciona con la app en primer plano (se usa Wake Lock para mantener la pantalla). Las notificaciones push requieren iOS 16.4+ y la app instalada en la pantalla de inicio.

## Plan de implementación

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Núcleo de dominio + datos + base de datos + tests | ✅ |
| 1 | Shell de la app: navegación, diseño, IndexedDB, auth, onboarding, perfil, dashboard | ✅ |
| 2 | Biblioteca, generador de planes, calendario, sesión de fuerza con temporizador, historial | Siguiente |
| 3 | Running: cronómetro, GPS + mapa, manual, parciales, estadísticas | |
| 4 | Nutrición: buscador, registro por comida, agua, objetivos, comidas frecuentes | |
| 5 | Progreso: peso, medidas, fotos privadas, gráficos, "Antes y después" | |
| 6 | Conexión a Supabase nuevo, sincronización en la app, indicador de estado | |
| 7 | PWA (instalación iPhone), pruebas end-to-end, deploy en Vercel | |
