/**
 * Rate-limit middleware для Strapi 5 (Koa).
 * Простой in-memory sliding window — без express-rate-limit.
 */

const store = new Map<string, { count: number; resetAt: number }>();

// Очистка старых записей каждые 60 сек
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000).unref();

export default (config: any) => {
  const max = config.max || 10;
  const windowMs = config.windowMs || 60_000;

  return async (ctx: any, next: any) => {
    const ip = ctx.request.ip || ctx.ip || 'unknown';
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    ctx.set('RateLimit-Limit', String(max));
    ctx.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    ctx.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      ctx.status = 429;
      ctx.body = config.message || { error: 'Too many requests, please try again later.' };
      return;
    }

    await next();
  };
};
