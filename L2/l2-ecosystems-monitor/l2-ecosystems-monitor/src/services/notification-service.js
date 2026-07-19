/**
 * Notification Service — sends alerts via Slack, Telegram, or Discord.
 */

import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';

export class NotificationService {
  constructor() {
    this._logger = getLogger();
  }

  /**
   * Send notification to all configured channels.
   */
  async notify(message, options = {}) {
    const config = getConfig();
    const results = [];

    if (config.slackWebhookUrl) {
      results.push(this._sendSlack(config.slackWebhookUrl, message, options));
    }
    if (config.telegramBotToken && config.telegramChatId) {
      results.push(this._sendTelegram(config.telegramBotToken, config.telegramChatId, message));
    }
    if (config.discordWebhookUrl) {
      results.push(this._sendDiscord(config.discordWebhookUrl, message, options));
    }

    if (results.length === 0) {
      this._logger.debug('[NOTIFY] No notification channels configured');
      return;
    }

    await Promise.allSettled(results);
  }

  /**
   * Send a scan summary notification.
   */
  async notifyScanSummary(summary) {
    const lines = ['**L2 Ecosystems — Daily Scan Summary**', ''];

    for (const [key, data] of Object.entries(summary)) {
      if (data.error) {
        lines.push(`❌ **${data.network}**: Error — ${data.error}`);
      } else {
        lines.push(
          `✅ **${data.network}**: ${data.transactionsFound} txs ` +
          `(${data.inbound} in, ${data.outbound} out) ` +
          `| ${data.totalValueEth.toFixed(4)} ETH inbound ` +
          `| ${data.blocksScanned} blocks scanned`
        );
      }
    }

    await this.notify(lines.join('\n'));
  }

  async _sendSlack(webhookUrl, text, options = {}) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mrkdwn: true, ...options }),
      });
      if (!res.ok) {
        this._logger.error(`[NOTIFY] Slack error: ${res.status}`);
      }
    } catch (err) {
      this._logger.error(`[NOTIFY] Slack failed: ${err.message}`);
    }
  }

  async _sendTelegram(botToken, chatId, text) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      if (!res.ok) {
        this._logger.error(`[NOTIFY] Telegram error: ${res.status}`);
      }
    } catch (err) {
      this._logger.error(`[NOTIFY] Telegram failed: ${err.message}`);
    }
  }

  async _sendDiscord(webhookUrl, content, options = {}) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...options }),
      });
      if (!res.ok) {
        this._logger.error(`[NOTIFY] Discord error: ${res.status}`);
      }
    } catch (err) {
      this._logger.error(`[NOTIFY] Discord failed: ${err.message}`);
    }
  }
}
