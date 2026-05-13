import OpenAI from "openai";
import { writeFileSync } from "fs";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const prompt = `請為一部以台灣大學生為主角的男同CP日常短文系列，生成 120 個有趣的日常生活主題。

這些主題的背景是：一群大學生朋友，平常喜歡一起打第五人格、王者榮耀，在DC群裡嘻嘻鬧鬧。主題要是兩個人之間的日常互動場景。

要求：
- 每個主題是一個具體的生活場景或情境，不超過 30 個字
- 主題只描述場景，不要指定角色或CP名稱
- 內容限定 PG-13，日常甜蜜為主
- 主題要多元，涵蓋：打遊戲、深夜聊天、外出、吃飯、讀書、日常瑣事、節慶、天氣等
- 不要重複或過於相似的場景

請直接輸出 JSON 陣列格式，不要加任何說明文字：
["主題1", "主題2", ...]`;

const response = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: prompt }],
  temperature: 1.2,
});

const raw = response.choices[0].message.content.trim();

const jsonMatch = raw.match(/\[[\s\S]*\]/);
if (!jsonMatch) {
  console.error("無法解析回傳的 JSON：", raw);
  process.exit(1);
}

const topics = JSON.parse(jsonMatch[0]);
console.log(`成功生成 ${topics.length} 個主題`);

writeFileSync("topics.json", JSON.stringify(topics, null, 2), "utf-8");
console.log("已寫入 topics.json");
