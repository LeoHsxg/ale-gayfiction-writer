import OpenAI from "openai";
import { writeFileSync } from "fs";
import "dotenv/config";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const prompt = `請為一部以台灣大學生為主角的男同CP日常短文系列, 生成 120 個有趣的日常生活主題。

這些主題的背景是: 一群大學生朋友, 平常喜歡一起打第五人格, 在DC群裡嘻嘻鬧鬧。主題要是兩個人之間的日常互動場景。

要求：
- 每個主題是一個具體的生活場景或情境，不超過 30 個字
- 主題只描述場景, 不要指定角色或CP名稱
- 內容限定 PG-13, 日常甜蜜為主
- 主題要多元，涵蓋：打遊戲、深夜聊天、外出、吃飯、讀書、日常瑣事、節慶、天氣等
- 不要重複或過於相似的場景

請直接輸出 JSON 物件格式，不要加任何說明文字：
{"topics": ["主題1", "主題2", ...]}`;

const response = await client.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: prompt }],
  temperature: 1.2,
  response_format: { type: "json_object" },
});

const raw = response.choices[0].message.content.trim();
const parsed = JSON.parse(raw);
const topics = parsed.topics;

if (!Array.isArray(topics)) {
  console.error("回傳格式不對，沒有 topics 陣列：", raw);
  process.exit(1);
}

console.log(`成功生成 ${topics.length} 個主題`);

writeFileSync("topics.json", JSON.stringify(topics, null, 2), "utf-8");
console.log("已寫入 topics.json");
