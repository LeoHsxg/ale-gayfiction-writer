import OpenAI from "openai";
import { readFileSync } from "fs";
import { Client, GatewayIntentBits } from "discord.js";
import "dotenv/config";

const USE_EMBED = false;
const CHANNEL_ID = "1485270703937818714";

const BASE_DATE = new Date("2026-05-13T00:00:00+08:00");

const CPS = [
  {
    name: "承夜",
    key: "承夜",
    desc: "晚夜的一號固排（楊承諺）×晚夜微雨。十分曖昧的雙排關係，似乎是晚夜的正宮。兩人同為中文系，在學校出雙入對，打排位時鬥嘴，但承諺是晚夜最堅固的後盾。",
  },
  {
    name: "麟夜",
    key: "麟夜",
    desc: "張嘉麟×晚夜微雨。日常鬥嘴搞曖昧，群裡活躍度最高的CP。張嘉麟是S晚夜是M，但嘉麟平時包容晚夜，只有私下才展露真面目。兩人時常一起被配戴電子口球。",
  },
  {
    name: "古夜",
    key: "古夜",
    desc: "古文×晚夜微雨。一起玩遊戲王的關係，說到遊戲王兩個人就談的不知天地為何物。",
  },
  {
    name: "柳夜",
    key: "柳夜",
    desc: "柳橙雨×晚夜微雨。聊第五、遊戲王、詩詞都能忘記吃飯，時常一起穿清大棒球外套情侶裝。曾經讓柳橙雨躺膝枕，還喝了柳橙雨的飲料間接接吻。",
  },
  {
    name: "光古",
    key: "光古",
    desc: "小光×古文。早期CP，像老夫老妻，時常一起打雙屠和討論遊戲理解，互攻關係。",
  },
  {
    name: "光夜",
    key: "光夜",
    desc: "小光×晚夜微雨。時常一起打雙屠，小光在遊戲理解上永遠無條件認同晚夜，寵妻如是說。",
  },
  {
    name: "雙文",
    key: "雙文",
    desc: "古文×摸魚小文。王者甜蜜雙排，在群裡也不忘放閃，甚至兩人各自上課時間都要忙裡偷閒甜蜜雙排。",
  },
];

function getDayIndex() {
  const now = new Date();
  const diffMs = now.getTime() - BASE_DATE.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function selectTopic(dayIndex) {
  const topics = JSON.parse(readFileSync("topics.json", "utf-8"));
  return topics[dayIndex % topics.length];
}

function selectCp(dayIndex) {
  return CPS[(dayIndex * 3 + 1) % CPS.length];
}

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
