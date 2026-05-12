import { resolve } from "path";
import { Stache } from "./stache";

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

export class HttpError extends Error {
    status: number;
    constructor(status: number, message?: string) {
        super(message || STATUS_TEXT[status] || "Error");
        this.name = "HttpError";
        this.status = status;
    }
}

export class Context {
    req: Request;
    params: Record<string, string>;
    private resStatus = 200;
    private resHeaders: Record<string, string> = {};
    [key: string]: unknown;

    constructor(req: Request, params: Record<string, string>) {
        this.req = req;
        this.params = params;
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

    get responseStatus() {
        return this.resStatus;
    }
    get responseHeaders() {
        return this.resHeaders;
    }
}

export class Bunny {
    private routes: RouteDef[] = [];
    private middlewares: MiddlewareDef[] = [];
    private errDef?: ErrorDef;
    private stache?: Stache;

    private add(method: string, pattern: string, handler: Function, template?: string) {
        this.routes.push({
            method,
            pattern,
            urlp: new URLPattern({ pathname: pattern }),
            handler,
            template,
            priority: getRoutePriority(pattern),
        });
    }

    private resolveArgs(arg1: Function | string, arg2?: Function): [Function, string?] {
        if (typeof arg1 === "function") {
            return [arg1, undefined];
        }
        return [arg2!, arg1];
    }

    get(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("GET", pattern, handler, tmpl);
    }

    post(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("POST", pattern, handler, tmpl);
    }

    put(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("PUT", pattern, handler, tmpl);
    }

    delete(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("DELETE", pattern, handler, tmpl);
    }

    patch(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("PATCH", pattern, handler, tmpl);
    }

    options(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("OPTIONS", pattern, handler, tmpl);
    }

    head(pattern: string, arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.add("HEAD", pattern, handler, tmpl);
    }

    use(pattern: string, handler: Function) {
        this.middlewares.push({ pattern, urlp: new URLPattern({ pathname: pattern }), handler });
    }

    error(arg1: Function | string, arg2?: Function) {
        const [handler, tmpl] = this.resolveArgs(arg1, arg2);
        this.errDef = { template: tmpl, handler };
    }

    route(prefix: string, sub: Bunny) {
        for (const r of sub.routes) {
            this.add(r.method, joinPath(prefix, r.pattern), r.handler, r.template);
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
        const self = this;
        function handler(c: Context) {
            let filePath = (c.params.rest || "").replace(/^\/+/, "");
            if (filePath.includes("..") || filePath.includes("~")) {
                return new Response("Forbidden", { status: 403 });
            }
            const fullPath = resolve(localPath, filePath);
            const file = Bun.file(fullPath);
            return (async () => {
                if (!(await file.exists())) {
                    if (!filePath) {
                        const idx = Bun.file(resolve(fullPath, "index.html"));
                        if (await idx.exists()) return serveFile(c.req, idx);
                    }
                    return new Response("Not Found", { status: 404 });
                }
                return serveFile(c.req, file);
            })();
        }
        self.add("GET", pattern, handler);
    }

    engine(tmplRoot: string, globalVars: Record<string, unknown> = {}) {
        this.stache = new Stache(tmplRoot, globalVars);
    }

    fetch = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const sorted = this.routes.filter((r) => r.method === req.method).sort((a, b) => b.priority - a.priority);
        const route = sorted.find((r) => r.urlp.test(url));

        if (!route) {
            if (this.routes.some((r) => r.urlp.test(url))) {
                return new Response("Method Not Allowed", { status: 405 });
            }
            return new Response("Not Found", { status: 404 });
        }

        const match = route.urlp.exec(url);
        const params: Record<string, string> = {};
        if (match?.pathname?.groups) Object.assign(params, match.pathname.groups);

        const ctx = new Context(req, params);
        const mws = this.middlewares.filter((m) => m.urlp.test(url));
        let result: any;

        const compose = async (i: number): Promise<void> => {
            if (i < mws.length) {
                await mws[i].handler(ctx, () => compose(i + 1));
            } else {
                result = await route.handler(ctx);
            }
        };

        try {
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

    private async onError(e: any, ctx: Context): Promise<Response> {
        if (!this.errDef) {
            return new Response(e.message || "Internal Server Error", { status: 500 });
        }
        const result = await this.errDef.handler(e, ctx);
        const status = e instanceof HttpError ? e.status : 500;
        if (this.errDef.template && this.stache) {
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
        else if (seg.startsWith(":")) score += 1;
        else score += 2;
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
