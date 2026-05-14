// 純文字頻道版本的 Discord 發文邏輯
// 從 post.js 拆出來保存。如果未來想退回「直接往文字頻道發訊息」的模式，
// 把這幾個函式 import 回 post.js、把 CHANNEL_ID 換成文字頻道的 ID 即可。

import { Client, GatewayIntentBits } from "discord.js";

const USE_EMBED = false;

export async function withTextChannel(channelId, fn) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} 不可用或不是文字頻道`);
    }
    return await fn(channel);
  } finally {
    await client.destroy();
  }
}

function buildPayload(content) {
  return USE_EMBED ? { embeds: [{ description: content, color: 0xffb6c1 }] } : { content };
}

export async function sendChunks(channel, chunks) {
  for (const chunk of chunks) {
    await channel.send(buildPayload(chunk));
  }
}
