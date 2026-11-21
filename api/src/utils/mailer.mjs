import nodemailer from 'nodemailer';
import { env } from '../config/env.mjs';

const transporter = env.smtpUrl ? nodemailer.createTransport({
  url: env.smtpUrl, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000
}) : null;

export function buildRegistrationConfirmation(registration, event) {
  return {
    subject: `You are registered for ${event.title}`,
    text: `Hi ${registration.name},\n\nYou are registered for ${event.title} in ${event.location}.\n\nSee you there!`
  };
}

export function createEmailSender(transport = transporter) {
  return async (job) => {
    if (!transport) {
      throw Object.assign(new Error('SMTP is not configured'), { code: 'SMTP_NOT_CONFIGURED' });
    }
    const info = await transport.sendMail({
      from: env.mailFrom, to: job.recipient, subject: job.subject, text: job.text,
      messageId: `<${job.messageId}@campus-events.test>`
    });
    const accepted = info.accepted?.some((address) => address.toLowerCase() === job.recipient.toLowerCase());
    if (!accepted) {
      throw Object.assign(new Error('SMTP did not accept the recipient'), { code: 'SMTP_NOT_ACCEPTED' });
    }
    return { previewUrl: nodemailer.getTestMessageUrl(info) || undefined };
  };
}

export const sendEmailJob = createEmailSender();
