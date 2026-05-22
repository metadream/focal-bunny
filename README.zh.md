# 🐰 Bunny — 轻量 Bun Web 框架

中文 | [English](README.md)

基于 [Bun](https://bun.sh) 原生 API 的 Web 框架，无外部依赖，支持路由分组、中间件、模板引擎、静态文件、错误处理。

## 安装

```bash
# 通过 JSR 安装
bunx jsr add @focal/bunny
```

## 快速开始

```typescript
import { Bunny } from "@focal/bunny";

const app = new Bunny();
app.get("/", async (c) => "Hello World!");
export default app;
```

启动：

```bash
bun run server.ts
```

Bun 会自动检测到导出对象上的 `fetch` 方法，自动调用 `Bun.serve()`。无需显式启动服务器。

如需自定义服务器参数（端口、主机名、TLS 等），可直接使用 `Bun.serve()`：

```typescript
// 方式 A：导出配置对象，指定端口
export default { fetch: app.fetch, port: 3000 };

// 方式 B：显式调用 Bun.serve
Bun.serve({ fetch: app.fetch, port: 3000, hostname: "0.0.0.0" });
```

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
    return { id: c.params.id };
});
// GET /users/42 → {"id":42}
```

查询参数通过 `c.query` 获取：

```typescript
app.get("/search", async (c) => {
    return { q: c.query.q, page: c.query.page };
});
// GET /search?q=bunny&page=1 → {"q":"bunny","page":"1"}
```

### 模板渲染

第二个参数传入模板文件名（需要先调用 `app.engine()`，见[模板引擎](#模板引擎)）：

```typescript
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

### 优先级

静态路径 > 含正则的参数路径（`:id(\\d+)`）> 普通参数路径 > 通配符，与注册顺序无关。

## 响应

路由处理器可以直接返回任意值，无需调用 context 方法：

```typescript
app.get("/text", async (c) => "Hello World");             // text/html
app.get("/json", async (c) => ({ key: "value" }));        // application/json
app.get("/null", async (c) => null);                      // 204 No Content
app.get("/response", async (c) => new Response("ok"));    // 原始 Response
app.get("/image", async (c) => Bun.file("./photo.png"));  // Blob → 自动识别 Content-Type
app.get("/video", async (c) => {
    const file = Bun.file("./video.mp4");
    return file.stream();                                 // ReadableStream
});
```

也可以使用 `Context` API 进行精细控制：

```typescript
c.text("ok");                       // 纯文本
c.html("<h1>Title</h1>");           // HTML
c.json({ key: "value" });           // JSON
c.redirect("/login");               // 307 重定向
c.redirect("/new-url", 301);        // 永久重定向
c.redirect("/new-url", 308);        // 永久 + 保留请求方法
c.status(201);                      // 设置状态码
c.header("X-Version", "1.0");       // 设置响应头
```

链式调用：

```typescript
app.get("/created", async (c) => {
    return c.status(201).header("X-Version", "1.0").json({ message: "created" });
});
```

## 中间件

### 全局中间件

```typescript
import { type Context } from "@focal/bunny";

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

在中间件中不调用 `next()` 会终止链——路由处理器及后续中间件都不会执行。这是实现鉴权、限流等功能的机制。

## 路由分组

创建独立 `Bunny` 实例，通过 `route()` 挂载：

```typescript
const api = new Bunny();
api.get("/users", async (c) => ([{ id: 1, name: "Alice" }]));

app.route("/v1", api);  // → /v1/users
```

分组内的中间件和错误处理器**仅当主应用未设置时**自动继承。

## 会话 (Session)

基于内存的会话支持：

```typescript
app.get("/login", async (c) => {
    c.session.set("user", { id: 1, name: "Alice" });
    c.session.set("lang", "zh");
    return "已登录";
});

app.get("/profile", async (c) => {
    const user = c.session.get("user");
    return user ? user : "未登录";
});

app.get("/logout", async (c) => {
    c.session.remove("user");      // 删除单个字段
    c.session.destroy();           // 清空所有数据并过期 cookie
    return "已退出";
});
```

| 方法 | 说明 |
|---|---|
| `get(key)` | 获取值 |
| `set(key, value)` | 设置值 |
| `remove(key)` | 删除单个字段 |
| `destroy()` | 清空所有数据并使 cookie 过期 |

Session ID 通过 `SESS_ID` cookie（`HttpOnly`、`SameSite=Lax`）传递。数据存储在默认的 `SessionStore` 内存中，重启服务后所有会话将丢失。

## Cookies

通过 `c.cookies` 读写 cookie——`CookieJar` 的用法与 Bun `routes` API 的 `CookieMap` 一致。所有修改会自动写入响应 `Set-Cookie` 头。

```typescript
app.get("/cookies", async (c) => {
    // 读取
    const token = c.cookies.get("token");

    // 判断
    if (c.cookies.has("theme")) { /* ... */ }

    // 写入（httpOnly 默认 true）
    c.cookies.set("session", "abc123");
    c.cookies.set("token", "xyz", { httpOnly: false });
    c.cookies.set({ name: "theme", value: "dark", path: "/" });
    c.cookies.set(new Bun.Cookie("visit", "1", { maxAge: 3600 }));

    // 删除
    c.cookies.delete("token");
    c.cookies.delete({ name: "old", path: "/admin" });

    return "OK";
});
```

| 方法 | 说明 |
|---|---|
| `get(name)` | 获取 cookie 值（`string \| null`） |
| `has(name)` | 判断 cookie 是否存在 |
| `set(name, value, options?)` | 设置 cookie（options: `httpOnly`, `secure`, `sameSite`, `maxAge`, `path` 等） |
| `set(options)` | 通过 `CookieInit` 对象设置 |
| `set(cookie)` | 通过 `Bun.Cookie` 实例设置 |
| `delete(name)` | 删除 cookie |
| `delete(options)` | 按域名/路径删除 cookie |
| `size` | cookie 数量 |

## 静态资源

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt → ./public/test.txt
```

自动 ETag、`304` 缓存协商、`206` Partial Content（Range 请求，支持视频拖拽进度条）、目录索引（自动寻找 index.html）、路径穿越防护（`..` 和 `~` 被拦截）。

## 模板引擎

```typescript
app.engine("./templates", { appName: "MyApp", year: 2026 });
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

根目录相对于当前工作目录（CWD）。`app.engine()` 必须在所有使用模板的路由之前调用，否则模板不会渲染。

路由处理器返回的对象会与全局变量合并后传入模板，对象的每个属性按名称成为模板变量。

| 语法 | 说明 | 示例 |
|---|---|---|
| `{{=expr}}` | 输出表达式 | `{{=user.name}}` |
| `{{? expr}}` | if | `{{? user.loggedIn}}` |
| `{{?? expr}}` | else if | `{{?? user.role === "admin"}}` |
| `{{?}}` | end if | |
| `{{~ arr: val}}` | for 循环 | `{{~ items: item}}` |
| `{{~ arr: val : idx}}` | for 循环（带索引） | `{{~ items: item : i}}` |
| `{{@ file}}` | 引入子模板 | `{{@ header.html}}` |
| `{{> name}}` | 插入已定义的块 | `{{> sidebar}}` |
| `{{< name}}...{{<}}` | 定义可复用的块 | `{{< sidebar}}...{{<}}` |
| `{{code}}` | 执行 JavaScript 语句（不能加 `var`/`let`/`const`，引擎会自动声明变量） | `{{total = price * qty;}}` |

模板示例：

> `{{@ file}}` 不仅支持引入子模板，还支持引入父模板。引入父模板后，通过 `{{< name}}...{{<}}` 定义块，在父模板中用 `{{> name}}` 插入已定义的块，从而实现 **layout 模式**。这在多个具有相同结构的页面场景下尤为推荐。
```html
<!-- layout.html — 网站的总布局 -->
<html>
  <head><title>{{=title}}</title></head>
  <body>
    {{@ header.html}}
    <main>{{> content}}</main>
    {{@ footer.html}}
  </body>
</html>

<!-- index.html — 网站的具体页面（嵌入布局中的内容插槽） -->
{{@ layout.html }}

{{< content }}
  {{? user.loggedIn}}
    {{> sidebar}}
    <h1>欢迎 {{=user.name}}</h1>
    {{~ cart: item : i}}
      <p>{{=i + 1}}. {{=item.name}} — ¥{{=item.price}}</p>
    {{~}}
    {{total = cart.reduce((s, i) => s + i.price, 0);}}
    <strong>总计: ¥{{=total}}</strong>
  {{?? user.role === "guest"}}
    <a href="/login">登录</a>
  {{?}}
{{< }}
```

## 错误处理

```typescript
import { HttpError } from "@focal/bunny";

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

## 完整示例

```typescript
// server.ts
import { Bunny, HttpError, type Context } from "@focal/bunny";

const app = new Bunny();
app.static("/assets", "./assets");
app.engine("./templates", { appName: "Bunny", year: 2026 });

// 日志中间件
app.use(async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.url} — ${Date.now() - start}ms`);
});

// 鉴权守卫 — 不调用 next() 直接抛出异常
app.use("/admin/*", async (c: Context, next: () => Promise<void>) => {
    if (!c.session.get("user")) throw new HttpError(401);
    await next();
});

app.get("/", async (c) => "Hello World!");

// 子路由
const api = new Bunny();
api.get("/users", async (c) => [{ id: 1, name: "Alice" }]);
app.route("/v1", api);

// 错误处理
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
```

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
|---|---|
| `c.req` | 原始 Request |
| `c.cookies` | Cookie 读写（详见 [Cookies](#cookies)） |
| `c.ip` | 远程客户端 IP（自动通过 `server.requestIP()` 及代理头识别） |
| `c.params` | 路径参数 |
| `c.query` | 查询字符串参数 |
| `c.session` | 会话读写（`.get<T>(key)`, `.set(key, value)`） |
| `c.text(str)` | 纯文本响应 |
| `c.json(obj)` | JSON 响应 |
| `c.html(str)` | HTML 响应 |
| `c.redirect(url, code?)` | 重定向（默认 307，支持 301/302/308） |
| `c.status(code)` | 设置状态码（链式） |
| `c.header(name, value)` | 设置响应头（链式） |
