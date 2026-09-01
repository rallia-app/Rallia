// Read-only: pulls recent messages from prod group-style chats and keeps the
// ones that look like "looking for players" posts, as eval candidates.
// Prints diagnostics (counts by conversation/message type) so empty results
// are explainable. Writes candidates.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Prod URL + service key live (commented out) in apps/web/.env; env vars override.
function fromWebEnv(name) {
  const envFile = fs.readFileSync(path.join(here, "../../apps/web/.env"), "utf8");
  const line = envFile.split("\n").find((l) => l.replace(/^#\s*/, "").startsWith(`${name}=`));
  return line ? line.replace(/^#\s*/, "").slice(name.length + 1).replace(/^"|"$/g, "") : undefined;
}
const url = process.env.SUPABASE_URL ?? fromWebEnv("SUPABASE_URL");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromWebEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
console.log(`Target: ${url}`);
const supabase = createClient(url, key, { auth: { persistSession: false } });

function die(label, error) {
  console.error(`${label} failed:`, error.message);
  process.exit(1);
}

// --- Diagnostics ---------------------------------------------------------
const convs = await supabase.from("conversation").select("id, conversation_type, title");
if (convs.error) die("conversation query", convs.error);
const byType = {};
for (const c of convs.data) byType[c.conversation_type] = (byType[c.conversation_type] ?? 0) + 1;
console.log("conversations by type:", JSON.stringify(byType));

const GROUPISH = new Set(["community", "club", "group", "group_chat", "player_group", "announcement"]);
const convById = new Map(convs.data.map((c) => [c.id, c]));
const groupIds = convs.data.filter((c) => GROUPISH.has(c.conversation_type)).map((c) => c.id);
console.log(`group-style conversations: ${groupIds.length}`);

// Full history of group chats, paginated (PostgREST caps at 1000 rows/request)
const all = [];
for (let page = 0; page < 10; page++) {
  const { data, error } = await supabase
    .from("message")
    .select("content, created_at, message_type, conversation_id")
    .in("conversation_id", groupIds)
    .eq("message_type", "user")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(page * 1000, page * 1000 + 999);
  if (error) die("message query", error);
  all.push(...data);
  if (data.length < 1000) break;
}
console.log(`user-authored messages in group chats (all time): ${all.length}`);

const groupMsgs = all.filter((m) => m.content && m.content.trim().length >= 15);

const LOOKING = /cherch|recherch|looking|besoin|manque|joueur|player|partenaire|partner|quelqu|anyone|any1|dispo|avail|4th|4e|complet|remplac|jouer|play|up for|down to|match|partie|game|niveau|level|court|terrain|réserv|reserv|interested|intéress/i;

const seen = new Set();
const candidates = [];
for (const m of groupMsgs) {
  const text = m.content.trim();
  const norm = text.toLowerCase().replace(/\s+/g, " ");
  if (seen.has(norm)) continue;
  seen.add(norm);
  if (!LOOKING.test(text)) continue;
  const c = convById.get(m.conversation_id);
  candidates.push({
    text,
    created_at: m.created_at,
    chat: c.title ?? c.conversation_type,
    chat_type: c.conversation_type,
  });
}

fs.writeFileSync(path.join(here, "candidates.json"), JSON.stringify(candidates, null, 2));
console.log(`${candidates.length} candidates kept -> candidates.json`);
for (const [i, c] of candidates.entries()) {
  console.log(`\n[${i}] (${c.chat_type}: ${c.chat}, ${c.created_at?.slice(0, 10)})\n${c.text}`);
}
