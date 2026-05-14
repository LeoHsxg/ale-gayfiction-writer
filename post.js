import OpenAI from "openai";
import { readFileSync } from "fs";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import "dotenv/config";
import { getDayIndex, selectTopic, selectCp } from "./lib.js";

const FORUM_CHANNEL_ID = "1504354572003708948";

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

async function withForumChannel(fn) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);
  try {
    const channel = await client.channels.fetch(FORUM_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      throw new Error(`Channel ${FORUM_CHANNEL_ID} 不可用或不是 Forum 頻道`);
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
    const choice = completion.choices[0];
    const content = choice.message.content?.trim();
    if (content) return content;
    lastReason = choice.finish_reason;
    console.warn(`第 ${i + 1} 次生成沒拿到內容 (finish_reason=${lastReason})。` + (i + 1 < temperatures.length ? "降溫重試…" : "已用盡嘗試。"));
    console.warn("完整回應：", JSON.stringify(completion, null, 2));
  }
  throw new Error(`模型連續沒回傳內容 (finish_reason=${lastReason})，疑似 safety filter`);
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

  await withForumChannel((forumChannel) => createForumPost(forumChannel, title, chunks));

  console.log("發文成功！");
}

// 直接執行時的入口
const isMain = process.argv[1] && process.argv[1].endsWith("post.js");
if (isMain) {
  generateAndPost().catch(async err => {
    console.error("發文失敗：", err.message);
    try {
      await withForumChannel((forumChannel) =>
        forumChannel.threads.create({
          name: `⚠️ 發文失敗 ${new Date().toISOString().slice(0, 10)}`,
          message: { content: `今天的日常短文生成失敗了：${err.message}` },
        })
      );
    } catch (notifyErr) {
      console.error("失敗通知也寄不出去：", notifyErr.message);
    }
    process.exit(1);
  });
}
