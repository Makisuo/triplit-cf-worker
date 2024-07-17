import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
	return c.text("I lub Lubby!");
});

export default app;
