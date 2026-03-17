/**
 * Telegram Brain — Isolated Brain instance for the Telegram interface.
 *
 * FIX-3: Creating this neutral file breaks the circular import between index.ts and telegram.ts.
 * Both import from this file — neither imports the other.
 *
 * - Does not count toward the 3-pane conversation limit.
 * - Not listed in conversationManager.list().
 * - History is not saved on shutdown (Telegram users reconnect fresh).
 */

import { Brain } from './brain.js';

export const telegramBrain = new Brain({
  agentId: 'telegram_primary',
  conversationId: 'telegram',
  conversationLabel: 'Telegram',
});
