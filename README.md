# 🐰 Bunny — Lightweight Bun Web Framework

[中文](README.zh.md) | English

A web framework built on [Bun](https://bun.sh) native APIs with zero external dependencies. Supports routing groups, middleware, template engine, static files, and error handling.

## Installation

```bash
# Install via JSR
bunx jsr add @focal/bunny
```

## Quick Start

```typescript
import { Bunny } from "@focal/bunny";

const app = new Bunny();
app.get("/", async (c) => "Hello World!");
export default app;
```

Run:

```bash
bun run server.ts
```

Bun detects the exported `fetch` handler on the Bunny instance and calls `Bun.serve()` automatically. No explicit server startup is needed.

To customize server options (port, hostname, TLS, etc.), use `Bun.serve()` directly:

```typescript
// Option A: Export a config object with port
export default { fetch: app.fetch, port: 3000 };

// Option B: Call Bun.serve explicitly
Bun.serve({ fetch: app.fetch, port: 3000, hostname: "0.0.0.0" });
```

## Routing

### HTTP Methods

```typescript
app.get("/path", handler);
app.post("/path", handler);
app.put("/path", handler);
app.delete("/path", handler);
app.patch("/path", handler);
app.options("/path", handler);
app.head("/path", handler);
```

Path parameters (`:param`) via `c.params`:

```typescript
app.get("/users/:id", async (c) => {
    return { id: c.params.id };
});
// GET /users/42 → {"id":42}
```

Query parameters via `c.query`:

```typescript
app.get("/search", async (c) => {
    return { q: c.query.q, page: c.query.page };
});
// GET /search?q=bunny&page=1 → {"q":"bunny","page":"1"}
```

### Template Rendering

Pass a template filename as the second argument (requires `app.engine()` — see [Template Engine](#template-engine)):

```typescript
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

### Priority

Static paths > `:param(regex)` paths > `:param` paths > `*` wildcards, regardless of registration order.

## Response

Return any value directly from the route handler — no need to call context methods:

```typescript
app.get("/text", async (c) => "Hello World");             // text/html
app.get("/json", async (c) => ({ key: "value" }));        // application/json
app.get("/null", async (c) => null);                      // 204 No Content
app.get("/response", async (c) => new Response("ok"));    // Raw Response
app.get("/image", async (c) => Bun.file("./photo.png"));  // Blob → auto Content-Type
app.get("/video", async (c) => {
    const file = Bun.file("./video.mp4");
    return file.stream();                                 // ReadableStream
});
```

Or use the `Context` API for full control:

```typescript
c.text("ok");                       // Plain text
c.html("<h1>Title</h1>");           // HTML
c.json({ key: "value" });           // JSON
c.status(201);                      // Set status code
c.header("X-Version", "1.0");       // Set response header
```

Chaining:

```typescript
app.get("/created", async (c) => {
    return c.status(201).header("X-Version", "1.0").json({ message: "created" });
});
```

## Middleware

### Global Middleware

```typescript
import { type Context } from "@focal/bunny";

async function logger(c: Context, next: () => Promise<void>) {
    const start = Date.now();
    await next();
    console.log(`${Date.now() - start}ms`);
}

app.use(logger);
```

### Scoped Middleware

```typescript
app.use("/admin/*", auth);
```

Not calling `next()` in a middleware stops the chain — the route handler (and subsequent middlewares) will not execute. This is how you implement auth guards, rate limiting, etc.

## Route Grouping

Create a separate `Bunny` instance and mount it with `route()`:

```typescript
const api = new Bunny();
api.get("/users", async (c) => ([{ id: 1, name: "Alice" }]));

app.route("/v1", api);  // → /v1/users
```

Middleware and error handlers from the sub-instance are only inherited if the parent has not set one.

## Session

In-memory session support:

```typescript
app.get("/login", async (c) => {
    c.session.set("user", { id: 1, name: "Alice" });
    c.session.set("lang", "en");
    return "Logged in";
});

app.get("/profile", async (c) => {
    const user = c.session.get("user");
    return user ? user : "Not logged in";
});

app.get("/logout", async (c) => {
    c.session.remove("user");      // Remove a single key
    c.session.destroy();           // Clear all data & expire cookie
    return "Logged out";
});
```

| Method | Description |
|---|---|
| `get(key)` | Get value by key |
| `set(key, value)` | Set value |
| `remove(key)` | Remove a single key |
| `destroy()` | Clear all data and expire the session cookie |

Session ID is stored in a `SESS_ID` cookie (`HttpOnly`, `SameSite=Lax`). Data is held in memory by the default `SessionStore` — restarting the server clears all sessions.

## Static Assets

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt → ./public/test.txt
```

Automatic ETag, `304` cache negotiation, `206` Partial Content (Range requests for video seeking), directory index (`index.html`), and path traversal protection (`..` and `~` blocked).

## Template Engine

```typescript
app.engine("./templates", { appName: "MyApp", year: 2026 });
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

The root path is relative to the current working directory. `app.engine()` must be called before any route that uses a template — the engine is not configured otherwise.

When a template is specified as the second route argument, the object returned by the handler is merged with the global variables and exposed to the template. Each property becomes a template variable by its name.

| Syntax | Meaning | Example |
|---|---|---|
| `{{=expr}}` | Output expression | `{{=user.name}}` |
| `{{? expr}}` | if | `{{? user.loggedIn}}` |
| `{{?? expr}}` | else if | `{{?? user.role === "admin"}}` |
| `{{?}}` | end if | |
| `{{~ arr: val}}` | for loop | `{{~ items: item}}` |
| `{{~ arr: val : idx}}` | for loop with index | `{{~ items: item : i}}` |
| `{{@ file}}` | Include partial | `{{@ header.html}}` |
| `{{> name}}` | Insert a defined block | `{{> sidebar}}` |
| `{{< name}}...{{<}}` | Define a reusable block | `{{< sidebar}}...{{<}}` |
| `{{code}}` | Execute JavaScript statement (no `var`/`let`/`const` — the engine auto-declares variables) | `{{total = price * qty;}}` |

Example template — a layout page with partials and a content block:

```html
<!-- layout.html — the outer shell -->
<html>
  <head><title>{{=title}}</title></head>
  <body>
    {{@ header.html}}
    <main>{{> content}}</main>
    {{@ footer.html}}
  </body>
</html>

<!-- index.html — fills the content block and applies the layout -->
{{@ layout.html}}

{{< content}}
  {{? user.loggedIn}}
    <h1>Welcome {{=user.name}}</h1>
    {{~ cart: item : i}}
      <p>{{=i + 1}}. {{=item.name}} — ${{=item.price}}</p>
    {{~}}
    {{total = cart.reduce((s, i) => s + i.price, 0);}}
    <strong>Total: ${{=total}}</strong>
  {{?? user.role === "guest"}}
    <a href="/login">Login</a>
  {{?}}
{{<}}
```

## Error Handling

```typescript
import { HttpError } from "@focal/bunny";

app.get("/error", async (c) => {
    throw new HttpError(400, "Bad request");
});
```

Register an error handler:

```typescript
// With template — error template is only rendered if the errored route also had a template
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message };
});

// Without template — always returns the raw result
app.error(async (e, c) => {
    return { error: e.message };
});
```

Error response behavior: if the original route that caused the error had a template, the error template is rendered (HTML). Otherwise, the error handler's return value is returned as-is (JSON for objects, text for strings). Framework-level errors (404, 405, static file 403/404) also flow through the error handler.

## Full Example

```typescript
// server.ts
import { Bunny, HttpError, type Context } from "@focal/bunny";

const app = new Bunny();
app.static("/assets", "./assets");
app.engine("./templates", { appName: "Bunny", year: 2026 });

// Logger middleware
app.use(async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.url} — ${Date.now() - start}ms`);
});

// Auth guard — stops the chain by throwing before next()
app.use("/admin/*", async (c: Context, next: () => Promise<void>) => {
    if (!c.session.get("user")) throw new HttpError(401);
    await next();
});

app.get("/", async (c) => "Hello World!");

// Sub-router
const api = new Bunny();
api.get("/users", async (c) => [{ id: 1, name: "Alice" }]);
app.route("/v1", api);

// Error handler
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
```

## API Reference

### Bunny

| Method | Description |
|---|---|
| `get / post / put / delete / patch / options / head` | HTTP route registration |
| `use(handler)` | Global middleware |
| `use(pattern, handler)` | Scoped middleware |
| `error(handler)` | Error handler |
| `error(template, handler)` | Error handler with template |
| `route(prefix, sub)` | Mount sub-router |
| `static(webPath, localPath)` | Static file serving |
| `engine(tmplRoot, globalVars?)` | Template engine config |

### Context

| Method / Property | Description |
|---|---|
| `c.req` | Raw Request object |
| `c.params` | Path parameters |
| `c.query` | Query string parameters |
| `c.session` | Session get/set (`.get<T>(key)`, `.set(key, value)`) |
| `c.text(str)` | Plain text response |
| `c.json(obj)` | JSON response |
| `c.html(str)` | HTML response |
| `c.status(code)` | Set status code (chainable) |
| `c.header(name, value)` | Set response header (chainable) |
