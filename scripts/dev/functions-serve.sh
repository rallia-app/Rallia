#!/usr/bin/env bash
# Start functions serve, then sync Vault keys with the (possibly restarted) edge runtime.
# supabase functions serve restarts the edge runtime container with ES256 keys,
# so we must sync both anon_key and service_role_key AFTER it has started.

set -euo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
CONTAINER="supabase_edge_runtime_Rallia"

sync_vault_keys() {
  # Wait for the edge runtime container to be running with the new keys
  echo "Waiting for edge runtime to be ready..."
  for i in $(seq 1 30); do
    if docker exec "$CONTAINER" printenv SUPABASE_ANON_KEY &>/dev/null; then
      break
    fi
    sleep 1
  done

  ANON_KEY=$(docker exec "$CONTAINER" printenv SUPABASE_ANON_KEY 2>/dev/null || true)
  SERVICE_ROLE_KEY=$(docker exec "$CONTAINER" printenv SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true)

  if [[ -z "$ANON_KEY" || -z "$SERVICE_ROLE_KEY" ]]; then
    echo "Warning: Could not read keys from edge runtime container"
    return 1
  fi

  echo "Syncing Vault keys with edge runtime..."
  psql "$DB_URL" -q <<SQL
DO \$\$
DECLARE
  _id UUID;
BEGIN
  -- Sync anon_key
  SELECT id INTO _id FROM vault.secrets WHERE name = 'anon_key';
  IF _id IS NOT NULL THEN
    PERFORM vault.update_secret(_id, '${ANON_KEY}', 'anon_key');
  ELSE
    PERFORM vault.create_secret('${ANON_KEY}', 'anon_key');
  END IF;

  -- Sync service_role_key
  SELECT id INTO _id FROM vault.secrets WHERE name = 'service_role_key';
  IF _id IS NOT NULL THEN
    PERFORM vault.update_secret(_id, '${SERVICE_ROLE_KEY}', 'service_role_key');
  ELSE
    PERFORM vault.create_secret('${SERVICE_ROLE_KEY}', 'service_role_key');
  END IF;
END \$\$;
SQL
  echo "Vault keys synced."
}

# Start functions serve in background
supabase functions serve --no-verify-jwt &
SERVE_PID=$!

# Give functions serve time to restart the edge runtime container
sleep 5

# Sync vault with the new container's keys
sync_vault_keys

# Forward signals to the child process
trap "kill $SERVE_PID 2>/dev/null" EXIT INT TERM

# Wait for functions serve to exit
wait $SERVE_PID
