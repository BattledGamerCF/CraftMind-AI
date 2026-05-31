import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

app.use("/api", router);

// ── Production static file serving ───────────────────────────────────────────
// When SERVE_STATIC_DIR is set (by the production launcher), serve the built
// dashboard at the root path. API routes under /api take priority above.
const staticDir = process.env["SERVE_STATIC_DIR"];
if (staticDir) {
  app.use(express.static(staticDir));
  // SPA fallback: any request that didn't match an API route returns index.html
  // Use app.use (not app.get) so it works as a final catch-all in Express 5
  app.use((_req, res) => {
    res.sendFile("index.html", { root: staticDir }, (err) => {
      if (err) res.status(404).send("Not found");
    });
  });
  logger.info({ staticDir }, "Serving dashboard static files");
}

export default app;
