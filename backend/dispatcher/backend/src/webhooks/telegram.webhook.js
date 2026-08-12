import express from 'express'
import { handleTelegramMessage } from '../controllers/telegram.controller.js'

const router = express.Router()

const validateTelegramSecret = (req, res, next) => {
  const secret = req.headers['x-telegram-bot-api-secret-token']
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.sendStatus(403)
  }
  next()
}

router.post('/telegram', validateTelegramSecret, handleTelegramMessage)

export default router