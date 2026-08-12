import dotenv from 'dotenv'
dotenv.config()

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const WEBHOOK_URL = process.env.BACKEND_URL
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET

const res = await fetch(
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${WEBHOOK_URL}/webhooks/telegram`,
      secret_token: SECRET
    })
  }
)

const data = await res.json()
console.log(data)