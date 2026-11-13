-- Backfill workspace memberships for accounts that predate the members table.
--
-- Run once, after `pnpm db:migrate` has created `workspace_members`:
--
--   psql "$DATABASE_URL" -f scripts/backfill-workspace-members.sql
--
-- Before this runs, `requireMerchant` still resolves those accounts through
-- `merchants.user_id`, so running it is safe at any time and can be re-run: the
-- unique index turns repeats into no-ops.

INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at)
SELECT gen_random_uuid()::text, m.id, m.user_id, 'owner', 'active', now(), now()
FROM merchants m
WHERE m.user_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Sanity check: no workspace should be left without an owner membership.
SELECT count(*) AS workspaces_without_owner
FROM merchants m
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = m.id AND wm.role = 'owner' AND wm.status = 'active'
);
