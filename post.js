import OpenAI from "openai";
import { readFileSync } from "fs";
import { Client, GatewayIntentBits } from "discord.js";
import "dotenv/config";
import { getDayIndex, selectTopic, selectCp } from "./lib.js";

const USE_EMBED = false;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
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

async function withDiscordChannel(fn) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${CHANNEL_ID} 不可用或不是文字頻道`);
    }
    return await fn(channel);
  } finally {
    await client.destroy();
  }
}

function buildPayload(content) {
  return USE_EMBED ? { embeds: [{ description: content, color: 0xffb6c1 }] } : { content };
}

async function sendChunks(channel, chunks) {
  for (const chunk of chunks) {
    await channel.send(buildPayload(chunk));
  }
}

export async function generateAndPost({ topicOverride, cpOverride } = {}) {
  const client = new OpenAI({
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

  const completion = await client.chat.completions.create({
    model: "gemini-2.5-pro",
    messages: [{ role: "user", content: buildPrompt(cp, topic, context) }],
    temperature: 1.0,
    max_tokens: 2000,
  });

  const story = completion.choices[0].message.content.trim();

  const today = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const message = `📅 ${today} 💕 ${cp.name}\n\n${story}`;

  const chunks = [];
  if (message.length > 2000) {
    const header = `📅 ${today} 💕 ${cp.name}\n\n`;
    let remaining = story;
    chunks.push(header + remaining.slice(0, 2000 - header.length));
    remaining = remaining.slice(2000 - header.length);
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 2000));
      remaining = remaining.slice(2000);
    }
  } else {
    chunks.push(message);
  }

  if (DRY_RUN) {
    console.log("=== DRY RUN：不實際發到 Discord ===");
    console.log(chunks[0].slice(0, 300) + (chunks[0].length > 300 ? "\n…（略）" : ""));
    console.log(`共 ${chunks.length} 則訊息，${story.length} 字`);
    return;
  }

  await withDiscordChannel(channel => sendChunks(channel, chunks));

  console.log("發文成功！");
}

// 直接執行時的入口
const isMain = process.argv[1] && process.argv[1].endsWith("post.js");
if (isMain) {
  generateAndPost().catch(async err => {
    console.error("發文失敗：", err.message);
    try {
      await withDiscordChannel(channel => channel.send({ content: `⚠️ 今天的日常短文生成失敗了：${err.message}` }));
    } catch (notifyErr) {
      console.error("失敗通知也寄不出去：", notifyErr.message);
    }
    process.exit(1);
  });
}
