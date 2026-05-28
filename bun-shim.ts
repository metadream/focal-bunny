const MIME_TYPES: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    txt: "text/plain",
    pdf: "application/pdf",
    webp: "image/webp",
    avif: "image/avif",
};

class Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: Date | number | string;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    httpOnly?: boolean;
    partitioned?: boolean;
    maxAge?: number;

    constructor(name: string, value: string, opts?: Record<string, unknown>);
    constructor(opts: Record<string, unknown>);
    constructor(arg1: string | Record<string, unknown>, arg2?: string, arg3?: Record<string, unknown>) {
        if (typeof arg1 === "string") {
            this.name = arg1;
            this.value = arg2 || "";
            Object.assign(this, typeof arg2 === "object" && !arg3 ? arg2 : arg3 || {});
        } else {
            this.name = (arg1.name as string) || "";
            this.value = (arg1.value as string) || "";
            Object.assign(this, arg1);
        }
    }

    serialize(): string {
        let s = `${encodeURIComponent(this.name)}=${encodeURIComponent(this.value)}`;
        if (this.maxAge !== undefined) s += `; Max-Age=${this.maxAge}`;
        if (this.domain) s += `; Domain=${this.domain}`;
        if (this.path) s += `; Path=${this.path}`;
        if (this.expires) {
            const d = this.expires instanceof Date ? this.expires : new Date(this.expires);
            s += `; Expires=${d.toUTCString()}`;
        }
        if (this.secure) s += `; Secure`;
        if (this.httpOnly) s += `; HttpOnly`;
        if (this.sameSite) s += `; SameSite=${this.sameSite}`;
        if (this.partitioned) s += `; Partitioned`;
        return s;
    }
}

class CookieMap implements Iterable<[string, string]> {
    private _map = new Map<string, string>();

    constructor(cookieHeader: string) {
        if (cookieHeader) {
            for (const part of cookieHeader.split(";")) {
                const idx = part.indexOf("=");
                if (idx !== -1) {
                    const key = part.substring(0, idx).trim();
                    const value = part.substring(idx + 1).trim();
                    if (key) this._map.set(decodeURIComponent(key), decodeURIComponent(value));
                }
            }
        }
    }

    get(name: string): string | undefined {
        return this._map.get(name);
    }
    has(name: string): boolean {
        return this._map.has(name);
    }
    set(name: string, value: string): void {
        this._map.set(name, value);
    }
    delete(name: string): void;
    delete(options: { name: string; domain?: string; path?: string }): void;
    delete(arg: string | { name: string; domain?: string; path?: string }): void {
        typeof arg === "string" ? this._map.delete(arg) : this._map.delete(arg.name);
    }
    get size(): number {
        return this._map.size;
    }
    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this._map[Symbol.iterator]();
    }
}

class BunFile {
    readonly path: string;
    private _size = 0;
    private _mtime = 0;

    constructor(path: string) {
        this.path = path;
        try {
            const stat = Deno.statSync(path);
            this._size = stat.size;
            this._mtime = stat.mtime?.getTime() ?? 0;
        } catch {}
    }

    get size(): number {
        return this._size;
    }
    get lastModified(): number {
        return this._mtime;
    }
    get type(): string {
        const ext = this.path.split(".").pop()?.toLowerCase() || "";
        return MIME_TYPES[ext] || "application/octet-stream";
    }

    async exists(): Promise<boolean> {
        if (this._size > 0 || this._mtime > 0) return true;
        try {
            await Deno.stat(this.path);
            return true;
        } catch {
            return false;
        }
    }

    async text(): Promise<string> {
        return Deno.readTextFile(this.path);
    }

    slice(start: number, end?: number): Blob {
        const data = Deno.readFileSync(this.path);
        return new Blob([data.slice(start, end)], { type: this.type });
    }

    async bytes(): Promise<Uint8Array> {
        return Deno.readFile(this.path);
    }
}

if (typeof Bun === "undefined" && typeof Deno !== "undefined") {
    (globalThis as any).Bun = {
        Cookie,
        CookieMap,
        file: (path: string) => new BunFile(path),
    };
}
