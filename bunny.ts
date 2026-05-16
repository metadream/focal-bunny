import { resolve } from "path";
import { Stache } from "./stache";

type RouteMethod = (pattern: string, arg1: Function | string, arg2?: Function) => void;
const SESSION_COOKIE = "SESS_ID";

const STATUS_TEXT: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
};

interface RouteDef {
    method: string;
    pattern: string;
    urlp: URLPattern;
    handler: Function;
    template?: string;
    priority: number;
}

interface MiddlewareDef {
    pattern: string;
    urlp: URLPattern;
    handler: Function;
}

interface ErrorDef {
    template?: string;
    handler: Function;
}

/** HTTP error with a numeric status code. Thrown in route handlers to trigger the error handler. */
export class HttpError extends Error {
    /** HTTP status code (e.g. 400, 404, 500). */
    status: number;
    /**
     * @param status HTTP status code
     * @param message Error message; defaults to the standard status text
     */
    constructor(status: number, message?: string) {
        super(message || STATUS_TEXT[status] || "Error");
        this.name = "HttpError";
        this.status = status;
    }
}

/** In-memory session storage. Used internally by `Context.session`. */
export class SessionStore {
    private sessions = new Map<string, Record<string, unknown>>();

    /** Get session data by ID. */
    get(sid: string): Record<string, unknown> | undefined {
        return this.sessions.get(sid);
    }
    /** Set session data by ID. */
    set(sid: string, data: Record<string, unknown>): void {
        this.sessions.set(sid, data);
    }
}

const sessionStore = new SessionStore();
/** Per-request context passed to route handlers and middleware. */
export class Context {
    /** Raw incoming `Request` object. */
    req: Request;
    /** Path parameters extracted from the matched route pattern. */
    params: Record<string, string>;
    /** Parsed query-string parameters from the URL. */
    query: Record<string, string>;
    private resStatus = 200;
    private resHeaders: Record<string, string> = {};
    private _sessionData?: Record<string, unknown>;
    private _sessionSid?: string;
    [key: string]: unknown;

    constructor(req: Request, params: Record<string, string>) {
        this.req = req;
        this.params = params;
        this.query = Object.fromEntries(new URL(req.url).searchParams);
    }

    /** Read and write session data. Initializes the session lazily on first access. */
    get session(): {
        get: <T>(key: string) => T | undefined;
        set: (key: string, value: unknown) => void;
        remove: (key: string) => void;
        destroy: () => void;
    } {
        const self = this;
        if (!self._sessionData) {
            const cookies = parseCookies(self.req);
            self._sessionSid = cookies[SESSION_COOKIE];
            if (self._sessionSid) {
                self._sessionData = sessionStore.get(self._sessionSid) || {};
            } else {
                self._sessionSid = crypto.randomUUID();
                self._sessionData = {};
                self.header("Set-Cookie", `${SESSION_COOKIE}=${self._sessionSid}; Path=/; HttpOnly; SameSite=Lax`);
            }
        }
        return {
            get<T>(key: string): T | undefined {
                return self._sessionData![key] as T;
            },
            set(key: string, value: unknown): void {
                self._sessionData![key] = value;
                sessionStore.set(self._sessionSid!, self._sessionData!);
            },
            remove(key: string): void {
                delete self._sessionData![key];
                sessionStore.set(self._sessionSid!, self._sessionData!);
            },
            destroy(): void {
                self._sessionData = {};
                sessionStore.set(self._sessionSid!, {});
                self.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
            },
        };
    }

    /** Set the HTTP response status code. Chainable. */
    status(code: number): this {
        this.resStatus = code;
        return this;
    }

    /** Set a response header. Chainable. */
    header(name: string, value: string): this {
        this.resHeaders[name] = value;
        return this;
    }

    /** Return a JSON response. Automatically sets `Content-Type: application/json`. */
    json(obj: any): Response {
        return new Response(JSON.stringify(obj), {
            status: this.resStatus,
            headers: { ...this.resHeaders, "Content-Type": "application/json" },
        });
    }

    /** Return an HTML response. Automatically sets `Content-Type: text/html; charset=utf-8`. */
    html(str: string): Response {
        return new Response(str, {
            status: this.resStatus,
            headers: { ...this.resHeaders, "Content-Type": "text/html; charset=utf-8" },
        });
    }

    /** Return a plain-text response. */
    text(str: string): Response {
        return new Response(str, {
            status: this.resStatus,
            headers: this.resHeaders,
        });
    }

    /** Redirect to a URL (default 307, pass 301/308 for permanent). */
    redirect(url: string, code: 301 | 302 | 307 | 308 = 307): Response {
        this.status(code);
        this.header("Location", url);
        return new Response(null, { status: code, headers: { ...this.resHeaders } });
    }

    /** The response status code (read-only, set via `.status()`). */
    get responseStatus(): number {
        return this.resStatus;
    }
    /** The response headers (read-only, set via `.header()`). */
    get responseHeaders(): Record<string, string> {
        return this.resHeaders;
    }
}

/** Main application class. Create an instance, register routes/middleware, then export it. */
export class Bunny {
    private routes: RouteDef[] = [];
    private middlewares: MiddlewareDef[] = [];
    private errDef?: ErrorDef;
    private stache?: Stache;

    /** Register a GET route. */
    get: RouteMethod = this.routeFor("GET");
    /** Register a POST route. */
    post: RouteMethod = this.routeFor("POST");
    /** Register a PUT route. */
    put: RouteMethod = this.routeFor("PUT");
    /** Register a DELETE route. */
    delete: RouteMethod = this.routeFor("DELETE");
    /** Register a PATCH route. */
    patch: RouteMethod = this.routeFor("PATCH");
    /** Register an OPTIONS route. */
    options: RouteMethod = this.routeFor("OPTIONS");
    /** Register a HEAD route. */
    head: RouteMethod = this.routeFor("HEAD");

    /** Fetch handler. Called automatically by Bun when the app is exported. */
    fetch = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const params: Record<string, string> = {};
        const ctx = new Context(req, params);

        try {
            const route = this.routes.find((r) => r.method === req.method && r.urlp.test(url));
            if (!route) {
                ctx._template = this.errDef?.template;
                if (this.routes.some((r) => r.urlp.test(url))) {
                    throw new HttpError(405);
                }
                throw new HttpError(404);
            }

            const match = route.urlp.exec(url);
            if (match?.pathname?.groups) Object.assign(params, match.pathname.groups);

            ctx._template = route.template;
            const mws = this.middlewares.filter((m) => m.urlp.test(url));
            let result: any;

            const compose = async (i: number): Promise<void> => {
                if (i < mws.length) {
                    await mws[i].handler(ctx, () => compose(i + 1));
                } else {
                    result = await route.handler(ctx);
                }
            };

            await compose(0);
            if (route.template && this.stache) {
                const html = await this.stache.view(route.template, result);
                const ctype =
                    ctx.responseHeaders["content-type"] ||
                    ctx.responseHeaders["Content-Type"] ||
                    "text/html; charset=utf-8";
                return new Response(html, {
                    status: ctx.responseStatus,
                    headers: { ...ctx.responseHeaders, "Content-Type": ctype },
                });
            }
            return buildResponse(result, ctx);
        } catch (e: any) {
            return this.onError(e, ctx);
        }
    };

    /**
     * Register a middleware. If called with a single function, it applies globally (`/*`).
     * If called with a pattern and a function, it only matches the given path.
     */
    use(pattern: string | Function, handler?: Function) {
        if (typeof pattern === "function") {
            handler = pattern;
            pattern = "/*";
        }
        this.middlewares.push({
            pattern: pattern as string,
            urlp: new URLPattern({ pathname: pattern as string }),
            handler: handler!,
        });
    }

    /** Mount a sub-router (another `Bunny` instance) at the given prefix. */
    route(prefix: string, sub: Bunny) {
        for (const r of sub.routes) {
            this.addRoute(r.method, joinPath(prefix, r.pattern), r.handler, r.template);
        }
        for (const m of sub.middlewares) {
            const p = joinPath(prefix, m.pattern);
            this.middlewares.push({ pattern: p, urlp: new URLPattern({ pathname: p }), handler: m.handler });
        }
        if (sub.errDef && !this.errDef) {
            this.errDef = sub.errDef;
        }
    }

    /** Serve static files from a local directory under a URL path prefix. */
    static(webPath: string, localPath: string) {
        const pattern = webPath + "/:rest*";

        this.addRoute("GET", pattern, (c: Context) => {
            let filePath = (c.params.rest || "").replace(/^\/+/, "");
            if (filePath.includes("..") || filePath.includes("~")) {
                throw new HttpError(403);
            }

            const fullPath = resolve(localPath, filePath);
            const file = Bun.file(fullPath);

            return (async () => {
                if (!(await file.exists())) {
                    if (!filePath) {
                        const idx = Bun.file(resolve(fullPath, "index.html"));
                        if (await idx.exists()) return serveFile(c.req, idx);
                    }
                    throw new HttpError(404);
                }
                return serveFile(c.req, file);
            })();
        });
    }

    /** Configure the Stache template engine with a root directory and optional global variables. */
    engine(tmplRoot: string, globalVars: Record<string, unknown> = {}) {
        this.stache = new Stache(tmplRoot, globalVars);
    }

    /** Register an error handler. Can be called with a template path and handler, or a handler alone. */
    error(arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = resolveArgs(arg1, arg2);
        this.errDef = { template: tmpl, handler };
    }

    private routeFor(method: string) {
        return (pattern: string, arg1: Function | string, arg2?: Function) => {
            const [handler, tmpl] = resolveArgs(arg1, arg2);
            this.addRoute(method, pattern, handler, tmpl);
        };
    }

    private addRoute(method: string, pattern: string, handler: Function, template?: string) {
        this.routes.push({
            method,
            pattern,
            urlp: new URLPattern({ pathname: pattern }),
            handler,
            template,
            priority: getRoutePriority(pattern),
        });
        this.routes.sort((a, b) => b.priority - a.priority);
    }

    private async onError(e: any, ctx: Context): Promise<Response> {
        if (!this.errDef) {
            return new Response(e.message || "Internal Server Error", { status: 500 });
        }

        const result = await this.errDef.handler(e, ctx);
        const status = e instanceof HttpError ? e.status : 500;

        if (ctx._template && this.errDef.template && this.stache) {
            const html = await this.stache.view(this.errDef.template, result);
            return new Response(html, {
                status,
                headers: { ...ctx.responseHeaders, "Content-Type": "text/html; charset=utf-8" },
            });
        }
        return buildResponse(result, ctx, status);
    }
}

function getRoutePriority(pattern: string): number {
    let score = 0;
    for (const seg of pattern.replace(/^\//, "").split("/")) {
        if (!seg || seg === "*") score += 0;
        else if (seg.startsWith(":") && seg.includes("(")) score += 2;
        else if (seg.startsWith(":")) score += 1;
        else score += 3;
    }
    return score;
}

function serveFile(req: Request, file: ReturnType<typeof Bun.file>): Response {
    const etag = `W/"${file.size}-${file.lastModified}"`;
    if (req.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
    }

    const headers: Record<string, string> = {
        ETag: etag,
        "Cache-Control": "public, max-age=3600",
        "Content-Type": file.type || "application/octet-stream",
        "Accept-Ranges": "bytes",
    };

    const range = req.headers.get("Range");
    if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
            if (start < file.size && end < file.size && start <= end) {
                headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
                headers["Content-Length"] = String(end - start + 1);
                return new Response(file.slice(start, end + 1), { status: 206, headers });
            }
        }
    }

    return new Response(file, { headers });
}

function buildResponse(val: any, ctx?: Context, overrideStatus?: number): Response {
    if (val instanceof Response) return val;
    const status = overrideStatus ?? ctx?.responseStatus ?? 200;
    const headers = { ...ctx?.responseHeaders };

    if (val == null) {
        return new Response(null, { status: 204, headers });
    }
    if (val instanceof ReadableStream) {
        return new Response(val, { status, headers });
    }
    if (val instanceof Blob) {
        return new Response(val, {
            status,
            headers: { ...headers, "Content-Type": val.type || "application/octet-stream" },
        });
    }
    if (typeof val === "string") {
        return new Response(val, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    }
    if (typeof val === "object") {
        return new Response(JSON.stringify(val), {
            status,
            headers: { ...headers, "Content-Type": "application/json" },
        });
    }
    return new Response(String(val), { status, headers });
}

function parseCookies(req: Request): Record<string, string> {
    const cookie = req.headers.get("Cookie") || "";
    const result: Record<string, string> = {};
    for (const c of cookie.split(";")) {
        const i = c.indexOf("=");
        if (i > 0) result[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    }
    return result;
}

function resolveArgs(arg1: Function | string, arg2?: Function): [Function, string?] {
    if (typeof arg1 === "function") {
        return [arg1, undefined];
    }
    return [arg2!, arg1];
}

function joinPath(a: string, b: string): string {
    return a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "");
}
