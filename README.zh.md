# 🐰 Bunny — 轻量 Bun Web 框架

中文 | [English](README.md)

基于 [Bun](https://bun.sh) 原生 API 的 Web 框架，无需外部依赖，支持路由分组、中间件、模板引擎、静态文件、错误处理。

---

## 安装

```bash
# 通过 JSR 安装
bunx jsr add @focal/bunny
```

## 快速开始

```typescript
import { Bunny } from "jsr:@focal/bunny";

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

查询参数通过 `c.query` 获取：

```typescript
app.get("/search", async (c) => {
    return c.json({ q: c.query.q, page: c.query.page });
});
// GET /search?q=bunny&page=1 → {"q":"bunny","page":"1"}
```

### 模板渲染

第二个参数传入模板文件名：

```typescript
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

### 优先级

静态路径 > 参数路径 > 通配符，与注册顺序无关。

---

## 响应

路由处理器可以直接返回任意值，无需调用 context 方法：

```typescript
app.get("/text", async (c) => "Hello World");         // text/html
app.get("/json", async (c) => ({ key: "value" }));     // application/json
app.get("/null", async (c) => null);                    // 204 No Content
app.get("/response", async (c) => new Response("ok")); // 原始 Response
```

也可以使用 `Context` API 进行精细控制：

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

---

## 中间件

### 全局中间件

```typescript
import { type Context } from "jsr:@focal/bunny";

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

---

## 路由分组

创建独立 `Bunny` 实例，通过 `route()` 挂载：

```typescript
const api = new Bunny();
api.get("/users", async (c) => c.json([{ id: 1, name: "Alice" }]));

app.route("/v1", api);  // → /v1/users
```

分组内的中间件和错误处理器**仅当主应用未设置时**自动继承。

---

## 会话 (Session)

基于内存的会话支持，通过 `c.session.get()` / `c.session.set()` 操作：

```typescript
app.get("/login", async (c) => {
    c.session.set("user", { id: 1, name: "Alice" });
    return c.text("已登录");
});

app.get("/profile", async (c) => {
    const user = c.session.get("user");
    return user ? c.json(user) : c.text("未登录");
});
```

Session ID 通过 `sid` cookie（`HttpOnly`、`SameSite=Lax`）传递。数据存储在默认的 `SessionStore` 内存中，重启服务后所有会话将丢失。

---

## 静态文件

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt → ./public/test.txt
```

自动 ETag、`304` 缓存协商、目录索引（自动寻找 index.html）、路径穿越防护（`..` 和 `~` 被拦截）。

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
| `{{~ arr: val : idx}}` | for 循环（带索引） |
| `{{@ file}}` | 引入子模板 |

---

## 错误处理

```typescript
import { HttpError } from "jsr:@focal/bunny";

app.get("/error", async (c) => {
    throw new HttpError(400, "参数错误");
});
```

注册错误处理器：

```typescript
// 带模板 — 仅原路由也使用模板时才渲染
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message };
});

// 无模板 — 始终返回原始结果
app.error(async (e, c) => {
    return { error: e.message };
});
```

错误响应行为：若抛出错误的原路由带有模板，则渲染错误模板（HTML）；否则返回错误处理器的原始结果（JSON/文本）。404、405、静态文件 403/404 等框架级错误也统一走错误处理器。

---

## 完整示例

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
| `static(webPath, localPath)` | 静态文件服务 |
| `engine(tmplRoot, globalVars?)` | 模板引擎 |

### Context

| 方法 / 属性 | 说明 |
|---|---|---|
| `c.req` | 原始 Request |
| `c.params` | 路径参数 |
| `c.query` | 查询字符串参数 |
| `c.session` | 会话读写（`.get<T>(key)`, `.set(key, value)`） |
| `c.text(str)` | 纯文本响应 |
| `c.json(obj)` | JSON 响应 |
| `c.html(str)` | HTML 响应 |
| `c.status(code)` | 设置状态码（链式） |
| `c.header(name, value)` | 设置响应头（链式） |
