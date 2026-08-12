import { ingestRequest } from '../webhooks/webhook.service.js';
import axios from 'axios';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const sendTelegramMessage = async (chatId, text, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: chatId, text },
        { timeout: 10000 } // 10 second timeout
      );
      console.log('Telegram reply sent:', res.data.ok);
      return;
    } catch (err) {
      console.error(`Telegram send attempt ${i + 1} failed:`, err.code);
    }
  }
  console.error('All telegram send attempts failed');
};

export const handleTelegramMessage = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat?.id;
    const text = message.text;

    // handle commands — don't ingest, just reply
    if (text.startsWith('/')) {
      return res.sendStatus(200);
    }

    // handle greetings — don't ingest, just reply
    if (['hi', 'hello', 'hey','Hello','Hi','Hey'].includes(text.toLowerCase())) {
      console.log('chatId for greeting:', chatId);
      await sendTelegramMessage(chatId,
        'Hello! I am FlowDesk AI assistant. Tell me your problem and I will inform the admin team.'
      );
      return res.sendStatus(200);
    }

    const customerName = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(' ') || 'Telegram User';

    await ingestRequest({
      message: text,
      customerName,
      source: 'TELEGRAM',
      actor: 'telegram_webhook',
      metadata: {
        telegramMessageId: message.message_id,
        chatId,
      },
    });

    await sendTelegramMessage(chatId,
      `✅ Thank you ${message.from?.first_name || 'there'}!\n\nYour message has been received and forwarded to our admin team for further assistance.\n\nWe'll get back to you soon.`
    );

    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram controller error:', err);
    res.sendStatus(200);
  }
};