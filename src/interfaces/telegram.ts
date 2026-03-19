import { Telegraf } from 'telegraf';
// FIX-3: telegramBrain imported from neutral file, not declared here
import { telegramBrain } from '../core/telegram-brain.js';

export class TelegramInterface {
  private bot: Telegraf | null = null;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      this.bot = new Telegraf(token);
      this.setupHandlers();
      this.bot.launch().catch(err => {
        console.error('[Telegram] Failed to launch bot:', err);
      });
      console.log('[Telegram] Bot initialization triggered');
    } else {
      console.warn('[Telegram] TELEGRAM_BOT_TOKEN not found. Telegram interface disabled.');
    }
  }

  private setupHandlers() {
    if (!this.bot) return;

    this.bot.start((ctx) => ctx.reply('Welcome to PersonalClaw. I am your Windows agent. Send me a command!'));

    this.bot.on('text', async (ctx) => {
      const message = ctx.message.text;
      const chatId = ctx.from?.id;
      const authorizedId = process.env.AUTHORIZED_CHAT_ID;

      if (authorizedId && chatId?.toString() !== authorizedId) {
        console.warn(`[Telegram] Unauthorized access attempt from ${chatId}`);
        await ctx.reply('Unauthorized. This bot is locked to its owner.');
        return;
      }

      console.log(`[Telegram] Received message from ${chatId}:`, message);

      try {
        await ctx.sendChatAction('typing');
        const response = await telegramBrain.processMessage(message);
        await ctx.reply(response);
      } catch (error: any) {
        await ctx.reply(`Error: ${error.message}`);
      }
    });

    // Handle photos for vision tasks
    this.bot.on('photo', async (ctx) => {
      const chatId = ctx.from?.id;
      const authorizedId = process.env.AUTHORIZED_CHAT_ID;

      if (authorizedId && chatId?.toString() !== authorizedId) {
        return;
      }

      await ctx.reply('Vision capabilities are being integrated. I can see the photo but I need a moment to process it in context.');
    });
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.bot) return;
    const authorizedId = process.env.AUTHORIZED_CHAT_ID;
    if (!authorizedId) {
      console.warn('[Telegram] Cannot send proactive message: AUTHORIZED_CHAT_ID not set.');
      return;
    }
    try {
      await this.bot.telegram.sendMessage(authorizedId, message);
    } catch (err) {
      console.error('[Telegram] Failed to send message:', err);
    }
  }

  stop() {
    if (this.bot) this.bot.stop('SIGINT');
  }
}
