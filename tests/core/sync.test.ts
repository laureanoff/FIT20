import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enqueue, processQueue, queueStats, recoverInterrupted, resolvePulled, retryFailed, MAX_ATTEMPTS } from '../../src/core/sync/queue.ts';
import type { ConflictEvent, EntityName, OutboxStore, PushRequest, PushResult, RecordData, ServerRecord, SyncOperation, SyncRemote } from '../../src/core/sync/types.ts';

// ───────── Dobles de prueba con la misma semántica que Postgres + RLS ─────────

class MemoryOutbox implements OutboxStore {
  ops = new Map<string, SyncOperation>();
  async list() { return [...this.ops.values()].map((o) => structuredClone(o)); }
  async put(op: SyncOperation) { this.ops.set(op.id, structuredClone(op)); }
  async remove(id: string) { this.ops.delete(id); }
  /** Simula cerrar la app: serializa y rehidrata (como IndexedDB). */
  reopen() { const o = new MemoryOutbox(); o.ops = new Map(JSON.parse(JSON.stringify([...this.ops]))); return o; }
}

class FakeServer implements SyncRemote {
  tables = new Map<EntityName, Map<string, ServerRecord>>();
  online = true;
  clock = Date.parse('2026-11-05T12:00:00Z');
  /** Aplica la próxima escritura pero "pierde" la respuesta (timeout). */
  dropNextResponse = false;
  calls: PushRequest[] = [];

  table(e: EntityName) {
    if (!this.tables.has(e)) this.tables.set(e, new Map());
    return this.tables.get(e)!;
  }
  rows(e: EntityName) { return [...this.table(e).values()]; }

  /** Edición hecha desde otro dispositivo. */
  externalEdit(e: EntityName, id: string, fields: RecordData, at: number) {
    const row = this.table(e).get(id)!;
    Object.assign(row, fields, { version: row.version + 1, updated_at: new Date(at).toISOString() });
  }

  async push(req: PushRequest): Promise<PushResult> {
    this.calls.push(structuredClone(req));
    if (!this.online) return { kind: 'retry', error: 'Failed to fetch' };
    const t = this.table(req.entity);
    const ts = new Date(++this.clock).toISOString();
    let result: PushResult;
    if (req.mode === 'create') {
      const existing = t.get(req.id);
      if (existing) return { kind: 'conflict', server: structuredClone(existing) };
      // Integridad referencial (FK).
      if (req.entity === 'training_days' && !this.table('training_plans').has(String(req.fields.plan_id))) {
        return { kind: 'fatal', error: 'violates foreign key constraint' };
      }
      const row = { deleted_at: null, ...req.fields, id: req.id, version: 1, updated_at: ts } as ServerRecord;
      t.set(req.id, row);
      result = { kind: 'applied', record: structuredClone(row) };
    } else {
      const row = t.get(req.id);
      if (!row) return { kind: 'missing' };
      if (row.version !== req.base_version) return { kind: 'conflict', server: structuredClone(row) };
      Object.assign(row, req.fields, { version: row.version + 1, updated_at: ts });
      result = { kind: 'applied', record: structuredClone(row) };
    }
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      return { kind: 'retry', error: 'timeout' };
    }
    return result;
  }
}

/** Dispositivo: base local (como IndexedDB) + cola. */
class Device {
  records = new Map<string, RecordData & { version: number | null }>();
  conflicts: ConflictEvent[] = [];
  now = Date.parse('2026-11-05T10:00:00Z');
  constructor(public outbox: MemoryOutbox, public server: FakeServer) {}

  async create(entity: EntityName, data: RecordData) {
    const id = randomUUID();
    const rec = { ...data, id, version: null, deleted_at: null };
    this.records.set(id, rec);
    await enqueue(this.outbox, { operation: 'upsert', entity, entity_id: id, record: rec, changed_fields: Object.keys(data), base_version: null, base_values: {} }, ++this.now, randomUUID);
    return id;
  }
  async edit(entity: EntityName, id: string, fields: RecordData) {
    const prev = this.records.get(id)!;
    const base_values: RecordData = {};
    for (const k of Object.keys(fields)) base_values[k] = prev[k];
    const rec = { ...prev, ...fields };
    this.records.set(id, rec);
    await enqueue(this.outbox, { operation: 'upsert', entity, entity_id: id, record: rec, changed_fields: Object.keys(fields), base_version: prev.version, base_values }, ++this.now, randomUUID);
  }
  async remove(entity: EntityName, id: string) {
    const prev = this.records.get(id)!;
    const rec = { ...prev, deleted_at: new Date(this.now).toISOString() };
    this.records.set(id, rec);
    await enqueue(this.outbox, { operation: 'delete', entity, entity_id: id, record: rec, changed_fields: ['deleted_at'], base_version: prev.version, base_values: { deleted_at: null } }, ++this.now, randomUUID);
  }
  sync() {
    return processQueue(this.outbox, this.server, {
      onApplied: (_op, rec) => { this.records.set(rec.id, { ...this.records.get(rec.id), version: rec.version, updated_at: rec.updated_at }); },
      onServerKept: (_op, rec) => { this.records.set(rec.id, structuredClone(rec)); },
      onConflict: (e) => { this.conflicts.push(e); },
    }, () => this.now);
  }
}

function setup() {
  const server = new FakeServer();
  const device = new Device(new MemoryOutbox(), server);
  return { server, device };
}

// ───────── Tests ─────────

test('flujo completo offline: crear registros, cerrar la app, volver a abrir, reconectar → sin duplicados', async () => {
  const { server, device } = setup();
  server.online = false;
  await device.create('food_logs', { food_item_id: 'arroz-blanco-cocido', quantity: 200, meal_type: 'lunch' });
  await device.create('running_sessions', { distance_km: 5, duration_seconds: 1800 });
  await device.create('body_measurements', { weight_kg: 81.2 });
  const s1 = await device.sync();
  assert.equal(s1.stopped_offline, true);
  assert.equal(server.rows('food_logs').length, 0);

  // Cerrar y reabrir la app: la cola persiste.
  device.outbox = device.outbox.reopen();
  assert.equal((await queueStats(device.outbox)).error + (await queueStats(device.outbox)).pending, 3);

  server.online = true;
  device.now += 60 * 60_000; // pasa el backoff
  const s2 = await device.sync();
  assert.equal(s2.synced, 3);
  assert.equal(s2.remaining, 0);
  assert.equal(server.rows('food_logs').length, 1);
  assert.equal(server.rows('running_sessions').length, 1);
  assert.equal(server.rows('body_measurements').length, 1);

  // Sincronizar de nuevo no reenvía nada.
  const calls = server.calls.length;
  await device.sync();
  assert.equal(server.calls.length, calls);
});

test('idempotencia: respuesta perdida tras aplicar en el servidor no duplica el registro', async () => {
  const { server, device } = setup();
  await device.create('water_logs', { quantity_ml: 250 });
  server.dropNextResponse = true;
  const s1 = await device.sync();
  assert.equal(s1.failed, 1);
  assert.equal(server.rows('water_logs').length, 1); // se aplicó aunque el cliente no lo supo
  device.now += 60_000;
  const s2 = await device.sync();
  assert.equal(s2.synced, 1);
  assert.equal(server.rows('water_logs').length, 1);
});

test('reintento de creación con ediciones posteriores aplica los cambios pendientes', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  server.dropNextResponse = true;
  await device.sync();
  await device.edit('food_logs', id, { quantity: 150 }); // edición offline sobre op con error → se fusiona
  device.now += 60_000;
  await device.sync();
  assert.equal(server.rows('food_logs').length, 1);
  assert.equal(server.table('food_logs').get(id)!.quantity, 150);
});

test('varias ediciones antes de sincronizar se fusionan en una sola operación', async () => {
  const { server, device } = setup();
  const id = await device.create('body_measurements', { weight_kg: 80, waist_cm: 90 });
  await device.edit('body_measurements', id, { weight_kg: 79.8 });
  await device.edit('body_measurements', id, { waist_cm: 89 });
  assert.equal((await device.outbox.list()).length, 1);
  await device.sync();
  assert.equal(server.calls.length, 1);
  assert.deepEqual([server.table('body_measurements').get(id)!.weight_kg, server.table('body_measurements').get(id)!.waist_cm], [79.8, 89]);
});

test('crear y borrar sin conexión no envía nada', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  await device.remove('food_logs', id);
  assert.equal((await device.outbox.list()).length, 0);
  await device.sync();
  assert.equal(server.calls.length, 0);
});

test('borrado lógico de un registro sincronizado', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  await device.sync();
  await device.remove('food_logs', id);
  await device.sync();
  assert.ok(server.table('food_logs').get(id)!.deleted_at);
  assert.equal(server.rows('food_logs').length, 1); // no se borra físicamente
});

test('conflicto en campos distintos: se combinan ambos cambios', async () => {
  const { server, device } = setup();
  const id = await device.create('training_plans', { name: 'Plan A', status: 'active' });
  await device.sync();
  server.externalEdit('training_plans', id, { status: 'paused' }, device.now + 1);
  await device.edit('training_plans', id, { name: 'Plan verano' });
  await device.sync();
  const row = server.table('training_plans').get(id)!;
  assert.equal(row.name, 'Plan verano');
  assert.equal(row.status, 'paused');
  assert.equal(device.conflicts.length, 0);
});

test('mismo campo, política "newer_wins": gana la edición más reciente', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  await device.sync();
  server.externalEdit('food_logs', id, { quantity: 120 }, device.now - 5_000); // edición vieja en otro dispositivo
  await device.edit('food_logs', id, { quantity: 180 });
  await device.sync();
  assert.equal(server.table('food_logs').get(id)!.quantity, 180);
  assert.equal(device.conflicts[0]!.resolution, 'local_won');
});

test('mismo campo, servidor más reciente: NO se sobrescribe y se avisa', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  await device.sync();
  await device.edit('food_logs', id, { quantity: 180 });
  server.externalEdit('food_logs', id, { quantity: 120 }, device.now + 60_000); // más reciente
  await device.sync();
  assert.equal(server.table('food_logs').get(id)!.quantity, 120);
  assert.equal(device.records.get(id)!.quantity, 120); // local actualizado al valor del servidor
  assert.equal(device.conflicts[0]!.resolution, 'server_kept');
  assert.equal(device.conflicts[0]!.local.quantity, 180); // el valor local queda guardado para el usuario
});

test('perfil (política manual): conserva el servidor aunque la edición local sea más nueva', async () => {
  const { server, device } = setup();
  const id = await device.create('profiles', { full_name: 'Lau', target_weight_kg: 75 });
  await device.sync();
  server.externalEdit('profiles', id, { target_weight_kg: 72 }, device.now - 10_000);
  await device.edit('profiles', id, { target_weight_kg: 70 });
  await device.sync();
  assert.equal(server.table('profiles').get(id)!.target_weight_kg, 72);
  assert.equal(device.conflicts[0]!.resolution, 'server_kept');
});

test('editado localmente pero borrado en otro dispositivo', async () => {
  const { server, device } = setup();
  const id = await device.create('food_logs', { quantity: 100 });
  await device.sync();
  server.externalEdit('food_logs', id, { deleted_at: new Date(device.now).toISOString() }, device.now + 1);
  await device.edit('food_logs', id, { quantity: 150 });
  await device.sync();
  assert.equal(device.conflicts[0]!.resolution, 'deleted_remotely');
  assert.ok(device.records.get(id)!.deleted_at);
});

test('orden padre → hijo respeta las claves foráneas', async () => {
  const { server, device } = setup();
  // El hijo se crea primero en el tiempo, pero debe enviarse después del plan.
  const planId = randomUUID();
  await device.create('training_days', { plan_id: planId, day_number: 1 });
  device.records.set(planId, { id: planId, version: null });
  await enqueue(device.outbox, { operation: 'upsert', entity: 'training_plans', entity_id: planId, record: { id: planId, name: 'P' }, changed_fields: ['name'], base_version: null, base_values: {} }, ++device.now, randomUUID);
  const s = await device.sync();
  assert.equal(s.synced, 2);
  assert.equal(s.failed, 0);
  assert.equal(server.calls[0]!.entity, 'training_plans');
});

test('una app cerrada a mitad de sincronización recupera las operaciones', async () => {
  const { device } = setup();
  await device.create('water_logs', { quantity_ml: 500 });
  const [op] = await device.outbox.list();
  await device.outbox.put({ ...op!, status: 'syncing' });
  assert.equal(await recoverInterrupted(device.outbox), 1);
  assert.equal((await device.outbox.list())[0]!.status, 'pending');
});

test('límite de intentos y reintento manual', async () => {
  const { server, device } = setup();
  server.online = false;
  await device.create('water_logs', { quantity_ml: 500 });
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    await device.sync();
    device.now += 24 * 3600_000;
  }
  const [op] = await device.outbox.list();
  assert.equal(op!.attempts, MAX_ATTEMPTS);
  assert.equal(op!.status, 'error');
  server.online = true;
  await retryFailed(device.outbox, device.now);
  const s = await device.sync();
  assert.equal(s.synced, 1);
});

test('descarga de cambios del servidor', () => {
  assert.equal(resolvePulled(undefined, { version: 1 }, false), 'insert');
  assert.equal(resolvePulled({ version: 1 }, { version: 3 }, false), 'replace');
  assert.equal(resolvePulled({ version: 3 }, { version: 3 }, false), 'keep');
  assert.equal(resolvePulled({ version: 1 }, { version: 3 }, true), 'keep');
});
