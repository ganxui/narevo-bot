import fs from 'node:fs';

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  token: process.env.BOT_TOKEN || '',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  admins: new Set((process.env.ADMIN_IDS || '').split(',').filter(Boolean).map(Number)),
  adminChatId: Number(process.env.ADMIN_CHAT_ID || 0),
  productImageUrl: process.env.PRODUCT_IMAGE_URL || 'https://raw.githubusercontent.com/ganxui/narevo-bot/main/public/product-mail.png?v=2',
  dataKey: process.env.DATA_KEY || '',
  cryptoPay: {
    token: process.env.CRYPTOPAY_TOKEN || '',
    testnet: String(process.env.CRYPTOPAY_TESTNET || 'false').toLowerCase()==='true',
  },
  demo: !process.env.BOT_TOKEN,
};
