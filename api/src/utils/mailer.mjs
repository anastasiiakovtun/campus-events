import nodemailer from 'nodemailer';
import { env } from '../config/env.mjs';

// The connection to the mail server.
// Without SMTP_URL (tests, local development) nodemailer only builds the mail as JSON
// and sends nothing, so you don't need a mail server to work on the project.
const transporter = env.smtpUrl
  ? nodemailer.createTransport(env.smtpUrl)
  : nodemailer.createTransport({ jsonTransport: true });

// Send the "you are registered" mail. Throws when the mail server fails or is offline;
// the caller decides what to do with that error.
export async function sendRegistrationConfirmation(registration, event) {
  await transporter.sendMail({
    from: env.mailFrom,
    to: registration.email,
    subject: `You are registered for ${event.title}`,
    text: `Hi ${registration.name},\n\nYou are registered for ${event.title} in ${event.location}.\n\nSee you there!`
  });
}