import { Bunny, HttpError, type Context } from "../bunny";
import routes from "./src/routes";
import timer from "./src/middlewars";
import auth from "./src/auth";
import apis from "./src/apis";

const app = new Bunny();
const dir = import.meta.dir!;

app.static("/assets", dir + "/assets");
app.engine(dir + "/tmpl", { appName: "Bunny", year: 2026 });

app.use(timer);
app.use("/protected/*", auth);

app.get("/protected/dashboard", async (c: Context) => c.text("dashboard"));
app.get("/direct", async (c: Context) => c.text("direct call works"));

app.route("/", routes);
app.route("/v1", apis);

app.error("error.html", async (e: any, c: Context) => {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, message: e.message || "Internal Server Error" };
});

export default app;
