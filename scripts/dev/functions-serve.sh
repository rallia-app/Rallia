#!/usr/bin/env bash
# Start functions serve, then sync Vault anon_key with the (possibly restarted) edge runtime.
# supabase functions serve restarts the edge runtime container with new keys,
# so we must sync AFTER it has started.

set -euo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
CONTAINER="supabase_edge_runtime_Rallia"

sync_vault_key() {
  # Wait for the edge runtime container to be running with the new key
  echo "Waiting for edge runtime to be ready..."
  for i in $(seq 1 30); do
    if docker exec "$CONTAINER" printenv SUPABASE_ANON_KEY &>/dev/null; then
      break
    fi
    sleep 1
  done

  ANON_KEY=$(docker exec "$CONTAINER" printenv SUPABASE_ANON_KEY 2>/dev/null || true)

  if [[ -z "$ANON_KEY" ]]; then
    echo "Warning: Could not read SUPABASE_ANON_KEY from edge runtime container"
    return 1
  fi

  echo "Syncing Vault anon_key with edge runtime..."
  psql "$DB_URL" -q <<SQL
DO \$\$
DECLARE
  _id UUID;
BEGIN
  SELECT id INTO _id FROM vault.secrets WHERE name = 'anon_key';
  IF _id IS NOT NULL THEN
    PERFORM vault.update_secret(_id, '${ANON_KEY}', 'anon_key');
  ELSE
    PERFORM vault.create_secret('${ANON_KEY}', 'anon_key');
  END IF;
END \$\$;
SQL
  echo "Vault anon_key synced."
}

# Start functions serve in background
supabase functions serve --no-verify-jwt &
SERVE_PID=$!

# Give functions serve time to restart the edge runtime container
sleep 5

# Sync vault with the new container's key
sync_vault_key

# Forward signals to the child process
trap "kill $SERVE_PID 2>/dev/null" EXIT INT TERM

# Wait for functions serve to exit
wait $SERVE_PID
