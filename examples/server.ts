import { Bunny, HttpError, type Context } from "../bunny";

const app = new Bunny();
const dir = import.meta.dir!;

app.static("/assets", dir + "/public");
app.engine(dir + "/templates", { appName: "Bunny", year: 2026 });

class AppMiddleware {
    @app.middleware("/*")
    async logger(c: Context, next: () => Promise<void>) {
        const start = Date.now();
        await next();
        console.log(`[${Date.now() - start}ms] ${new URL(c.req.url).pathname}`);
    }
}

class AppRoutes {
    @app.get("/")
    async home(c: Context) {
        return "Hello from Bunny!";
    }

    @app.get("/json")
    async json(c: Context) {
        return { message: "Hello from Bunny!", timestamp: Date.now() };
    }

    @app.get("/hello")
    @app.template("hello.html")
    async hello(c: Context) {
        return { name: "World" };
    }

    @app.get("/users/:id")
    async user(c: Context) {
        return { id: +c.params.id, name: "User " + c.params.id };
    }
}

app.get("/direct", async (c: Context) => "direct call works");

const api = new Bunny();
class ApiRoutes {
    @api.get("/api/users")
    async list(c: Context) {
        return [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
        ];
    }

    @api.get("/api/users/:id")
    async get(c: Context) {
        return { id: +c.params.id, name: "User " + c.params.id };
    }
}
api.get("/api/ping", async () => "pong");
app.route("/v1", api);

app.error("error.html")(async (e: any, c: Context) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default {
    port: 9000,
    fetch: app.fetch,
};
