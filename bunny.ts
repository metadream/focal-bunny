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

export class HttpError extends Error {
    status: number;
    constructor(status: number, message?: string) {
        super(message || STATUS_TEXT[status] || "Error");
        this.name = "HttpError";
        this.status = status;
    }
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

export interface Context {
    req: Request;
    params: Record<string, string>;
    [key: string]: unknown;
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

export class Bunny {
    private routes: RouteDef[] = [];
    private middlewares: MiddlewareDef[] = [];
    private errDef?: ErrorDef;
    private stache?: Stache;
    private tmplMeta = new WeakMap<Function, string>();

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

    private decorator(method: string, pattern: string) {
        const self = this;
        const reg: any = (...a: any[]) => {
            let h: Function | undefined;
            if (a.length === 1 && typeof a[0] === "function") h = a[0];
            else if (a.length === 3 && a[2]?.value) h = a[2].value;
            else if (a.length === 2 && a[1]?.kind) h = a[0];
            if (h) {
                const t = self.tmplMeta.get(h);
                if (t) self.tmplMeta.delete(h);
                self.add(method, pattern, h, t);
            }
            return a.length === 3 ? a[2] : a[0];
        };

        reg.template =
            (t: string) =>
            (...a: any[]) => {
                let h: Function | undefined;
                if (a.length === 1 && typeof a[0] === "function") h = a[0];
                else if (a.length === 3 && a[2]?.value) h = a[2].value;
                else if (a.length === 2 && a[1]?.kind) h = a[0];
                if (h) self.add(method, pattern, h, t);
                return a.length === 3 ? a[2] : a[0];
            };
        return reg;
    }

    private detect(args: any[], cb: (h: Function) => void) {
        let h: Function | undefined;
        if (args.length === 1 && typeof args[0] === "function") h = args[0];
        else if (args.length === 3 && args[2]?.value) h = args[2].value;
        else if (args.length === 2 && args[1]?.kind) h = args[0];
        if (h) cb(h);
        return args.length === 3 ? args[2] : args[0];
    }

    private register(method: string, pattern: string, ...rest: any[]) {
        if (rest.length === 0) return this.decorator(method, pattern);
        let handler: Function | undefined;
        let tmpl: string | undefined;
        if (typeof rest[0] === "function") {
            handler = rest[0];
        } else if (rest[0] && typeof rest[0] === "object" && typeof rest[1] === "function") {
            tmpl = rest[0].template;
            handler = rest[1];
        }
        if (handler) {
            const t = tmpl || this.tmplMeta.get(handler);
            if (t) this.tmplMeta.delete(handler);
            this.add(method, pattern, handler, t);
        }
        return handler;
    }

    get = (pattern: string, ...rest: any[]) => this.register("GET", pattern, ...rest);
    post = (pattern: string, ...rest: any[]) => this.register("POST", pattern, ...rest);
    put = (pattern: string, ...rest: any[]) => this.register("PUT", pattern, ...rest);
    delete = (pattern: string, ...rest: any[]) => this.register("DELETE", pattern, ...rest);
    patch = (pattern: string, ...rest: any[]) => this.register("PATCH", pattern, ...rest);
    options = (pattern: string, ...rest: any[]) => this.register("OPTIONS", pattern, ...rest);
    head = (pattern: string, ...rest: any[]) => this.register("HEAD", pattern, ...rest);

    template =
        (tmpl: string) =>
        (...a: any[]) =>
            this.detect(a, (h) => this.tmplMeta.set(h, tmpl));

    middleware =
        (pattern: string) =>
        (...a: any[]) =>
            this.detect(a, (h) => {
                this.middlewares.push({ pattern, urlp: new URLPattern({ pathname: pattern }), handler: h });
            });

    error =
        (template?: string) =>
        (...a: any[]) =>
            this.detect(a, (h) => {
                this.errDef = { template, handler: h };
            });

    route(prefix: string, sub: Bunny) {
        for (const r of sub.routes) this.add(r.method, joinPath(prefix, r.pattern), r.handler, r.template);
        for (const m of sub.middlewares) {
            const p = joinPath(prefix, m.pattern);
            this.middlewares.push({ pattern: p, urlp: new URLPattern({ pathname: p }), handler: m.handler });
        }
        if (sub.errDef && !this.errDef) this.errDef = sub.errDef;
    }

    static(webPath: string, localPath: string) {
        const pattern = webPath + "/:rest*";
        this.add("GET", pattern, async (c: Context) => {
            let filePath = (c.params.rest || "").replace(/^\/+/, "");
            if (filePath.includes("..") || filePath.includes("~")) {
                return new Response("Forbidden", { status: 403 });
            }

            const fullPath = resolve(localPath, filePath);
            const file = Bun.file(fullPath);
            if (!(await file.exists())) {
                if (!filePath) {
                    const idx = Bun.file(resolve(fullPath, "index.html"));
                    if (await idx.exists()) return serveFile(c.req, idx);
                }
                return new Response("Not Found", { status: 404 });
            }
            return serveFile(c.req, file);
        });
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

        const ctx: Context = { req, params };
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
                return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
            }
            return toResponse(result);
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
            return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return toResponse(result, status);
    }
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

function toResponse(val: any, status?: number): Response {
    if (val instanceof Response) {
        return status ? new Response(val.body, { status, headers: val.headers }) : val;
    }
    if (val == null) {
        return new Response(null, { status: 204 });
    }
    if (typeof val === "string") {
        return new Response(val, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (typeof val === "object") {
        return Response.json(val, status ? { status } : undefined);
    }
    return new Response(String(val));
}

function joinPath(a: string, b: string): string {
    return a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "");
}
