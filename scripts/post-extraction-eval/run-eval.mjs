import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));

const MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
const CONCURRENCY = 4;

// USD per million tokens, for the cost summary
const PRICING = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};

const ExtractionSchema = z.object({
  is_game_request: z
    .boolean()
    .describe(
      "true if the author is looking for players/partners for a game or recurring play. false for gear sales, general questions, event announcements that are not seeking players, etc.",
    ),
  sport: z
    .enum(["tennis", "pickleball", "badminton", "squash", "padel", "table_tennis", "other"])
    .nullable()
    .describe("null if no sport can be inferred"),
  place_raw: z
    .string()
    .nullable()
    .describe("Verbatim span from the post naming a place, facility, park, or area. null if none."),
  datetime_raw: z
    .string()
    .nullable()
    .describe("Verbatim span from the post describing when. null if none."),
  resolved_datetime_start: z
    .string()
    .nullable()
    .describe(
      "Best-guess start, resolved against today's date, ISO 8601 local time without timezone offset, e.g. 2026-08-30T18:00. Date only (2026-08-30) if no time given. null if truly no temporal info.",
    ),
  recurring: z
    .string()
    .nullable()
    .describe("Short description if this is recurring play, e.g. 'every Thursday 20h'. null for one-off."),
  level_raw: z
    .string()
    .nullable()
    .describe("Verbatim span describing skill level. null if none."),
  level_min: z
    .number()
    .nullable()
    .describe(
      "Numeric lower bound on a 1.0-7.0 NTRP-like scale, one decimal. Map words when confident: debutant/beginner ~2.0, intermediaire/intermediate ~3.0, avance/advanced ~4.5. null if unmappable.",
    ),
  level_max: z
    .number()
    .nullable()
    .describe("Numeric upper bound, same scale. null for open-ended ranges like '3.5+' or when unmappable."),
  format: z
    .enum(["singles", "doubles", "either"])
    .nullable()
    .describe("null if not stated and not clearly implied"),
  spots_needed: z
    .number()
    .int()
    .nullable()
    .describe("How many players the author is looking for. null if unclear."),
  language: z.enum(["fr", "en", "mixed"]),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Overall confidence that the extracted fields faithfully represent the post."),
  needs_clarification: z
    .array(z.string())
    .describe(
      "Field names a human should confirm before publishing, e.g. ['resolved_datetime_start'] when 'ce soir' is ambiguous. Empty array if nothing needs confirmation.",
    ),
});

function buildSystemPrompt(postedAt) {
  const now = postedAt ? new Date(postedAt) : new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86400000);
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} = ${p.weekday}${i === 0 ? " (posting day)" : i === 1 ? " (the day after)" : ""}`;
  }).join("\n");
  return `You extract structured data from posts written by players in a racquet-sports matchmaking app in Montreal. Posts are written the way people write in Facebook groups: French (Quebecois), English, or a mix, casual, with typos and slang.

The post's metadata (posting time, and the name of the chat it was posted in) may precede the post text. The chat name often indicates the sport and skill community; use it to infer sport when the text does not name one, but the post text always takes precedence over the chat name.

The post was written on ${parts.weekday}, ${today}, timezone America/Toronto. Resolve relative dates ("demain", "jeudi prochain", "this weekend") against the posting date. "Ce soir"/"tonight"/"today" means the posting date. A bare weekday means the next occurrence of that weekday. Use this calendar for weekday-to-date resolution instead of computing it yourself:
${calendar}

Rules:
- Extract only what the post states or clearly implies. Never invent a place, time, or level.
- format: only set it when the post says or strongly implies it ("double", "4th player" implies doubles; "du simple" implies singles). Looking for one partner does NOT imply doubles; leave format null when unsure.
- place_raw, datetime_raw, level_raw are verbatim quotes from the post.
- Skill levels use an NTRP-like 1.0-7.0 scale with one decimal. "3.5+" means level_min 3.5, level_max null.
- If the post is not seeking players (selling gear, general chat), set is_game_request false and null out what does not apply.
- Be honest in confidence and needs_clarification: flag anything a human should confirm before this post is published as a structured ad.`;
}

function localStamp(iso) {
  if (!iso) return null;
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function extractOne(client, post) {
  const started = Date.now();
  const systemPrompt = buildSystemPrompt(post.posted_at);
  const meta = [
    post.posted_at ? `Posted at: ${localStamp(post.posted_at)} (local)` : null,
    post.chat ? `Posted in chat: ${post.chat}` : null,
  ].filter(Boolean);
  const content = meta.length ? `${meta.join("\n")}\n\nPost:\n${post.text}` : post.text;
  // temperature was removed on Sonnet 5 / Opus 5 tier models (400 if sent)
  const supportsTemperature = MODEL.includes("haiku") || MODEL.includes("4-5");
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    ...(supportsTemperature ? { temperature: 0 } : {}),
    system: systemPrompt,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  return {
    id: post.id,
    text: post.text,
    extraction: response.parsed_output,
    stop_reason: response.stop_reason,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    latency_ms: Date.now() - started,
  };
}

async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i]);
      } catch (error) {
        results[i] = { id: items[i].id, text: items[i].text, error: describeError(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Authentication failed. Set ANTHROPIC_API_KEY (or run `ant auth login`).";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited. Lower CONCURRENCY or retry.";
  }
  if (error instanceof Anthropic.APIError) {
    return `API error ${error.status}: ${error.message}`;
  }
  return String(error?.message ?? error);
}

const cell = (v) => (v === null || v === undefined ? "" : String(v).replace(/\|/g, "\\|"));

function toMarkdown(results, summary) {
  const lines = [];
  lines.push(`# Post extraction eval`);
  lines.push("");
  lines.push(`Model: \`${summary.model}\` | ${summary.date} | ${summary.ok}/${summary.total} extracted | ~$${summary.cost_usd} USD total | avg ${summary.avg_latency_ms}ms/post`);
  lines.push("");
  lines.push(`| id | ad? | sport | place_raw | when (resolved) | level | format | spots | lang | conf | needs clarification |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.id} | ERROR | ${cell(r.error)} | | | | | | | | |`);
      continue;
    }
    const e = r.extraction;
    const level =
      e.level_min === null && e.level_max === null
        ? cell(e.level_raw)
        : `${e.level_min ?? "?"}-${e.level_max ?? "+"}`;
    const when = [e.resolved_datetime_start, e.recurring ? `(recurring: ${e.recurring})` : null]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `| ${r.id} | ${e.is_game_request ? "yes" : "no"} | ${cell(e.sport)} | ${cell(e.place_raw)} | ${cell(when)} | ${level} | ${cell(e.format)} | ${cell(e.spots_needed)} | ${e.language} | ${e.confidence} | ${cell(e.needs_clarification.join(", "))} |`,
    );
  }
  lines.push("");
  lines.push("## Posts");
  lines.push("");
  for (const r of results) {
    lines.push(`**${r.id}**: ${r.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const posts = JSON.parse(fs.readFileSync(path.join(here, "posts.json"), "utf8"));
  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt();

  console.log(`Extracting ${posts.length} posts with ${MODEL}...\n`);
  const results = await runPool(posts, (p) => extractOne(client, systemPrompt, p), CONCURRENCY);

  const ok = results.filter((r) => !r.error && r.extraction);
  const totalIn = ok.reduce((s, r) => s + r.usage.input_tokens, 0);
  const totalOut = ok.reduce((s, r) => s + r.usage.output_tokens, 0);
  const price = PRICING[MODEL];
  const cost = price ? ((totalIn * price.input + totalOut * price.output) / 1e6).toFixed(4) : "n/a";

  const summary = {
    model: MODEL,
    date: new Date().toISOString(),
    total: results.length,
    ok: ok.length,
    input_tokens: totalIn,
    output_tokens: totalOut,
    cost_usd: cost,
    avg_latency_ms: ok.length ? Math.round(ok.reduce((s, r) => s + r.latency_ms, 0) / ok.length) : 0,
  };

  fs.writeFileSync(path.join(here, "results.json"), JSON.stringify({ summary, results }, null, 2));
  fs.writeFileSync(path.join(here, "results.md"), toMarkdown(results, summary));

  for (const r of results) {
    if (r.error) {
      console.log(`${r.id}  ERROR  ${r.error}`);
      continue;
    }
    const e = r.extraction;
    console.log(
      `${r.id}  ad=${e.is_game_request ? "y" : "n"}  sport=${e.sport ?? "-"}  place=${e.place_raw ?? "-"}  when=${e.resolved_datetime_start ?? "-"}${e.recurring ? ` (rec: ${e.recurring})` : ""}  level=${e.level_min ?? "?"}-${e.level_max ?? "+"} (${e.level_raw ?? "-"})  fmt=${e.format ?? "-"}  spots=${e.spots_needed ?? "-"}  conf=${e.confidence}${e.needs_clarification.length ? `  clarify: ${e.needs_clarification.join(", ")}` : ""}`,
    );
  }
  console.log(
    `\n${summary.ok}/${summary.total} extracted | ${totalIn} in / ${totalOut} out tokens | ~$${cost} USD | avg ${summary.avg_latency_ms}ms/post`,
  );
  console.log(`Wrote results.md and results.json in scripts/post-extraction-eval/`);
}

main().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
