import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const expected = crypto.createHash('sha256').update(secret).digest('hex');
  const provided = String(req.query?.key || '');

  if (!secret || provided.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return res.status(403).json({ ok: false });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = 'https://mini-app-omega-roan.vercel.app/api/telegram/webhook';
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      drop_pending_updates: true,
      allowed_updates: ['message']
    })
  });
  const result = await response.json();
  return res.status(result.ok ? 200 : 502).json({ ok: Boolean(result.ok) });
}
