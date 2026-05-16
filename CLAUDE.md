# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Discord bot that posts one AI-generated 男同 CP daily fanfic per day to a Discord **forum channel** (each day = a new thread). Story is generated with DeepSeek V3 (`deepseek-chat`), posted via discord.js. Triggered by an external cron-job.org hitting GitHub's `workflow_dispatch` API (the in-Actions `schedule:` trigger was dropped due to latency; do not re-add it).

Originally used Gemini 2.5 Pro but Google's `PROHIBITED_CONTENT` filter (a hardcoded policy that can't be disabled via `safety_settings`) kept blocking the prompt because the character context contains BL-genre signals. DeepSeek has much looser moderation for this kind of fiction. Don't switch back to Gemini without a plan for that.

Content (CPs, character descriptions, scene topics) is Chinese; the surrounding code and tooling are English. The fictional universe lives in `context/` and `storyline/`.

## Common commands

```powershell
# Run the bot locally — uses .env, posts to the dev channel if USE_DEV_CHANNEL=true
node --env-file=.env post.js
# (or rely on `import "dotenv/config"` already in post.js, so plain `node post.js` works too)

# Regenerate the topic pool (one-shot, overwrites topics.json — already committed, rarely re-run)
node generate-topics.js

# Tests
node --test                    # all
node --test post.test.js       # one file
node --test --test-name-pattern="selectCp"  # one suite/case

# Syntax check (what CI does first)
node --check post.js
```

## Architecture

### Daily content selection is deterministic, not random

`lib.js` is the single source of truth:

- `BASE_DATE` (2026-05-13) anchors a `dayIndex` = floor((now - BASE_DATE) / 1 day).
- `selectTopic(dayIndex)` = `topics[dayIndex % topics.length]` — `topics.json` is **committed**, regenerated only by hand.
- `selectCp(dayIndex)` = `CPS[(dayIndex * 3 + 1) % CPS.length]` — the `*3 + 1` is intentional, decorrelates CP cycle from topic cycle.

Implication: changing `BASE_DATE`, the topic count, or the CP list **shifts the whole calendar**. Tests in `post.test.js` lock down the modulo invariants — don't break those without intent.

### The LLM call goes through the OpenAI SDK

`post.js` instantiates `new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com/v1/" })` and talks Chat Completions. DeepSeek is a first-class OpenAI-compat provider, so the request shape is exactly what `openai` expects — no compat-layer quirks. You can swap to another OpenAI-compat provider (Groq, OpenRouter, Together, Fireworks…) by changing baseURL + key + model name; the rest of the call shape stays.

### `deepseek-chat` is NOT a thinking model — max_tokens stays small

DeepSeek's `deepseek-chat` (V3 family) is a regular completion model: every output token shows up in `completion_tokens`, no hidden reasoning budget. `max_tokens: 4096` is plenty for an 800–1200字 story. If you ever switch to `deepseek-reasoner` (R1, which IS a thinking model), you'll need to raise `max_tokens` significantly — the old Gemini-era 16384 budget was for that reason.

`generateStory()` retries once at lower temperature and dumps the full response if both attempts come back empty — keep that diagnostic, useful when the provider returns a malformed shape.

### Prompt assembly reads three .md files

`buildPrompt()` interpolates `context/reality setting.md`, `context/stroyline setting.md` (note the typo `stroyline` — it's in the filename), and the CP block from `context/coupling.md`. The `loadContext()` parser for coupling.md is brittle (string-match + blank-line break) — if you reformat `coupling.md`, re-verify it still extracts the right block.

### Discord side: forum channel, not text channel

`withForumChannel()` enforces `channel.type === ChannelType.GuildForum`. `createForumPost()` builds a new thread per run (title = `${date} 💕 ${cp.name} — ${topic}`, clamped to 100 chars), with story chunks > 2000 chars sent as replies inside the thread.

The legacy text-channel sender is preserved verbatim in `snippets/post-to-channel.js` for reuse — don't delete it.

### Env flags shape what `node post.js` does

| Flag                   | Effect                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `USE_DEV_CHANNEL=true` | Use `DISCORD_CHANNEL_ID_DEV` instead of `DISCORD_CHANNEL_ID`. Set in local `.env`, **not** in GitHub Actions. |
| `DRY_RUN=true`         | Generate but don't touch Discord. Used by CI's Lv4 step. The failure-notice path also respects this.          |

`docs/env-and-secrets.md` explains the full local-vs-Actions story (why `secrets.X` doesn't work in step-level `if:`, how dotenv and Actions secrets converge on the same `process.env`).

### Three workflows, three purposes

- `daily-post.yml` — production. `workflow_dispatch` only (external cron triggers it). Posts to prod channel via `vars.DISCORD_CHANNEL_ID`.
- `post-test.yml` — runs on every push to main, posts to `vars.DISCORD_CHANNEL_ID_TEST` so you can eyeball the latest build before the next cron run.
- `ci.yml` — syntax check + `npm ci` + `node --test` + optional dry-run generation (gated on `env.DEEPSEEK_API_KEY != ''` after lifting the secret to job-level env — step-level `if:` against `secrets.X` is unreliable).

### Things that look like dead code but aren't

- `topics.json` is committed even though `generate-topics.js` produces it — it's content, not build output.
- `snippets/post-to-channel.js` is intentionally unused; see above.
- `storyline/` (markdown chapters 1-15) is hand-written canon, not generated. The bot never reads or writes it.

