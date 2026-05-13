# 計畫：每日同人短文 Discord Bot

## Context

這個 repo 已有 GitHub Actions workflow (`daily-post.yml`)，每天台灣時間早上 10:00 執行 `node post.js`，但 `post.js` 尚未建立。目標是實作這支腳本，讓它每天自動用 DeepSeek V3 生成一篇男同 CP 日常短文，然後透過 Discord Webhook 發到群組。

---

## 架構決策

| 項目         | 決策                                           |
| ------------ | ---------------------------------------------- |
| 主題選擇     | date-based index，stateless，不需每天 commit   |
| CP 選擇      | 用另一個 date-derived index，從 7 組 CP 輪選   |
| 生成 API     | DeepSeek V3（OpenAI 相容格式）                 |
| 儲存         | 不存故事本文，Discord 即永久紀錄               |
| 故事風格     | 日常小品，獨立於主線劇情                       |
| Discord 格式 | 純文字 + `USE_EMBED` flag 方便切換             |
| 貼文抬頭     | 日期 + CP 名稱（無主題標題、無章節編號）       |
| 錯誤處理     | 失敗時發一則通知訊息到 Discord                 |
| 故事長度     | 控制在 800–1200 中文字（不超過 2000 字元限制） |

---

## 需建立的檔案

### 1. `package.json`

```json
{
  "type": "module",
  "dependencies": {
    "openai": "^4"
  }
}
```

### 2. `topics.json`

100 個主題的陣列，每條是一個簡短的劇情梗概（不含 CP 資訊）。

```json
[
  "在便利商店遇到突如其來的大雨，兩人只好站在屋簷下等車",
  "深夜排位連敗，其中一人開始碎碎唸，另一個默默點了外送",
  ...
]
```

需用 `generate-topics.js` 一次性生成並 commit，之後不再動。

### 3. `generate-topics.js`（一次性工具腳本）

呼叫 DeepSeek 生成 100 個主題，輸出成 `topics.json`。執行一次後可留在 repo 備用。

### 4. `post.js`（主腳本）

**邏輯流程：**

```
1. 計算 dayIndex
   baseDate = 2026-05-13（或首次執行日）
   dayIndex = 從 baseDate 到今天的天數

2. 選主題
   topics = 讀取 topics.json
   topic = topics[dayIndex % topics.length]

3. 選 CP
   CPS = coupling.md 裡的 7 組（hardcode 名稱陣列）
   cp = CPS[(dayIndex * 3 + 1) % CPS.length]  // 與主題錯開

4. 讀 context
   - context/coupling.md → 找出今天這組 CP 的描述段落
   - context/reality setting.md（全文，很短）
   - context/stroyline setting.md（全文，很短）

5. 呼叫 DeepSeek V3
   model: deepseek-chat
   prompt: 見下方

6. 格式化訊息
   USE_EMBED = false（預設純文字）
   純文字格式：
     📅 2026/05/13　💕 麟夜

     （故事本文）

7. POST 到 Discord Webhook
   - 成功：結束
   - 失敗：POST 一則失敗通知到同一個 Webhook
```

**Prompt 設計：**

```
你是一位擅長寫男同CP日常短文的創作者。
以下是角色設定：
[coupling 描述：只插入今天這組 CP 的段落]
[reality setting 全文]
[stroyline setting 全文]

今天的寫作主題：{topic}
主角CP：{cp名稱}

請寫一篇 800 到 1200 字的日常短文，風格甜蜜自然，像是截取兩人日常生活的一個片段。
不要寫與主線劇情相關的內容，只寫日常互動。
直接輸出故事本文，不要加標題或任何額外說明。
內容限定 PG-13，不可出現任何 18+ 的性描寫或露骨情節。
```

### 5. `.github/workflows/daily-post.yml`（修改）

- 加入 `npm install` 步驟
- 將 `ANTHROPIC_API_KEY` 改為 `DEEPSEEK_API_KEY`

```yaml
- run: npm install
- run: node post.js
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

---

## 手動呼叫接口（佔位，細節留待後續設計）

`post.js` 的核心邏輯會封裝成一個可獨立呼叫的函式：

```js
export async function generateAndPost({ topicOverride, cpOverride } = {}) { ... }
```

這樣未來不管是透過 Discord slash command、HTTP endpoint 還是其他觸發方式，都能直接 import 這個函式來用，不需要重構。

> **後續需要討論的問題：**
>
> - 手動觸發的介面是什麼？（Discord slash command / 指令前綴 / 其他）
> - 需要一個長駐的 bot process 還是 serverless（如 Cloudflare Worker）？
> - 手動觸發時，主題和 CP 是讓使用者指定，還是也隨機？
> - 需不需要限制誰可以觸發？

---

## 7 組 CP 清單（從 coupling.md）

```js
const CPS = [
  { name: "承夜", desc: "..." }, // 楊承諺 × 晚夜微雨
  { name: "麟夜", desc: "..." }, // 張嘉麟 × 晚夜微雨
  { name: "古夜", desc: "..." }, // 古文 × 晚夜微雨
  { name: "柳夜", desc: "..." }, // 柳橙雨 × 晚夜微雨
  { name: "光古", desc: "..." }, // 小光 × 古文
  { name: "光夜", desc: "..." }, // 小光 × 晚夜微雨
  { name: "雙文", desc: "..." }, // 古文 × 摸魚小文
];
```

---

## 執行順序

1. 建立 `package.json`
2. 建立 `generate-topics.js` 並執行一次，產生 `topics.json`
3. 建立 `post.js`
4. 修改 `daily-post.yml`
5. 在 GitHub repo Settings 加入 `DEEPSEEK_API_KEY` secret
6. 本地測試：`DEEPSEEK_API_KEY=xxx DISCORD_WEBHOOK_URL=xxx node post.js`
7. 手動觸發 `workflow_dispatch` 做端對端測試

---

## 驗證方式

- 本地執行 `node post.js` 確認 Discord 群組收到訊息
- 把 `USE_EMBED = true` 測試卡片格式
- 手動觸發 GitHub Actions workflow 確認 CI 跑通
- 故意讓 API key 錯誤，確認失敗通知有送出
