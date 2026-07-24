DO $repair$
DECLARE
  expected_created_at constant bigint := 1784302411486;
  expected_hash constant text :=
    'cfa4c7c673c243ca63b4b0b79d37db95c3b447d5a2995b985d49342c1cf1609e';
  candidate_column text;
BEGIN
  FOREACH candidate_column IN ARRAY
    ARRAY['promptKey', 'promptHash', 'promptText', 'model']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'chats'
        AND column_name = candidate_column
        AND data_type = 'text'
        AND is_nullable = 'YES'
        AND column_default IS NULL
        AND is_generated = 'NEVER'
        AND is_identity = 'NO'
    ) THEN
      RAISE EXCEPTION
        'cannot repair migration 0004 ledger: chats.% is absent or unexpected',
        candidate_column;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM drizzle."__drizzle_migrations"
    WHERE created_at = expected_created_at
      AND hash = expected_hash
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM drizzle."__drizzle_migrations"
      WHERE created_at = expected_created_at
         OR hash = expected_hash
    ) THEN
      RAISE EXCEPTION
        'migration 0004 has a conflicting ledger record';
    END IF;

    INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
    VALUES (expected_hash, expected_created_at);
  END IF;
END
$repair$;
