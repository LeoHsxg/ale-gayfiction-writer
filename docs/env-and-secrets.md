# 環境變數與 Secrets：本地、CI、Production 怎麼分流

寫給未來的自己看，因為「env」這個字在 GitHub 生態圈被重複利用太多次了，每次都要重新理清。

---

## TL;DR

- **本機跑**：`process.env.X` 的值從 `.env` 檔來（`dotenv` 載入）
- **GitHub Actions 跑**：`process.env.X` 的值從 workflow YAML 的 `env:` 區塊來，那個值通常又是從 repo 的 Actions secrets/variables 注入
- **Node 程式碼完全不知道值從哪來**，它只認 `process.env`
- 同一個變數名（例如 `GEMINI_API_KEY`）在 .env 和 Actions secrets 用一樣是**有意設計**，這樣程式不用判斷自己跑在哪

---

## 三個被叫 env 但完全不同的東西

| 角色 | 在哪設定 | 在 YAML 怎麼用 |
|---|---|---|
| **A. Actions secrets / variables**（**Repository-level**） | Repo Settings → Secrets and variables → Actions | `${{ secrets.X }}` / `${{ vars.X }}` |
| **B. Environment secrets / variables**（**Environment-level**） | Repo Settings → **Environments** → 建一個叫 `production` 之類的環境 → 進去設 secret | workflow 要先 `environment: production`，然後 `${{ secrets.X }}` 會優先讀 environment 的，沒有才退到 repo 的 |
| **C. `env:` 區塊** | YAML 檔案內 | `${{ env.X }}` 或在 `run:` 裡 shell 直接 `$X` |

**A 跟 B 是「儲存倉」，C 是「運送管道」**。它們完全是不同概念，只是名字都有 env。

- 一般專案只需要 A，B 是給「進 production 前要 reviewer approve」這種有審核的部署環境用的
- 這個 repo 用的就是 A

---

## 三層流通圖

```
GitHub Actions 跑時：

  Repo Settings → Actions Secrets/Variables    ← 儲存倉（角色 A）
        │
        │  ${{ secrets.GEMINI_API_KEY }}        ← YAML 撈值
        ▼
  workflow YAML 的 env: 區塊                    ← 運送管道（角色 C）
        │
        │  runner 啟動 process 時注入
        ▼
  Node 看到的 process.env.GEMINI_API_KEY        ← 目的地

----------------------------------------------------

本機跑時：

  .env 檔                                       ← 儲存倉
        │
        │  dotenv 解析（import "dotenv/config"）
        ▼
  本機 process.env                              ← 運送管道
        │
        ▼
  Node 看到的 process.env.GEMINI_API_KEY        ← 目的地
```

兩條管線**完全分開**，但最終的 `process.env.GEMINI_API_KEY` 是同一個介面。

---

## 為什麼變數名稱要刻意取一樣

這是「12-factor app」的設計哲學：配置從環境變數讀，永遠不要寫死在程式裡，**讓程式跟「跑在哪」完全脫鉤**。

`post.js` 只認 `process.env.GEMINI_API_KEY`。它不知道、也不在乎那個值是：
- 你 .env 寫的
- GitHub secrets 注入的
- 你 PowerShell `$env:GEMINI_API_KEY="..."` 臨時塞的
- Docker container `-e` 帶的

它只是「伸手往環境裡撈一個叫 `GEMINI_API_KEY` 的東西」。所以同一支 `node post.js`：

- 本機跑：撈到的是 .env 的值
- CI 跑：撈到的是 secrets 注入的值
- 上線到伺服器跑：撈到的是伺服器設的值

**程式碼一個字都不用改**。如果名字不一樣，就得寫 `if (isCI) readX else readY`，馬上就難維護。

---

## 本地 vs 正式環境的分流

問題：「本機開發時想發到測試頻道，GitHub Actions 上正式跑想發到正式頻道，怎麼讓同一支程式做兩件事？」

答：**加一個 flag，flag 在 .env 設、Actions 不設**。

### 本 repo 的做法

```js
// post.js
const FORUM_CHANNEL_ID = process.env.USE_DEV_CHANNEL === "true"
  ? process.env.DISCORD_CHANNEL_ID_DEV
  : process.env.DISCORD_CHANNEL_ID;
```

**本機 `.env`**：
```
DISCORD_CHANNEL_ID=<正式頻道 id>
DISCORD_CHANNEL_ID_DEV=<測試頻道 id>
USE_DEV_CHANNEL=true        ← 關鍵
```

**GitHub Actions secrets/variables**：
- `secrets.DISCORD_BOT_TOKEN`
- `vars.DISCORD_CHANNEL_ID`（**只有這一個 channel id**）
- 不設 `USE_DEV_CHANNEL` → 預設走 false → 走正式

### 命名小心：別讓 "test" 滿天飛

CI 叫 test，post-test workflow 叫 test，dry-run 也跟 test 有關。如果本機 flag 也叫 `USE_TEST_CHANNEL` 之後會混亂。所以這 repo 用 `DEV`：
- **dev** = 在我電腦上、開發時、可能 console.log 玩來玩去的環境
- **test** = 自動化測試（CI 跑 `node --test`、`node --check`）
- **prod** = 正式 cron 排程跑、發到觀眾頻道

---

## DRY_RUN 是另一回事

`DRY_RUN` 是「生成完不發 Discord」的開關，主要給 CI 的 Lv4 step 用：
- 確認 Gemini API key 有效、prompt 還能生成內容、回傳格式沒壞
- 但**不會浪費正式頻道版面**

[post.js](../post.js) 同時尊重 `DRY_RUN` 跟 `USE_DEV_CHANNEL`，兩者獨立可組合：

| `USE_DEV_CHANNEL` | `DRY_RUN` | 行為 |
|---|---|---|
| (unset) | (unset) | 發到正式 |
| true | (unset) | 發到 dev |
| (any) | true | 不發 Discord，只 console.log 出來 |

---

## 為什麼 step-level `if:` 不能直接比較 `secrets.X`

踩過一次坑：

```yaml
- name: Dry-run generation
  if: ${{ secrets.GEMINI_API_KEY != '' }}    # ← 不可靠
  run: node post.js
```

secrets context 在 step `if:` 裡會被遮罩處理，比較結果不穩，可能永遠 false。**繞道方式**：把 secret 拉到 job-level `env:`，然後在 `if:` 用 `env.X` 比較。

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}    # ← 提前注入
    steps:
      - name: Dry-run generation
        if: env.GEMINI_API_KEY != ''                   # ← env context 可靠
        run: node post.js
```

順便：`if:` 本來就會自動把字串當表達式求值，不用寫 `${{ }}` 包起來，actionlint 會警告。

---

## Sanity Check 指令

跑 post.js 前先確認本機 .env 是健康的：

```powershell
node -e "require('dotenv').config(); console.log({channel: process.env.USE_DEV_CHANNEL === 'true' ? 'DEV ' + process.env.DISCORD_CHANNEL_ID_DEV : 'PROD ' + process.env.DISCORD_CHANNEL_ID})"
```

跑出 `{ channel: 'DEV 1504...' }` 才是安全的本機測試狀態。如果印出 `PROD`，**先別 `node post.js`**，會直接打到觀眾頻道。
