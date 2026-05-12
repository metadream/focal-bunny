import { Bunny, HttpError, type Context } from "../bunny";
import routes from "./src/routes";
import middlewares from "./src/middlewars";
import apis from "./src/apis";

const app = new Bunny();
const dir = import.meta.dir!;

app.static("/assets", dir + "/assets");
app.engine(dir + "/tmpl", { appName: "Bunny", year: 2026 });

app.get("/direct", async (c: Context) => c.text("direct call works"));

app.route("/", middlewares);
app.route("/", routes);
app.route("/v1", apis);

app.error("error.html", async (e: any, c: Context) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
