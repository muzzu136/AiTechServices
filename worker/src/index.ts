import { Hono } from "hono";
import { cors } from "hono/cors";

// ─── App Setup ───────────────────────────────────────────────────────────────
//
// This is a Cloudflare Worker powered by Hono.
//
// HTML pages live as routes in this file (see app.get("/", ...) below).
// Static assets — CSS, images, favicons, robots.txt — live in worker/site/
// and are served automatically at their exact path (e.g. site/styles.css
// → /styles.css). There is no ASSETS binding inside the handler runtime.
//
// IMPORTANT: if a file in site/ exact-matches a request path, the static
// file wins and the matching Worker route never runs. Don't put HTML in
// site/ for any path you also handle here — keep HTML in routes, keep
// site/ for true static assets only.
//
// Bindings available (see launchyard.manifest.json to request more):
//   COMPANY_ID        — your company's unique ID
//   PUBLIC_SUBDOMAIN  — your *.launchyard.app subdomain
//   ANALYTICS         — visitor tracking (auto-configured)
//   DB                — D1 database (if requested in manifest)
//   FILES_BUCKET      — R2 object storage (if requested in manifest)

type Bindings = {
  COMPANY_ID: string;
  PUBLIC_SUBDOMAIN: string;
  ANALYTICS: AnalyticsEngineDataset;
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// ─── Health Check ────────────────────────────────────────────────────────────
// Used by the platform to verify the worker is running after deploy.

app.get("/api/healthz", (c) => c.json({ status: "ok" }));

// ─── Home page ───────────────────────────────────────────────────────────────
// Replace this with the real landing page when you build the site.
// Static assets (CSS, images, favicons) live in worker/site/ — this route
// links to /styles.css, which is served from worker/site/styles.css.

app.get("/", (c) =>
  c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New Business</title>
  <meta name="description" content="New Business is built with Company Builder." />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <nav class="nav">
    <a href="/" class="logo">New Business</a>
  </nav>

  <main class="page">
    <section class="hero">
      <h1 class="hero-title">New Business</h1>
      <p class="hero-subtitle">New Business is built with Company Builder.</p>
    </section>
  </main>

  <footer class="footer">
    Made with &#10084;&#65039; using <a href="https://launchyard.dev">Launchyard</a>
  </footer>
</body>
</html>`),
);

// ─── Platform Analytics (DO NOT MODIFY) ─────────────────────────────────────
// Records visitor data for the founder dashboard. The platform depends on this
// exact data format. Every HTML page must also include:
//   <script>navigator.sendBeacon("/api/_ping");</script>
// just before </body>.

function _hashIP(ip: string): string {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return "v1:" + (h >>> 0).toString(36);
}

app.post("/api/_ping", async (c) => {
  try {
    const ipHash = _hashIP(c.req.header("cf-connecting-ip") || "unknown");
    const ua = c.req.header("user-agent") || "";
    // The dispatch worker injects a beacon that POSTs JSON {cid, r, p, h}
    // where `r` is document.referrer — the actual external entry source.
    // Fall back to the HTTP Referer header for cached HTML still in flight
    // from before the body-payload beacon shipped.
    let referrer = "";
    try {
      const body = await c.req.json<{ r?: string }>();
      if (typeof body.r === "string") referrer = body.r;
    } catch { /* no body / not JSON */ }
    if (!referrer) referrer = c.req.header("referer") || "";
    c.env.ANALYTICS.writeDataPoint({
      indexes: [c.env.COMPANY_ID],
      blobs: [ipHash, referrer, ua],
      doubles: [1],
    });
  } catch { /* analytics is best-effort */ }
  return c.body(null, 204);
});

// ─── Your API Routes ─────────────────────────────────────────────────────────
//
// Add backend routes below. Examples:
//
//   // GET endpoint
//   app.get("/api/posts", async (c) => {
//     const results = await c.env.DB.prepare("SELECT * FROM posts").all();
//     return c.json(results);
//   });
//
//   // POST endpoint
//   app.post("/api/contact", async (c) => {
//     const { name, email, message } = await c.req.json();
//     await c.env.DB.prepare("INSERT INTO messages (name, email, message) VALUES (?, ?, ?)")
//       .bind(name, email, message).run();
//     return c.json({ ok: true });
//   });
//
//   // File upload
//   app.post("/api/upload", async (c) => {
//     const body = await c.req.blob();
//     const key = `uploads/${Date.now()}`;
//     await c.env.FILES_BUCKET.put(key, body);
//     return c.json({ key });
//   });
//
// Call from the frontend: fetch("/api/contact", { method: "POST", body: JSON.stringify({...}) })

export default app;
