import { HttpError, type Context } from "../../bunny";

const VALID_TOKENS = new Set(["token-123", "token-456"]);

export default async function auth(c: Context, next: () => Promise<void>) {
    const token =
        c.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || new URL(c.req.url).searchParams.get("token");

    if (!token || !VALID_TOKENS.has(token)) {
        throw new HttpError(401, "Unauthorized: invalid or missing token");
    }

    c.header("X-User", "authenticated");
    await next();
}
