import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { BASE_DATE, CPS, getDayIndex, selectCp, selectTopic } from "./lib.js";

// ─── getDayIndex ───────────────────────────────────────────────────────────────
// getDayIndex() 算「今天是第幾天」，結果取決於 new Date()，
// 所以我們不測「今天是第幾天」這個具體值，而是測它的「形狀」。

describe("getDayIndex", () => {
  it("回傳整數", () => {
    assert.ok(Number.isInteger(getDayIndex()));
  });

  it("BASE_DATE 之後回傳非負數（專案開始後才跑）", () => {
    assert.ok(getDayIndex() >= 0);
  });

  it("每次呼叫結果一致（同一秒內）", () => {
    assert.equal(getDayIndex(), getDayIndex());
  });
});

// ─── selectCp ─────────────────────────────────────────────────────────────────
// selectCp() 是純函式（輸入固定 → 輸出固定），最適合單元測試。
// 我們可以直接斷言特定 dayIndex 對到哪個 CP。

describe("selectCp", () => {
  it("dayIndex 0 回傳 CPS[1]（麟夜）", () => {
    // (0 * 3 + 1) % 7 = 1
    assert.equal(selectCp(0).name, "麟夜");
  });

  it("回傳的物件有 name / key / desc 三個欄位", () => {
    const cp = selectCp(0);
    assert.ok(typeof cp.name === "string" && cp.name.length > 0);
    assert.ok(typeof cp.key === "string" && cp.key.length > 0);
    assert.ok(typeof cp.desc === "string" && cp.desc.length > 0);
  });

  it("跑完一整輪 CPS 不會超出陣列邊界", () => {
    for (let i = 0; i < CPS.length * 3; i++) {
      assert.ok(selectCp(i) !== undefined);
    }
  });

  it("加上 CPS.length 後結果相同（modulo 正確循環）", () => {
    // 這驗證 modulo 邏輯：跑了一整圈應該回到同一個 CP
    assert.deepEqual(selectCp(0), selectCp(CPS.length));
  });
});

// ─── selectTopic ──────────────────────────────────────────────────────────────
// selectTopic() 會讀 topics.json，所以這是「有 I/O 的函式」。
// 這類測試叫 integration test（整合測試），
// 但因為只碰本地檔案，跑起來還是很快。

describe("selectTopic", () => {
  it("回傳非空字串", () => {
    const topic = selectTopic(0);
    assert.ok(typeof topic === "string" && topic.length > 0);
  });

  it("modulo 正確循環：index 0 和 index topics.length 相同", () => {
    const topics = JSON.parse(readFileSync("topics.json", "utf-8"));
    assert.equal(selectTopic(0), selectTopic(topics.length));
  });

  it("不同 dayIndex 會選到不同主題（陣列有多個元素）", () => {
    // 只要主題超過 1 個，index 0 和 index 1 就不會一樣
    const topics = JSON.parse(readFileSync("topics.json", "utf-8"));
    if (topics.length > 1) {
      assert.notEqual(selectTopic(0), selectTopic(1));
    }
  });
});
