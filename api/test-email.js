import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: 'marketmoneyfx00@gmail.com', // ← pon tu email real
      subject: 'Test COT Tracker',
      html: '<strong>Email funcionando correctamente ✅</strong>',
    });

    return res.status(200).json({ ok: true, response });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}