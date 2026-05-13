import { resolve } from "path";
import { Stache } from "./stache";

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

type RouteMethod = (pattern: string, arg1: Function | string, arg2?: Function) => void;

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

export class HttpError extends Error {
    status: number;
    constructor(status: number, message?: string) {
        super(message || STATUS_TEXT[status] || "Error");
        this.name = "HttpError";
        this.status = status;
    }
}

export class SessionStore {
    private sessions = new Map<string, Record<string, unknown>>();

    get(sid: string): Record<string, unknown> | undefined {
        return this.sessions.get(sid);
    }
    set(sid: string, data: Record<string, unknown>): void {
        this.sessions.set(sid, data);
    }
}

const sessionStore = new SessionStore();
export class Context {
    req: Request;
    params: Record<string, string>;
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

    status(code: number): this {
        this.resStatus = code;
        return this;
    }

    header(name: string, value: string): this {
        this.resHeaders[name] = value;
        return this;
    }

    json(obj: any): Response {
        return new Response(JSON.stringify(obj), {
            status: this.resStatus,
            headers: { ...this.resHeaders, "Content-Type": "application/json" },
        });
    }

    html(str: string): Response {
        return new Response(str, {
            status: this.resStatus,
            headers: { ...this.resHeaders, "Content-Type": "text/html; charset=utf-8" },
        });
    }

    text(str: string): Response {
        return new Response(str, {
            status: this.resStatus,
            headers: this.resHeaders,
        });
    }

    get responseStatus(): number {
        return this.resStatus;
    }
    get responseHeaders(): Record<string, string> {
        return this.resHeaders;
    }
}

export class Bunny {
    private routes: RouteDef[] = [];
    private middlewares: MiddlewareDef[] = [];
    private errDef?: ErrorDef;
    private stache?: Stache;

    get: RouteMethod = this.routeFor("GET");
    post: RouteMethod = this.routeFor("POST");
    put: RouteMethod = this.routeFor("PUT");
    delete: RouteMethod = this.routeFor("DELETE");
    patch: RouteMethod = this.routeFor("PATCH");
    options: RouteMethod = this.routeFor("OPTIONS");
    head: RouteMethod = this.routeFor("HEAD");

    fetch = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const params: Record<string, string> = {};
        const ctx = new Context(req, params);

        try {
            const route = this.routes.find((r) => r.method === req.method && r.urlp.test(url));
            if (!route) {
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
                return new Response(html, {
                    status: ctx.responseStatus,
                    headers: { ...ctx.responseHeaders, "Content-Type": "text/html; charset=utf-8" },
                });
            }
            return toResponse(result, ctx);
        } catch (e: any) {
            return this.onError(e, ctx);
        }
    };

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

    engine(tmplRoot: string, globalVars: Record<string, unknown> = {}) {
        this.stache = new Stache(tmplRoot, globalVars);
    }

    error(arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.errDef = { template: tmpl, handler };
    }

    private routeFor(method: string) {
        return (pattern: string, arg1: Function | string, arg2?: Function) => {
            const [handler, tmpl] = this.resolveArgs(arg1, arg2);
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

    private resolveArgs(arg1: Function | string, arg2?: Function): [Function, string?] {
        if (typeof arg1 === "function") {
            return [arg1, undefined];
        }
        return [arg2!, arg1];
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
        return toResponse(result, ctx, status);
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
    return new Response(file, {
        headers: { ETag: etag, "Cache-Control": "public, max-age=3600" },
    });
}

function toResponse(val: any, ctx?: Context, overrideStatus?: number): Response {
    if (val instanceof Response) {
        return val;
    }
    const status = overrideStatus ?? ctx?.responseStatus ?? 200;
    const headers = { ...ctx?.responseHeaders };
    if (val == null) {
        return new Response(null, { status: 204, headers });
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

function joinPath(a: string, b: string): string {
    return a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "");
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
