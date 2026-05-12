# 🐰 Bunny — 轻量 Bun Web 框架

基于 [Bun](https://bun.sh) 原生 API 的 Web 框架，无需外部依赖，支持路由分组、中间件、模板引擎、静态文件、错误处理。

---

## 安装

```bash
# 通过 JSR 安装
bunx jsr add @bunny/bunny
```

或直接复制 `bunny.ts` 和 `stache.ts` 到你项目中（零依赖，即拿即用）。

## 快速开始

```typescript
import { Bunny } from "jsr:@bunny/bunny";

const app = new Bunny();

app.get("/", async (c) => c.text("Hello World!"));

export default app;
```

启动：

```bash
bun run server.ts
```

---

## 路由

### HTTP 方法

```typescript
app.get("/path", handler);
app.post("/path", handler);
app.put("/path", handler);
app.delete("/path", handler);
app.patch("/path", handler);
app.options("/path", handler);
app.head("/path", handler);
```

路径参数（`:param`）通过 `c.params` 获取：

```typescript
app.get("/users/:id", async (c) => {
    return c.json({ id: +c.params.id });
});
// GET /users/42 → {"id":42}
```

### 模板渲染

第二个参数传入模板文件名：

```typescript
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

### 优先级

静态路径 > 参数路径 > 通配符，与注册顺序无关。

---

## 响应 (Context)

```typescript
c.text("ok");                       // 纯文本
c.html("<h1>Title</h1>");           // HTML
c.json({ key: "value" });           // JSON
c.status(201);                      // 设置状态码
c.header("X-Version", "1.0");       // 设置响应头
```

链式调用：

```typescript
app.get("/created", async (c) => {
    c.status(201);
    c.header("X-ID", "123");
    return c.json({ message: "created" });
});
```

也可以直接返回 `Response` 对象。

---

## 中间件

### 全局中间件

```typescript
import { type Context } from "jsr:@bunny/bunny";

async function logger(c: Context, next: () => Promise<void>) {
    const start = Date.now();
    await next();
    console.log(`${Date.now() - start}ms`);
}

app.use(logger);
```

### 带路径的中间件

```typescript
app.use("/admin/*", auth);
```

### 路径内联

```typescript
app.use("/*", async (c, next) => {
    console.log("before");
    await next();
});
```

### Auth 中间件示例

```typescript
// auth.ts
import { HttpError, type Context } from "jsr:@bunny/bunny";

const VALID_TOKENS = new Set(["token-123", "token-456"]);

export default async function auth(c: Context, next: () => Promise<void>) {
    const token =
        c.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
        || new URL(c.req.url).searchParams.get("token");

    if (!token || !VALID_TOKENS.has(token)) {
        throw new HttpError(401, "Unauthorized");
    }

    await next();
}
```

```typescript
// server.ts
import auth from "./auth";
app.use("/protected/*", auth);
```

---

## 路由分组

创建独立 `Bunny` 实例，通过 `route()` 挂载：

```typescript
// apis.ts
import { Bunny } from "jsr:@bunny/bunny";

const api = new Bunny();
api.get("/users", async (c) => c.json([{ id: 1, name: "Alice" }]));
api.post("/users", async (c) => {
    const body = await c.req.json();
    c.status(201);
    return c.json({ ...body, id: Date.now() });
});

export default api;
```

```typescript
// server.ts
import api from "./apis";
app.route("/v1", api);  // → /v1/users
```

分组内的中间件和错误处理器会自动继承。

---

## 静态文件

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt → ./public/test.txt
```

自动 ETag、`304`、目录索引、路径穿越防护。

---

## 模板引擎

```typescript
app.engine("./templates", { appName: "MyApp", year: 2026 });
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

| 语法 | 说明 |
|---|---|
| `{{=expr}}` | 输出表达式 |
| `{{? expr}}` | if |
| `{{?? expr}}` | else if |
| `{{?}}` | end if |
| `{{~ arr: val}}` | for 循环 |
| `{{@ file}}` | 引入子模板 |

---

## 错误处理

```typescript
import { HttpError } from "jsr:@bunny/bunny";

app.get("/error", async (c) => {
    throw new HttpError(400, "参数错误");
});
```

注册错误处理器：

```typescript
// 有模板
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message };
});

// 无模板
app.error(async (e, c) => {
    return { error: e.message };
});
```

---

## 完整示例

```typescript
// server.ts
import { Bunny, HttpError, type Context } from "jsr:@bunny/bunny";
import routes from "./src/routes.ts";
import timer from "./src/middlewars.ts";
import auth from "./src/auth.ts";
import apis from "./src/apis.ts";

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

```typescript
// src/routes.ts
import { Bunny, type Context } from "jsr:@bunny/bunny";

const routes = new Bunny();

routes.get("/", async (c) => c.text("Hello!"));
routes.get("/json", async (c) => c.json({ message: "Hello" }));
routes.get("/hello", "hello.html", async (c) => ({ name: "World" }));
routes.get("/users/:id", async (c) => c.json({ id: +c.params.id }));
routes.post("/data", async (c) => {
    const body = await c.req.json();
    c.status(201);
    return c.json({ received: body });
});

export default routes;
```

```typescript
// src/middlewars.ts
import { Bunny, type Context } from "jsr:@bunny/bunny";

const app = new Bunny();

app.use(async (c, next) => {
    const start = Date.now();
    await next();
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${Date.now() - start}ms`);
});

export default app;
```

---

## API 一览

### Bunny

| 方法 | 说明 |
|---|---|
| `get / post / put / delete / patch / options / head` | HTTP 路由 |
| `use(handler)` | 全局中间件 |
| `use(pattern, handler)` | 路径中间件 |
| `error(handler)` | 错误处理器 |
| `error(template, handler)` | 错误处理器 + 模板 |
| `route(prefix, sub)` | 挂载子路由 |
| `static(webPath, localPath)` | 静态文件 |
| `engine(tmplRoot, globalVars?)` | 模板引擎 |

### Context

| 方法 / 属性 | 说明 |
|---|---|
| `c.req` | 原始 Request |
| `c.params` | 路径参数 |
| `c.text(str)` | 纯文本响应 |
| `c.json(obj)` | JSON 响应 |
| `c.html(str)` | HTML 响应 |
| `c.status(code)` | 设置状态码 |
| `c.header(name, value)` | 设置响应头 |

---

## 发布到 JSR

```bash
bunx jsr publish
```
