import { Bunny, type Context } from "../../bunny";

const api = new Bunny();

api.get("/api/users", async (c: Context) =>
    c.json([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
    ])
);

api.get("/api/users/:id", async (c: Context) =>
    c.json({ id: +c.params.id, name: "User " + c.params.id })
);

api.post("/api/users", async (c: Context) => {
    const body = await c.req.json();
    c.status(201);
    c.header("Location", "/api/users/" + Date.now());
    return c.json({ ...body, id: Date.now() });
});

api.put("/api/users/:id", async (c: Context) => {
    const body = await c.req.json();
    return c.json({ id: +c.params.id, ...body });
});

api.delete("/api/users/:id", async (c: Context) =>
    c.json({ id: +c.params.id, deleted: true })
);

export default api;
