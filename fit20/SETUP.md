# FIT 20 · Configuración del ecosistema

FIT 20 usa **proyectos nuevos y exclusivos**: un repositorio de GitHub, un proyecto de Supabase y un proyecto de Vercel. No se reutiliza nada de otros desarrollos.

```
GitHub (fit20) ──► Vercel (fit20) ──► app pública
                         │
                         └── variables públicas ──► Supabase (fit20)
```

Antes de conectar cualquier servicio, verificá que el nombre del proyecto sea **fit20** y que esté vacío o recién creado.

---

## 1. Repositorio de GitHub

1. Entrá a <https://github.com/new>.
2. **Repository name:** `fit20`. Visibilidad: *Private* (recomendado).
3. **No** marques "Add a README", ".gitignore" ni licencia (el proyecto ya los trae).
4. *Create repository*.
5. Desde la carpeta del proyecto:

```bash
git remote add origin https://github.com/<tu-usuario>/fit20.git
git push -u origin main
```

Comprobá que en GitHub **no** aparezca ningún archivo `.env`.

## 2. Proyecto de Supabase

1. Entrá a <https://supabase.com/dashboard> → *New project*.
2. **Organization:** la que corresponda (con plan gratuito se permiten 2 proyectos activos).
3. **Name:** `fit20`.
4. **Database password:** generá una fuerte y guardala en tu gestor de contraseñas (no se usa en la app).
5. **Region:** *South America (São Paulo)* — `sa-east-1`, la más cercana a Argentina.
6. *Create new project* y esperá ~2 minutos.

## 3 y 4. Base de datos y migraciones

**Opción A — CLI (recomendada):**

```bash
npx supabase login
npx supabase link --project-ref <REF>   # el REF está en la URL: supabase.com/dashboard/project/<REF>
npx supabase db push                    # aplica las 3 migraciones en orden
```

**Opción B — Panel web:** *SQL Editor* → pegá y ejecutá, **en este orden**, el contenido de:

1. `supabase/migrations/20261105000100_core_schema.sql`
2. `supabase/migrations/20261105000200_rls_and_storage.sql`
3. `supabase/migrations/20261105000300_seed_catalog.sql`

Verificación: *Table Editor* debe mostrar 18 tablas; `exercises` con 106 filas y `food_items` con 100.

## 5. Autenticación y RLS

1. *Authentication → Providers → Email*: activado, con **Confirm email** activado.
2. *Authentication → URL Configuration*:
   - **Site URL:** `https://fit20.vercel.app` (o el dominio final; para desarrollo `http://localhost:5173`).
   - **Redirect URLs:** agregá `http://localhost:5173/**` y `https://fit20.vercel.app/**`.
3. RLS ya queda activa en todas las tablas por la migración 002. Verificación: *Database → Tables* — todas deben decir "RLS enabled".
4. *Advisors → Security Advisor*: no debería haber alertas críticas.

## 6. Storage

La migración 002 crea el bucket **`progress-photos` privado** (10 MB por archivo, solo imágenes) con políticas por carpeta de usuario. Verificación: *Storage* → el bucket aparece con el candado (no público). No lo cambies a público.

## 7. Edge Functions

```bash
npx supabase functions deploy delete-account
# Opcional, solo si querés el asistente IA:
npx supabase functions deploy ai-coach
npx supabase secrets set AI_API_KEY=<clave-del-proveedor>   # queda en Supabase, nunca en el frontend
```

Sin `AI_API_KEY` la app funciona completa y muestra "Asistente no disponible".

## 8. Variables de entorno

En Supabase: *Project Settings → API*. Copiá **solo**:

| Variable | Dónde está | ¿Pública? |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | Sí |
| `VITE_SUPABASE_ANON_KEY` | `anon` / *publishable* key | Sí (protegida por RLS) |

⚠️ **Nunca** copies la `service_role` / *secret* key a `.env.local` ni a Vercel.

Desarrollo local:

```bash
cp .env.example .env.local   # y completá las dos variables
```

## 9. Proyecto de Vercel y primer deployment

1. <https://vercel.com/new> → *Import Git Repository* → elegí **`fit20`** (verificá que sea ese repositorio).
2. **Project Name:** `fit20`. **Framework Preset:** Vite (se detecta por `vercel.json`).
3. **Build Command:** `npm run build` · **Output Directory:** `dist`.
4. *Environment Variables*: agregá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Production, Preview y Development).
5. *Deploy*. Cada push a `main` despliega automáticamente.
6. Volvé al paso 5 y actualizá la **Site URL** de Supabase con el dominio que asignó Vercel.

## 10. Verificación

- [ ] La app abre en el dominio de Vercel y permite crear una cuenta (llega el email de confirmación).
- [ ] El onboarding guarda el perfil y aparece en `profiles` en Supabase.
- [ ] Modo avión → registrar una comida y un peso → la app indica "pendiente de sincronización".
- [ ] Cerrar y volver a abrir la app sin conexión: los datos siguen ahí.
- [ ] Reconectar → el indicador pasa a "sincronizado" y los registros aparecen **una sola vez** en Supabase.
- [ ] iPhone: Safari → Compartir → *Agregar a pantalla de inicio* → abre a pantalla completa y funciona en modo avión.
- [ ] Con un segundo usuario, verificar que no ve datos del primero.

## Servicios adicionales evaluados

| Servicio | Decisión | Costo |
|---|---|---|
| Mapas de recorridos | OpenStreetMap (tiles públicos, con atribución) | Gratis; sin API key |
| Fotos | Supabase Storage (bucket privado) | Incluido en el plan gratuito (1 GB) |
| Notificaciones | Notificaciones locales del navegador para el temporizador; sin servidor push en esta etapa | Gratis |
| IA | Opcional, vía Edge Function con clave en secrets | **Pago por uso** del proveedor: no se activa sin autorización |
