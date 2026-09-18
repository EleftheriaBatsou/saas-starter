import nodemailer from 'nodemailer';
import { config } from '../config.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  link?: string;
}

type Logger = { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

// Test hook: the isolation tests read links from here instead of an inbox.
export const outbox: Mail[] = [];

/**
 * Delivery order: SMTP_URL (nodemailer) → MAIL_WEBHOOK_URL (JSON POST) →
 * console. In dev with neither configured, the link is logged so you can
 * click it from the dev-server log.
 */
export async function sendMail(mail: Mail, log: Logger): Promise<void> {
  if (config.isTest) {
    outbox.push(mail);
    return;
  }
  try {
    if (transport) {
      await transport.sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, text: mail.text });
      log.info({ to: mail.to, subject: mail.subject }, 'mail sent via SMTP');
      return;
    }
    if (config.mailWebhookUrl) {
      const res = await fetch(config.mailWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, ...mail }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`mail webhook responded ${res.status}`);
      log.info({ to: mail.to, subject: mail.subject }, 'mail sent via webhook');
      return;
    }
    if (config.isProd) {
      log.error({ to: mail.to, subject: mail.subject }, 'NO MAIL TRANSPORT CONFIGURED — set SMTP_URL or MAIL_WEBHOOK_URL');
      return;
    }
    // Dev fallback: print the link.
    console.log(`\n📬  [dev mail] to=${mail.to}  subject="${mail.subject}"\n    ${mail.link ?? mail.text}\n`);
  } catch (err) {
    log.error({ err, to: mail.to }, 'mail delivery failed');
  }
}
