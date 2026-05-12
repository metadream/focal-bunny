import { type Context } from "../../bunny";

export default async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${ms}ms`);
};
