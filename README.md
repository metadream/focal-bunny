# 🐰 Bunny — Lightweight Bun Web Framework

A web framework built on [Bun](https://bun.sh) native APIs with zero external dependencies. Supports routing, middleware, template engine, static files, and error handling.

---

## Installation

```bash
# Install via JSR
bunx jsr add @focal/bunny
```

## Quick Start

```typescript
import { Bunny } from "jsr:@focal/bunny";

const app = new Bunny();

app.get("/", async (c) => c.text("Hello World!"));

export default app;
```

Run:

```bash
bun run server.ts
```

---

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
    return c.json({ id: +c.params.id });
});
// GET /users/42 → {"id":42}
```

### Template Rendering

Pass a template filename as the second argument:

```typescript
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

### Priority

Static paths > `:param` paths > `*` wildcards, regardless of registration order.

---

## Response (Context)

```typescript
c.text("ok");                       // Plain text
c.html("<h1>Title</h1>");           // HTML
c.json({ key: "value" });           // JSON
c.status(201);                      // Set status code (chainable)
c.header("X-Version", "1.0");       // Set response header (chainable)
```

Chaining:

```typescript
app.get("/created", async (c) => {
    c.status(201);
    c.header("X-ID", "123");
    return c.json({ message: "created" });
});
```

You can also return a `Response` object directly, a `string` (auto HTML), an `object` (auto JSON), or `null`/`undefined` (204 No Content).

---

## Middleware

### Global Middleware

```typescript
import { type Context } from "jsr:@focal/bunny";

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

---

## Route Grouping

Create a separate `Bunny` instance and mount it with `route()`:

```typescript
const api = new Bunny();
api.get("/users", async (c) => c.json([{ id: 1, name: "Alice" }]));

app.route("/v1", api);  // → /v1/users
```

Middleware and error handlers from the sub-instance are merged in. The sub-instance's error handler is only used if the parent has not set one.

---

## Static Files

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt → ./public/test.txt
```

Automatic ETag, `304` cache negotiation, directory index (`index.html`), and path traversal protection (`..` and `~` blocked).

---

## Template Engine (Stache)

```typescript
app.engine("./templates", { appName: "MyApp", year: 2026 });
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

| Syntax | Meaning |
|---|---|
| `{{=expr}}` | Output expression |
| `{{? expr}}` | if |
| `{{?? expr}}` | else if |
| `{{?}}` | end if |
| `{{~ arr: val}}` | for loop |
| `{{~ arr: val : idx}}` | for loop with index |
| `{{@ file}}` | Include partial |

---

## Error Handling

```typescript
import { HttpError } from "jsr:@focal/bunny";

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

---

## Full Example

```typescript
// server.ts
import { Bunny, HttpError, type Context } from "jsr:@focal/bunny";
import routes from "./src/routes";
import timer from "./src/middlewars";
import auth from "./src/auth";
import apis from "./src/apis";

const app = new Bunny();
const dir = import.meta.dir!;

app.static("/assets", dir + "/assets");
app.engine(dir + "/templates", { appName: "Bunny", year: 2026 });

app.use(timer);
app.use("/protected/*", auth);

app.route("/", routes);
app.route("/v1", apis);

app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
```

---

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
| `c.text(str)` | Plain text response |
| `c.json(obj)` | JSON response |
| `c.html(str)` | HTML response |
| `c.status(code)` | Set status code (chainable) |
| `c.header(name, value)` | Set response header (chainable) |

---

## Publishing to JSR

```bash
bunx jsr publish
```
