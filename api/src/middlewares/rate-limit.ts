import rateLimit from 'express-rate-limit';

export default (config: any) => {
  const limiter = rateLimit({
    windowMs: config.windowMs || 60 * 1000,
    max: config.max || 20,
    message: config.message || { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  return async (ctx: any, next: any) => {
    await new Promise<void>((resolve, reject) => {
      limiter(ctx.req, ctx.res, (err?: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await next();
  };
};
