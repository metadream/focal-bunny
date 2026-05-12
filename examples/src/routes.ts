import { Bunny, HttpError, type Context } from "../../bunny";

const routes = new Bunny();

routes.get("/", async (c: Context) => c.text("Hello from Bunny!"));
routes.get("/json", async (c: Context) => c.json({ message: "Hello from Bunny!", timestamp: Date.now() }));
routes.get("/hello", "hello.html", async (c: Context) => ({ name: "Visitor" }));
routes.get("/users", "users.html", async (c: Context) => ({
    users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
    ],
}));
routes.get("/users/:id", async (c: Context) => c.json({ id: +c.params.id, name: "User " + c.params.id }));
routes.get("/headers", async (c: Context) => c.json(Object.fromEntries(c.req.headers)));

routes.get("/custom", async (c: Context) => {
    c.status(201);
    c.header("X-Custom", "yes");
    c.header("X-Version", "1.0");
    return c.text("created");
});

routes.post("/data", async (c: Context) => {
    const body = await c.req.json();
    c.status(201);
    return c.json({ received: body });
});

routes.put("/data/:id", async (c: Context) => {
    const body = await c.req.json();
    return c.json({ id: +c.params.id, updated: body });
});

routes.delete("/data/:id", async (c: Context) =>
    c.json({ id: +c.params.id, deleted: true })
);

routes.patch("/data/:id", async (c: Context) => {
    const body = await c.req.json();
    return c.json({ id: +c.params.id, patched: body });
});

routes.get("/protected/profile", async (c: Context) =>
    c.json({ user: "admin", role: "admin", message: "this is protected" })
);

routes.get("/error", async (c: Context) => {
    throw new HttpError(400, "This is a bad request");
});

routes.get("/crash", async (c: Context) => {
    throw new Error("Something went wrong");
});

export default routes;
