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

### 路径参数

`:param` 匹配任意单段路径，通过 `c.params` 获取：

```typescript
app.get("/users/:id", async (c) => {
    return c.json({ id: +c.params.id });
});
// GET /users/42 → {"id":42}
```

### 通配符

`*` 匹配多段路径：

```typescript
app.get("/files/:rest*", async (c) => {
    return c.text(c.params.rest);
});
// GET /files/a/b/c → "a/b/c"
```

### 优先级

静态路径 > 参数路径 > 通配符，与注册顺序无关：

```typescript
app.get("/users/all", handler);   // 静态，优先级最高
app.get("/users/:id", handler);   // 参数
app.get("/users/*", handler);     // 通配符，优先级最低
```

---

## 响应 (Context)

### 文本

```typescript
app.get("/", async (c) => c.text("Hello"));
```

### JSON

```typescript
app.get("/data", async (c) => c.json({ key: "value" }));
```

### HTML

```typescript
app.get("/page", async (c) => c.html("<h1>Title</h1>"));
```

### 模板渲染

第二个参数传入模板文件名，handler 返回模板变量：

```typescript
app.get("/hello", "hello.html", async (c) => {
    return { name: "World" };
});
```

### 自定义状态码

```typescript
app.get("/created", async (c) => {
    c.status(201);
    return c.text("created");
});
```

### 自定义响应头

```typescript
app.get("/custom", async (c) => {
    c.header("X-Version", "1.0");
    c.header("X-Custom", "yes");
    return c.text("ok");
});
```

### 混合使用

```typescript
app.get("/mixed", async (c) => {
    c.status(201);
    c.header("X-ID", "123");
    return c.json({ message: "created" });
});
```

### 直接返回 Response

```typescript
app.get("/direct", async (c) => {
    return new Response("raw", { status: 200 });
});
```

---

## 中间件

使用 `app.use()` 注册中间件，洋葱模型执行：

```typescript
// 全局中间件
app.use("/*", async (c, next) => {
    const start = Date.now();
    await next();
    console.log(`${Date.now() - start}ms`);
});

// 特定路径中间件
app.use("/admin/*", async (c, next) => {
    console.log("admin request");
    await next();
});
```

中间件中的 `c` 就是 Context，可读取/修改请求信息，设置响应状态码和头。

---

## 路由分组

创建独立的 `Bunny` 实例，通过 `route()` 挂载到前缀：

```typescript
// apis.ts
import { Bunny } from "jsr:@bunny/bunny";

const api = new Bunny();

api.get("/users", async (c) => c.json([{ id: 1, name: "Alice" }]));
api.get("/users/:id", async (c) => c.json({ id: +c.params.id }));
api.post("/users", async (c) => {
    const body = await c.req.json();
    c.status(201);
    return c.json({ ...body, id: Date.now() });
});

export default api;
```

```typescript
// server.ts
import { Bunny } from "jsr:@bunny/bunny";
import api from "./apis.ts";

const app = new Bunny();
app.route("/v1", api);
// GET /v1/users, GET /v1/users/:id, POST /v1/users
export default app;
```

分组内的中间件会自动一并挂载，错误处理器也会继承（如果主实例未设置）。

---

## 静态文件

```typescript
app.static("/assets", "./public");
// GET /assets/test.txt  →  ./public/test.txt
```

特性：

- 自动 ETag 缓存
- `304 Not Modified` 响应
- 目录索引（自动寻找 `index.html`）
- 路径穿越防护（`..`、`~` 被拦截）

---

## 模板引擎 (Stache)

```typescript
// 配置模板目录和全局变量
app.engine("./templates", { appName: "MyApp", year: 2026 });

// 路由中使用模板（模板文件名为第二个参数）
app.get("/hello", "hello.html", async (c) => ({ name: "World" }));
```

模板文件 `templates/hello.html`：

```html
<h1>Hello, {{=name}}!</h1>
<p>Welcome to {{=appName}}</p>
```

### 语法

| 语法 | 说明 |
|---|---|
| `{{=expr}}` | 输出表达式 |
| `{{expr}}` | 执行代码 |
| `{{? expr}}` | if 条件 |
| `{{?? expr}}` | else if |
| `{{?}}` | end if |
| `{{~ arr: val}}` | for 循环 |
| `{{~ arr: val: idx}}` | for 循环带索引 |
| `{{~}}` | end for |
| `{{@ file}}` | 引入子模板 |
| `{{> name}}` | 占位块 |
| `{{< name}}...{{<}}` | 定义块 |

---

## 错误处理

```typescript
import { HttpError } from "jsr:@bunny/bunny";

app.get("/error", async (c) => {
    throw new HttpError(400, "参数错误");
});

app.get("/crash", async (c) => {
    throw new Error("未知错误");
});
```

注册错误处理器，模板文件名为第二个参数（可选）：

```typescript
// 有模板
app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

// 无模板
app.error(async (e, c) => {
    return { error: e.message };
});
```

错误模板 `templates/error.html`：

```html
<h1>Error {{=status}}</h1>
<p>{{=message}}</p>
```

---

## 完整示例

### 项目结构

```
my-app/
├── server.ts           # 入口
├── src/
│   ├── routes.ts       # 路由
│   ├── middlewars.ts   # 中间件
│   └── apis.ts         # API 分组
├── assets/             # 静态文件
└── templates/          # 模板文件
    ├── hello.html
    └── error.html
```

### server.ts

```typescript
import { Bunny, HttpError, type Context } from "jsr:@bunny/bunny";
import routes from "./src/routes.ts";
import middlewares from "./src/middlewars.ts";
import apis from "./src/apis.ts";

const app = new Bunny();
const dir = import.meta.dir!;

app.static("/assets", dir + "/assets");
app.engine(dir + "/templates", { appName: "Bunny", year: 2026 });

app.route("/", middlewares);
app.route("/", routes);
app.route("/v1", apis);

app.error("error.html", async (e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
```

### src/routes.ts

```typescript
import { Bunny, type Context } from "jsr:@bunny/bunny";

const routes = new Bunny();

routes.get("/", async (c) => c.text("Hello from Bunny!"));
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

### src/middlewars.ts

```typescript
import { Bunny, type Context } from "jsr:@bunny/bunny";

const app = new Bunny();

app.use("/*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${ms}ms`);
});

export default app;
```

---

## API 一览

### Bunny 实例方法

| 方法 | 说明 |
|---|---|
| `get(path, handler)` | GET 路由 |
| `get(path, template, handler)` | GET 路由 + 模板 |
| `post` / `put` / `delete` / `patch` / `options` / `head` | 同 get |
| `use(pattern, handler)` | 中间件 |
| `error(handler)` | 错误处理器 |
| `error(template, handler)` | 错误处理器 + 模板 |
| `route(prefix, sub)` | 挂载子路由 |
| `static(webPath, localPath)` | 静态文件 |
| `engine(tmplRoot, globalVars?)` | 模板引擎配置 |

### Context 方法

| 方法 | 说明 |
|---|---|
| `text(str)` | 返回纯文本 |
| `json(obj)` | 返回 JSON |
| `html(str)` | 返回 HTML |
| `status(code)` | 设置状态码 |
| `header(name, value)` | 设置响应头 |

### Context 属性

| 属性 | 说明 |
|---|---|
| `c.req` | 原始 Request 对象 |
| `c.params` | 路径参数字典 |

---

## 开发

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run server.ts

# 构建检查
bun build bunny.ts --check
```

---

## 发布到 JSR

```bash
# 安装 jsr CLI
bunx jsr init

# 发布
bunx jsr publish
```

更多信息请访问 [jsr.io](https://jsr.io)。
