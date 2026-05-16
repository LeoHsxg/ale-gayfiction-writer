import OpenAI from "openai";
import { readFileSync } from "fs";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import "dotenv/config";
import { getDayIndex, selectTopic, selectCp } from "./lib.js";

// USE_DEV_CHANNEL=true 時改發到開發測試頻道（DISCORD_CHANNEL_ID_DEV），
// 預設走正式頻道（DISCORD_CHANNEL_ID）。本機開發時在 .env 設 true，
// GitHub Actions 上不設定就會自動走正式。
const FORUM_CHANNEL_ID = process.env.USE_DEV_CHANNEL === "true" ? process.env.DISCORD_CHANNEL_ID_DEV : process.env.DISCORD_CHANNEL_ID;
// 失敗通知統一發到 dev 頻道（不污染正式頻道版面）。沒設定就不發通知。
const ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID_DEV;
// DRY_RUN=true 時只生成、不發到 Discord（用於 CI 驗證 AI 呼叫是否正常）
const DRY_RUN = process.env.DRY_RUN === "true";

function loadContext(cpKey) {
  const realitySetting = readFileSync("context/reality setting.md", "utf-8");
  const storylineSetting = readFileSync("context/stroyline setting.md", "utf-8");
  const coupling = readFileSync("context/coupling.md", "utf-8");

  const cpLines = coupling.split("\n");
  let cpDesc = "";
  let inSection = false;
  for (const line of cpLines) {
    if (line.includes(cpKey)) {
      inSection = true;
    }
    if (inSection) {
      cpDesc += line + "\n";
      if (cpDesc.trim().length > 10 && line.trim() === "" && cpDesc.includes("\n\n")) {
        break;
      }
    }
  }

  return { realitySetting, storylineSetting, cpDesc: cpDesc.trim() };
}

function buildPrompt(cp, topic, context) {
  return `你是一位擅長寫男同CP日常短文的創作者，文筆自然、細膩，善於捕捉人物之間的情感張力。

以下是角色設定：

【這對CP的關係】
${cp.desc}

【角色現實人設】
${context.realitySetting}

【角色遊戲風格與個性弧線】
${context.storylineSetting}

請根據以上設定，以「${cp.name}」為主角CP，寫一篇 800 到 1200 字的日常短文。

今天的場景主題：${topic}

寫作要求：
- 風格甜蜜自然，像是截取兩人日常生活的一個片段，讓讀者有「吃到糧」的感覺
- 符合角色個性，對話和行為要像那個人說的話、做的事
- 不要寫與主線劇情相關的內容，只寫日常互動
- 內容限定 PG-13，不可出現任何 18+ 的性描寫或露骨情節
- 直接輸出故事本文，不要加標題、作者名或任何額外說明`;
}

async function withForumChannel(channelId, fn) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      throw new Error(`Channel ${channelId} 不可用或不是 Forum 頻道`);
    }
    return await fn(channel);
  } finally {
    await client.destroy();
  }
}

async function createForumPost(forumChannel, title, chunks) {
  const thread = await forumChannel.threads.create({
    name: title,
    message: { content: chunks[0] },
  });
  for (const chunk of chunks.slice(1)) {
    await thread.send({ content: chunk });
  }
  return thread;
}

async function generateStory(openai, prompt) {
  console.log(`Prompt 長度: ${prompt.length} 字`);
  const temperatures = [1.0, 0.7];
  let lastReason = null;
  for (const [i, temperature] of temperatures.entries()) {
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: prompt }],
        temperature,
        // 2.5 Pro 是 thinking model，內部推理也吃 max_tokens 預算
        // 故事本文約 ~2000 tokens，思考再抓 ~6000，給到 8192 比較安全
        max_tokens: 16384,
      });
    } catch (err) {
      console.error(`第 ${i + 1} 次 API call 拋例外:`, {
        message: err.message,
        status: err.status,
        code: err.code,
        type: err.type,
        param: err.param,
        error: err.error,
        headers: err.headers,
      });
      throw err;
    }
    // 防呆鏈：API 偶爾回傳殘缺 shape (沒有 message、甚至沒有 choices)，
    // 不要 NPE，當作「這次沒拿到內容」處理然後讓上面那個 console.warn 把完整回應印出來。
    const choice = completion?.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (content) return content;
    lastReason = choice?.finish_reason ?? "no-choice";
    console.warn(`第 ${i + 1} 次生成沒拿到內容 (finish_reason=${lastReason})。` + (i + 1 < temperatures.length ? "降溫重試…" : "已用盡嘗試。"));
    console.warn("完整回應：", JSON.stringify(completion, null, 2));
  }
  throw new Error(`模型連續沒回傳內容 (finish_reason=${lastReason})，疑似 safety filter 或 token 預算問題`);
}

export async function generateAndPost({ topicOverride, cpOverride } = {}) {
  const openai = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  const dayIndex = getDayIndex();
  const topic = topicOverride ?? selectTopic(dayIndex);
  const cp = cpOverride ?? selectCp(dayIndex);
  const context = loadContext(cp.key);

  console.log(`今日 dayIndex: ${dayIndex}`);
  console.log(`今日 CP: ${cp.name}`);
  console.log(`今日主題: ${topic}`);

  const story = await generateStory(openai, buildPrompt(cp, topic, context));

  const today = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const title = `${today} 💕 ${cp.name} — ${topic}`.slice(0, 100);

  const chunks = [];
  let remaining = story;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 2000));
    remaining = remaining.slice(2000);
  }

  if (DRY_RUN) {
    console.log("=== DRY RUN：不實際發到 Discord ===");
    console.log(`標題: ${title}`);
    console.log(chunks[0].slice(0, 300) + (chunks[0].length > 300 ? "\n…（略）" : ""));
    console.log(`共 ${chunks.length} 則訊息，${story.length} 字`);
    return;
  }

  await withForumChannel(FORUM_CHANNEL_ID, forumChannel => createForumPost(forumChannel, title, chunks));

  console.log("發文成功！");
}

// 直接執行時的入口
const isMain = process.argv[1] && process.argv[1].endsWith("post.js");
if (isMain) {
  generateAndPost().catch(async err => {
    console.error("發文失敗：", err.message);
    if (!DRY_RUN && ALERT_CHANNEL_ID) {
      try {
        await withForumChannel(ALERT_CHANNEL_ID, forumChannel =>
          forumChannel.threads.create({
            name: `⚠️ 發文失敗 ${new Date().toISOString().slice(0, 10)}`,
            message: { content: `今天的日常短文生成失敗了：${err.message}` },
          }),
        );
      } catch (notifyErr) {
        console.error("失敗通知也寄不出去：", notifyErr.message);
      }
    } else if (!DRY_RUN) {
      console.warn("沒設定 DISCORD_CHANNEL_ID_DEV，跳過失敗通知。");
    }
    process.exit(1);
  });
}
