import "./bun-shim.ts";
import { resolve } from "node:path";
import { Mustache } from "./mustache.ts";

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

interface CookieInit {
    name?: string;
    value?: string;
    domain?: string;
    path?: string;
    expires?: number | Date | string;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    httpOnly?: boolean;
    partitioned?: boolean;
    maxAge?: number;
}

interface CookieStoreDeleteOptions {
    name: string;
    domain?: string | null;
    path?: string;
}

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

/** Cookie jar that mirrors Bun's `CookieMap` behavior and auto-applies changes to response headers. */
export class CookieJar {
    private map: Bun.CookieMap;
    private ctx: Context;

    constructor(ctx: Context) {
        this.ctx = ctx;
        this.map = new Bun.CookieMap(ctx.req.headers.get("Cookie") || "");
    }

    get(name: string): string | null {
        return this.map.get(name);
    }

    has(name: string): boolean {
        return this.map.has(name);
    }

    set(name: string, value: string, options?: CookieInit): void;
    set(options: CookieInit): void;
    set(cookie: Bun.Cookie): void;
    set(arg1: string | CookieInit | Bun.Cookie, arg2?: string | CookieInit, arg3?: CookieInit): void {
        let cookie: Bun.Cookie;
        if (arg1 instanceof Bun.Cookie) {
            cookie = arg1;
        } else if (typeof arg1 === "string") {
            const opts = arg3 ?? { httpOnly: true };
            cookie = new Bun.Cookie(arg1, arg2 as string, opts);
        } else {
            const opts = arg1.httpOnly === undefined ? { ...arg1, httpOnly: true } : arg1;
            cookie = new Bun.Cookie(opts);
        }
        this.map.set(cookie.name, cookie.value);
        this.ctx.header("Set-Cookie", cookie.serialize());
    }

    delete(name: string): void;
    delete(options: CookieStoreDeleteOptions): void;
    delete(arg: string | CookieStoreDeleteOptions): void {
        let name: string;
        let domain: string | null | undefined;
        let path: string | undefined;
        if (typeof arg === "string") {
            name = arg;
            this.map.delete(name);
            path = "/";
        } else {
            name = arg.name;
            domain = arg.domain;
            path = arg.path;
            this.map.delete(arg);
        }
        let h = `${name}=; Max-Age=0`;
        if (path) h += `; Path=${path}`;
        if (domain) h += `; Domain=${domain}`;
        this.ctx.header("Set-Cookie", h);
    }

    get size(): number {
        return this.map.size;
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.map[Symbol.iterator]();
    }
}

/** Per-request context passed to route handlers and middleware. */
export class Context {
    /** Raw incoming `Request` object. */
    req: Request;
    /** Path parameters extracted from the matched route pattern. */
    params: Record<string, string>;
    /** Parsed query-string parameters from the URL. */
    query: Record<string, string>;
    /** Data contributed by middleware, merged into template context on render. */
    templateData: Record<string, unknown> = {};

    private resStatus = 200;
    private resHeaders = new Headers();
    [key: string]: unknown;

    private _server: any;
    private _stache: Mustache;
    private _sessionSid?: string;
    private _sessionData?: Record<string, unknown>;
    private _cookieJar?: CookieJar;

    constructor(req: Request, server: any, stache: Mustache, params: Record<string, string>) {
        this.req = req;
        this._server = server;
        this._stache = stache;
        this.params = params;
        this.query = Object.fromEntries(new URL(req.url).searchParams);
    }

    /** Cookies map. Lazily initialized. Supports get/has/set/delete like Bun's `routes` API. */
    get cookies(): CookieJar {
        if (!this._cookieJar) {
            this._cookieJar = new CookieJar(this);
        }
        return this._cookieJar;
    }

    /** Read and write session data. Initializes the session lazily on first access. */
    get session(): {
        id: string;
        get: <T>(key: string) => T | undefined;
        set: (key: string, value: unknown) => void;
        remove: (key: string) => void;
        destroy: () => void;
    } {
        const self = this;
        if (!self._sessionData) {
            self._sessionSid = self.cookies.get(SESSION_COOKIE) ?? undefined;
            if (self._sessionSid) {
                self._sessionData = sessionStore.get(self._sessionSid) || {};
            } else {
                self._sessionSid = crypto.randomUUID();
                self._sessionData = {};
                self.cookies.set(SESSION_COOKIE, self._sessionSid, {
                    path: "/",
                    httpOnly: true,
                    sameSite: "lax",
                });
            }
        }
        return {
            get id(): string {
                return self._sessionSid!;
            },
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
                self.cookies.delete(SESSION_COOKIE);
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
        if (name.toLowerCase() === "set-cookie") {
            this.resHeaders.append(name, value);
        } else {
            this.resHeaders.set(name, value);
        }
        return this;
    }

    /** All response header entries, including multiple `Set-Cookie` values. */
    get headerEntries(): [string, string][] {
        return [...this.resHeaders.entries()];
    }

    /** Remote client IP address. Prefers `server.requestIP()` (direct connection), then falls back to common proxy headers. */
    get ip(): string | null {
        try {
            const direct = this._server?.requestIP?.(this.req)?.address;
            if (direct) return direct;
        } catch {}
        const headers = this.req.headers;
        return (
            headers.get("cf-connecting-ip") ??
            headers.get("x-real-ip") ??
            headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null
        );
    }

    /** Return a JSON response. Automatically sets `Content-Type: application/json`. */
    json(obj: any): Response {
        const h = new Headers(this.resHeaders);
        h.set("Content-Type", "application/json");
        return new Response(JSON.stringify(obj), { status: this.resStatus, headers: h });
    }

    /** Return an HTML response. Automatically sets `Content-Type: text/html; charset=utf-8`. */
    html(str: string): Response {
        const h = new Headers(this.resHeaders);
        h.set("Content-Type", "text/html; charset=utf-8");
        return new Response(str, { status: this.resStatus, headers: h });
    }

    /** Return a plain-text response. */
    text(str: string): Response {
        return new Response(str, { status: this.resStatus, headers: this.resHeaders });
    }

    /** Redirect to a URL (default 307, pass 301/308 for permanent). */
    redirect(url: string, code: 301 | 302 | 307 | 308 = 307): Response {
        this.status(code);
        this.header("Location", url);
        return new Response(null, { status: code, headers: new Headers(this.resHeaders) });
    }

    /** Render a template string with data. */
    render(template: string, data: Record<string, unknown> = {}): Promise<string> {
        return this._stache.render(template, mergeTemplateData(this, data));
    }

    /** Render a template file with data. */
    view(file: string, data: Record<string, unknown> = {}): Promise<string> {
        return this._stache.view(file, mergeTemplateData(this, data));
    }

    /** The response status code (read-only, set via `.status()`). */
    get responseStatus(): number {
        return this.resStatus;
    }
    /** The response headers (read-only, set via `.header()`). */
    get responseHeaders(): Record<string, string> {
        return Object.fromEntries(this.resHeaders.entries());
    }
}

/** Main application class. Create an instance, register routes/middleware, then export it. */
export class Bunny {
    private routes: RouteDef[] = [];
    private middlewares: MiddlewareDef[] = [];
    private errDef?: ErrorDef;
    private stache = new Mustache();

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
    fetch = async (req: Request, server?: any): Promise<Response> => {
        const url = new URL(req.url);
        const params: Record<string, string> = {};
        const ctx = new Context(req, server, this.stache, params);

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
                    const r = await mws[i].handler(ctx, () => compose(i + 1));
                    if (r !== undefined) result = r;
                } else {
                    result = await route.handler(ctx);
                }
            };
            await compose(0);

            if (result instanceof Response) return result;
            if (route.template) {
                result = mergeTemplateData(ctx, result);
                const html = await this.stache.view(route.template, result);
                if (!ctx.responseHeaders["content-type"] && !ctx.responseHeaders["Content-Type"]) {
                    ctx.header("Content-Type", "text/html; charset=utf-8");
                }
                return new Response(html, {
                    status: ctx.responseStatus,
                    headers: ctx.headerEntries,
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
                        if (await idx.exists()) return await serveFile(c.req, idx);
                    }
                    throw new HttpError(404);
                }
                return await serveFile(c.req, file);
            })();
        });
    }

    /** Configure the template engine root directory and global variables. */
    engine(tmplRoot: string): void;
    engine(globalVars: Record<string, unknown>): void;
    engine(tmplRoot: string, globalVars: Record<string, unknown>): void;
    engine(tmplRoot?: string | Record<string, unknown>, globalVars?: Record<string, unknown>) {
        if (typeof tmplRoot === "object") {
            this.stache.setGlobals(tmplRoot);
        } else {
            if (tmplRoot) this.stache.setRoot(tmplRoot);
            if (globalVars) this.stache.setGlobals(globalVars);
        }
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

        let result = await this.errDef.handler(e, ctx);
        const status = e instanceof HttpError ? e.status : 500;
        if (result instanceof Response) return result;

        if (ctx._template && this.errDef.template) {
            result = mergeTemplateData(ctx, result);
            const html = await this.stache.view(this.errDef.template, result);
            const h = new Headers(ctx.headerEntries);
            h.set("Content-Type", "text/html; charset=utf-8");
            return new Response(html, { status, headers: h });
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

async function serveFile(req: Request, file: any): Promise<Response> {
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

    if (file instanceof Blob) return new Response(file, { headers });
    return new Response(await file.bytes(), { headers });
}

function buildResponse(val: any, ctx?: Context, overrideStatus?: number): Response {
    if (val instanceof Response) return val;
    const status = overrideStatus ?? ctx?.responseStatus ?? 200;
    const headers = new Headers(ctx?.headerEntries);

    if (val == null) return new Response(null, { status: 204, headers });
    if (val instanceof ReadableStream) return new Response(val, { status, headers });
    if (val instanceof Blob) {
        headers.set("Content-Type", val.type || "application/octet-stream");
        return new Response(val, { status, headers });
    }
    if (typeof val === "string") {
        headers.set("Content-Type", "text/html; charset=utf-8");
        return new Response(val, { status, headers });
    }
    if (typeof val === "object") {
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify(val), { status, headers });
    }
    return new Response(String(val), { status, headers });
}

function resolveArgs(arg1: Function | string, arg2?: Function): [Function, string?] {
    if (typeof arg1 === "function") {
        return [arg1, undefined];
    }
    return [arg2!, arg1];
}

function joinPath(a: string, b: string): string {
    return (a + "/" + b).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/** Check if a value is a plain key-value object (for template data merging) */
function isPlainObject(val: unknown): val is Record<string, unknown> {
    return Object.prototype.toString.call(val) === "[object Object]";
}

/** Merge `ctx.templateData` into the template rendering data */
function mergeTemplateData(ctx: Context, data: unknown): unknown {
    if (!Object.keys(ctx.templateData).length || !isPlainObject(data)) return data;
    return { ...ctx.templateData, ...data };
}
