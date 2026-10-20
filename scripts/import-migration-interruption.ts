import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { Client } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"

/** Inspect the installed implementation, rather than assuming breakpoint atomicity. */
export async function drizzleTransactionContract() {
  const require = createRequire(path.resolve("package.json"))
  const base = path.dirname(require.resolve("drizzle-orm/node-postgres"))
  const dialect = await readFile(
    path.join(base, "../pg-core/dialect.cjs"),
    "utf8"
  )
  const session = await readFile(path.join(base, "session.cjs"), "utf8")
  const pkg = JSON.parse(
    await readFile(path.join(base, "../package.json"), "utf8")
  )
  assert.match(dialect, /await session\.transaction\(async \(tx\) =>/)
  assert.match(
    dialect,
    /for \(const stmt of migration\.sql\)[\s\S]*?await tx\.execute\([\w.]*sql\.raw\(stmt\)\)/
  )
  assert.match(
    dialect,
    /await tx\.execute\([\s\S]*?insert into \$\{[\w.]*sql\.identifier\(migrationsSchema\)\}/
  )
  assert.match(session, /await tx\.execute\([\w.]*sql`begin/)
  assert.match(session, /await tx\.execute\([\w.]*sql`commit`\)/)
  assert.match(
    session,
    /catch \(error\)[\s\S]*?await tx\.execute\([\w.]*sql`rollback`\)/
  )
  return {
    version: pkg.version as string,
    transaction: "all pending statements and ledger rows"
  }
}

export async function databaseSize(client: Client) {
  return Number(
    (await client.query("select pg_database_size(current_database()) as bytes"))
      .rows[0].bytes
  )
}

/** Catalog definitions must also roll back; row equality alone cannot prove that. */
export async function schemaManifest(client: Client) {
  const columns = (
    await client.query(
      "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position"
    )
  ).rows
  const constraints = (
    await client.query(
      "select c.relname, con.conname,pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname"
    )
  ).rows
  const triggers = (
    await client.query(
      "select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname"
    )
  ).rows
  const indexes = (
    await client.query(
      "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname"
    )
  ).rows
  const functions = (
    await client.query(
      "select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.proname,p.oid"
    )
  ).rows
  return { columns, constraints, triggers, indexes, functions }
}

/**
 * Test-only event/row triggers pause the unmodified INSERT after eight rows.
 * A sequence is deliberately nontransactional so another session can prove
 * partial statement progress without reading uncommitted evidence. The event
 * trigger is scoped to this empty, disposable test database and removed below.
 * No migration SQL, migrator query or immutable evidence guard is replaced.
 */
export async function interruptAssetCopy(
  connectionString: string,
  migrationsFolder: string,
  observer: Client
) {
  const backend = new Client({
    connectionString,
    application_name: "matsci-migration-interruption-fixture"
  })
  backend.on("error", () => {
    /* Expected connection termination is asserted below. */
  })
  let outcome: Promise<{ error: unknown } | { migrated: true }> | undefined
  const started = performance.now()
  try {
    await observer.query(`
      CREATE SEQUENCE migration_test_copy_progress;
      CREATE FUNCTION migration_test_pause_copy() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('migration_test_copy_progress') = 9 THEN
          PERFORM pg_advisory_xact_lock(9690069, 1);
        END IF;
        RETURN NEW;
      END; $$;
      CREATE FUNCTION migration_test_install_pause() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()
          WHERE object_type='table' AND object_identity='public."contributionSourceAssets"') THEN
          CREATE TRIGGER migration_test_pause BEFORE INSERT ON "contributionSourceAssets"
          FOR EACH ROW EXECUTE FUNCTION migration_test_pause_copy();
        END IF;
      END; $$;
      CREATE EVENT TRIGGER migration_test_install_pause ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION migration_test_install_pause();
      SELECT pg_advisory_lock(9690069, 1);
    `)
    await backend.connect()
    await backend.query("set statement_timeout='60s'; set lock_timeout='30s'")
    const pid = Number(
      (await backend.query("select pg_backend_pid() as pid")).rows[0].pid
    )
    outcome = migrate(drizzle(backend), { migrationsFolder }).then(
      () => ({ migrated: true as const }),
      (error: unknown) => ({ error })
    )
    let paused: Record<string, unknown> | undefined
    while (performance.now() - started < 30000) {
      const row = (
        await observer.query(
          `
        select s.last_value,s.is_called,a.state,a.wait_event_type,a.wait_event,
          a.query,extract(epoch from (clock_timestamp()-a.xact_start))*1000 as transaction_ms
        from migration_test_copy_progress s
        left join pg_stat_activity a on a.pid=$1
      `,
          [pid]
        )
      ).rows[0]
      if (Number(row.last_value) === 9 && row.wait_event === "advisory") {
        paused = row
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert(
      paused,
      "Actual migration must reach the asset INSERT pause within 30 seconds"
    )
    assert.match(String(paused.query), /INSERT INTO "contributionSourceAssets"/)
    const locks = (
      await observer.query(
        `
      select coalesce(c.relname,l.locktype) as relation,l.mode,l.granted
      from pg_locks l left join pg_class c on c.oid=l.relation
      where l.pid=$1 and (c.relname in ('contributionFiles','sourceExtractions','contributionSourceAssets') or l.locktype='advisory')
      order by relation,l.mode
    `,
        [pid]
      )
    ).rows
    assert(
      locks.some(
        (row) =>
          row.relation === "contributionFiles" &&
          row.mode === "AccessExclusiveLock" &&
          row.granted
      ),
      "Readers/writers are blocked by the migration's attachment table lock"
    )
    const pausedDatabaseBytes = await databaseSize(observer)
    assert.equal(
      (
        await observer.query("select pg_terminate_backend($1) as terminated", [
          pid
        ])
      ).rows[0].terminated,
      true
    )
    const result = await outcome
    assert(
      "error" in result,
      "Backend termination must reject the real migrator"
    )
    const end = performance.now()
    return {
      interruptedAfterRows: 8,
      interruptedAttemptMs: Math.round(end - started),
      pausedTransactionMs: Math.round(Number(paused.transaction_ms)),
      pausedDatabaseBytes,
      locks
    }
  } finally {
    // Termination/close is restricted to the dedicated connection created here.
    await backend.end().catch(() => {})
    if (outcome) await outcome
    await observer.query(`
      SELECT pg_advisory_unlock(9690069, 1);
      DROP EVENT TRIGGER IF EXISTS migration_test_install_pause;
      DROP FUNCTION IF EXISTS migration_test_install_pause();
      DROP FUNCTION IF EXISTS migration_test_pause_copy();
      DROP SEQUENCE IF EXISTS migration_test_copy_progress;
    `)
  }
}

/** Sample real table locks and physical database size during the successful run. */
export async function measureMigration(
  client: Client,
  observer: Client,
  migrationsFolder: string
) {
  const pid = Number(
    (await client.query("select pg_backend_pid() as pid")).rows[0].pid
  )
  await client.query("set statement_timeout='90s'; set lock_timeout='15s'")
  const started = performance.now()
  let done = false
  let firstLock: number | undefined
  let lastLock: number | undefined
  let samples = 0
  let peakDatabaseBytes = await databaseSize(observer)
  const operation = migrate(drizzle(client), { migrationsFolder })
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ error })
    )
    .finally(() => {
      done = true
    })
  while (!done) {
    const sample = (
      await observer.query(
        `
      select pg_database_size(current_database()) as bytes,
        exists(select 1 from pg_locks l where l.pid=$1
          and l.relation='"contributionFiles"'::regclass
          and l.mode='AccessExclusiveLock' and l.granted) as locked
    `,
        [pid]
      )
    ).rows[0]
    samples++
    peakDatabaseBytes = Math.max(peakDatabaseBytes, Number(sample.bytes))
    if (sample.locked) {
      firstLock ??= performance.now()
      lastLock = performance.now()
    }
    if (performance.now() - started >= 90000) {
      await observer.query("select pg_cancel_backend($1)", [pid])
      await operation
      assert.fail("Synthetic migration exceeded its 90-second overall bound")
    }
    if (!done) await new Promise((resolve) => setTimeout(resolve, 25))
  }
  const result = await operation
  if ("error" in result) throw result.error
  const elapsedMs = Math.round(performance.now() - started)
  assert(
    elapsedMs < 90000,
    "Bounded synthetic migration must finish within 90 seconds"
  )
  assert(
    firstLock !== undefined && lastLock !== undefined,
    "Migration must last long enough to observe actual attachment locks"
  )
  return {
    elapsedMs,
    samples,
    observedExclusiveLockMs: Math.round(lastLock - firstLock),
    exclusiveLockUpperBoundMs: elapsedMs,
    samplingIntervalMs: 25,
    peakDatabaseBytes: Math.max(peakDatabaseBytes, await databaseSize(observer))
  }
}
