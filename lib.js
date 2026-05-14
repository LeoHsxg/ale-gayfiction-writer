import { readFileSync } from "fs";

export const BASE_DATE = new Date("2026-05-13T00:00:00+08:00");

export const CPS = [
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

export function getDayIndex() {
  const now = new Date();
  const diffMs = now.getTime() - BASE_DATE.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function selectTopic(dayIndex) {
  const topics = JSON.parse(readFileSync("topics.json", "utf-8"));
  return topics[dayIndex % topics.length];
}

export function selectCp(dayIndex) {
  return CPS[(dayIndex * 3 + 1) % CPS.length];
}
