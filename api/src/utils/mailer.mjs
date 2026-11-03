import nodemailer from 'nodemailer';
import { env } from '../config/env.mjs';
import { logger } from './logger.mjs';

// The connection to the mail server.
// Without SMTP_URL (tests, local development) nodemailer only builds the mail as JSON
// and sends nothing, so you don't need a mail server to work on the project.
const transporter = env.smtpUrl
  ? nodemailer.createTransport(env.smtpUrl)
  : nodemailer.createTransport({ jsonTransport: true });

// Send the "you are registered" mail. Throws when the mail server fails or is offline;
// the caller decides what to do with that error.
export async function sendRegistrationConfirmation(registration, event) {
  const info = await transporter.sendMail({
    from: env.mailFrom,
    to: registration.email,
    subject: `You are registered for ${event.title}`,
    text: `Hi ${registration.name},\n\nYou are registered for ${event.title} in ${event.location}.\n\nSee you there!`
  });
  // Ethereal (the test inbox) gives a link to read the mail in the browser; other servers give nothing.
  logger.info('confirmation mail sent', {
    registrationId: registration.id,
    previewUrl: nodemailer.getTestMessageUrl(info) || undefined
  });
}