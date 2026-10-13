import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Con SMTP_URL envía correo real. Sin él:
 * - desarrollo/pruebas: escribe el correo en el log (claramente marcado);
 * - producción: falla, para que nadie crea que se envió.
 */
export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  if (config.SMTP_URL) {
    const transport = nodemailer.createTransport(config.SMTP_URL);
    return { send: async (m) => void (await transport.sendMail({ from: config.MAIL_FROM, ...m })) };
  }
  return {
    async send(m) {
      if (config.NODE_ENV === 'production') throw new Error('SMTP_URL no configurado: no se puede enviar correo');
      log.warn({ to: m.to, subject: m.subject }, `[CORREO SOLO DESARROLLO — no enviado]\n${m.text}`);
    },
  };
}

/** Mailer que guarda los correos en memoria (pruebas). */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, send: async (m) => void sent.push(m) };
}
