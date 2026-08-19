-- These aggregate over the full player pool and spill (~36MB/call on prod) at the default ~2-4MB work_mem.
ALTER FUNCTION public.snapshot_compat_supply() SET work_mem = '64MB';
ALTER FUNCTION public.get_compat_supply_snapshot() SET work_mem = '64MB';
