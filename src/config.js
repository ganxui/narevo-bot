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
  sectionImageBaseUrl: (process.env.SECTION_IMAGE_BASE_URL || 'https://raw.githubusercontent.com/ganxui/narevo-bot/main/public').replace(/\/$/, ''),
  dataKey: process.env.DATA_KEY || '',
  cryptoPay: {
    token: process.env.CRYPTOPAY_TOKEN || '',
    testnet: false,
  },
  heleket: {
    merchantId: process.env.HELEKET_MERCHANT_ID || '',
    apiKey: process.env.HELEKET_PAYMENT_API_KEY || '',
    baseUrl: (process.env.HELEKET_API_URL || 'https://api.heleket.com').replace(/\/$/, ''),
  },
  lzt: {
    apiToken: process.env.LZT_API_TOKEN || process.env.LZT_TOKEN || '',
    merchantId: process.env.LZT_MERCHANT_ID || '',
    merchantToken: process.env.LZT_MERCHANT_TOKEN || '',
    currency: process.env.LZT_CURRENCY || 'RUB',
    baseUrl: (process.env.LZT_API_URL || 'https://prod-api.lzt.market').replace(/\/$/, ''),
  },
  buttonEmoji: {
    cryptoBot: process.env.CRYPTOPAY_BUTTON_EMOJI_ID || '',
    heleket: process.env.HELEKET_BUTTON_EMOJI_ID || '',
    sbp: process.env.SBP_BUTTON_EMOJI_ID || '',
  },
  demo: !process.env.BOT_TOKEN,
};