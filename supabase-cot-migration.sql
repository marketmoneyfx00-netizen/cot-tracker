-- COT Auto-Sync tables
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS cot_sync_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  status         text        NOT NULL DEFAULT 'running',
  report_date    date,
  files_downloaded int       DEFAULT 0,
  error_message  text
);

CREATE TABLE IF NOT EXISTS cot_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type    text        NOT NULL,
  report_date    date        NOT NULL,
  downloaded_at  timestamptz NOT NULL DEFAULT now(),
  parsed_data    jsonb       NOT NULL DEFAULT '{}',
  asset_count    int         DEFAULT 0,
  UNIQUE(report_type, report_date)
);

-- Indexes for fast latest-report lookups
CREATE INDEX IF NOT EXISTS cot_reports_type_date ON cot_reports (report_type, report_date DESC);
CREATE INDEX IF NOT EXISTS cot_sync_runs_started  ON cot_sync_runs (started_at DESC);

-- RLS: authenticated users can read reports (service role bypasses RLS for writes)
ALTER TABLE cot_reports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cot_sync_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cot_reports' AND policyname = 'cot_reports_read'
  ) THEN
    CREATE POLICY cot_reports_read ON cot_reports
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cot_sync_runs' AND policyname = 'cot_sync_runs_read'
  ) THEN
    CREATE POLICY cot_sync_runs_read ON cot_sync_runs
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
