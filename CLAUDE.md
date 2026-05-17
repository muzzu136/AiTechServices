# Company App — Engineering Agent Guide

This is a Cloudflare Worker app deployed on Launchyard. You edit code, commit, push, then call `deploy_app` to deploy.

## Architecture

- **Runtime:** Cloudflare Workers (Hono framework)
- **HTML pages:** Worker routes in `worker/src/index.ts` (e.g. `app.get("/", c => c.html(...))`). The home page is a route, not a static file.
- **API routes:** Same place — `app.get("/api/...")` etc. in `worker/src/index.ts`.
- **Static assets:** `worker/site/` is for CSS, images, favicons, `robots.txt` — served automatically at exact path (e.g. `site/styles.css` → `/styles.css`). **Don't put HTML here** (see precedence trap below).
- **Database:** Cloudflare D1 (SQLite-compatible SQL) via `c.env.DB`
- **Object storage:** Cloudflare R2 via `c.env.FILES_BUCKET`
- **Visitor analytics:** `c.env.ANALYTICS` (always available)
- **No ASSETS binding:** You cannot read files from `site/` inside a Hono handler — there is no `c.env.ASSETS` in this platform runtime.

### Precedence: static assets win over Worker routes

If a file in `site/` exact-matches a request path, the static file is served and the matching Worker route never runs. This is silent — the deploy succeeds, the healthcheck passes, but the Worker route you wrote is dead.

Practical rules:
- Put HTML pages as Worker routes, not as files in `site/`.
- If you ever need a static HTML file (e.g. a vendor verification page), pick a path that no Worker route also handles.
- If a route you wrote isn't taking effect on the live site, check whether `site/` contains a file at that exact path.

## Deployment Manifest (`worker/launchyard.manifest.json`)

This file tells the platform how to deploy your worker. **All platform resource provisioning is controlled by this file.**

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | `1` | Yes | Always `1` |
| `runtime` | `"cloudflare_worker"` | Yes | Always `"cloudflare_worker"` |
| `entrypoint` | string | Yes | Worker entry point relative to `worker/` (e.g. `"src/index.ts"`) |
| `assets_dir` | string | No | Static assets directory (e.g. `"./site"`) |
| `healthcheck_path` | string | Yes | Path the platform GETs after deploy. Must start with `/`. Return status < 400. |
| `requested_capabilities` | object | No | Platform resources to provision (see below) |
| `requested_env` | string[] | No | Informational list of expected env vars (not enforced) |

### `requested_capabilities`

This is where you request platform-managed resources. **These must be nested inside `requested_capabilities` — NOT as top-level keys.**

```json
{
  "requested_capabilities": {
    "db": "required",
    "object_storage": "required"
  }
}
```

| Key | Value | What it provisions | Binding name |
|---|---|---|---|
| `"db"` | `"required"` | Cloudflare D1 database | `DB` (typed as `D1Database`) |
| `"object_storage"` | `"required"` | Cloudflare R2 bucket | `FILES_BUCKET` (typed as `R2Bucket`) |
| `"ai"` | `"required"` | Cloudflare Workers AI | `AI` (typed as `Ai`) |

**WRONG** (will NOT work):
```json
{
  "db": "required",
  "object_storage": "required"
}
```

**CORRECT:**
```json
{
  "requested_capabilities": {
    "db": "required",
    "object_storage": "required"
  }
}
```

### Forbidden keys

Never put these in the manifest — they are platform-controlled:
`worker_name`, `account_id`, `bindings`, `secret_values`, `secret_names`, `bucket_names`, `db_identifiers`, `custom_routes`, `zone_ids`, `deployment_target_urls`

## Available Bindings

Always available (no configuration needed):

| Binding | Type | Description |
|---|---|---|
| `COMPANY_ID` | `string` | Company's unique ID |
| `APP_BASE_URL` | `string` | Public URL (e.g. `https://myapp.launchyard.app`) |
| `ANALYTICS` | `AnalyticsEngineDataset` | Visitor tracking dataset |

Opt-in via `requested_capabilities`:

| Binding | Type | Capability | Description |
|---|---|---|---|
| `DB` | `D1Database` | `"db": "required"` | SQL database (SQLite-compatible). Create tables, run queries. |
| `FILES_BUCKET` | `R2Bucket` | `"object_storage": "required"` | Object storage. Upload/download files. |
| `AI` | `Ai` | `"ai": "required"` | Cloudflare Workers AI. Run text generation, embeddings, image models, etc. (e.g. `await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", { prompt: "..." })`) |

## How Deployment Works

1. You edit code, commit, and push to `main`
2. You call `deploy_app` (no arguments needed)
3. The platform reads `worker/launchyard.manifest.json`
4. The platform generates its own wrangler config — **your `wrangler.toml` is only used for local dev** (`wrangler dev`). In production, the platform ignores it except for `compatibility_date`.
5. The platform provisions any requested resources (D1 database, R2 bucket)
6. The platform runs `npm ci` and `npx wrangler deploy` with the generated config
7. The platform wires all bindings (DB, FILES_BUCKET, ANALYTICS, COMPANY_ID, APP_BASE_URL) automatically
8. The platform runs a health check against `healthcheck_path`
9. If the health check passes, the deploy succeeds and the site is live

**Do NOT:**
- Add `d1_databases`, `r2_buckets`, or other binding sections to `wrangler.toml` for production. The platform handles this.
- Put secrets or credentials in `wrangler.toml` or the manifest
- Modify the `name` field in `wrangler.toml` (it's overridden by the platform)
- **Modify or remove the `_hashIP` function or the `/api/_ping` handler.** These are platform-managed analytics infrastructure. The platform depends on the exact data format written to `ANALYTICS`. Changing the blob order, hash format, or removing the handler will break visitor tracking on the founder dashboard.

**Do:**
- Keep `wrangler.toml` for local development only
- Use `requested_capabilities` in the manifest to declare what you need
- Always include a working health check endpoint
- Do **not** add your own `<script>navigator.sendBeacon("/api/_ping")</script>` tag — the Launchyard platform automatically injects an enriched beacon into every HTML response before it reaches the visitor. Adding a second beacon just double-writes every page view and inflates the raw row count in analytics.

## D1 Database Usage

Create tables on first request (idempotent):
```ts
await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`).run();
```

Query:
```ts
const { results } = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).all();
```

Batch writes:
```ts
await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO items (name) VALUES (?)").bind("foo"),
  c.env.DB.prepare("INSERT INTO items (name) VALUES (?)").bind("bar"),
]);
```

## R2 Storage Usage

Upload:
```ts
await c.env.FILES_BUCKET.put("uploads/photo.jpg", imageBytes);
```

Download:
```ts
const obj = await c.env.FILES_BUCKET.get("uploads/photo.jpg");
if (obj) return new Response(obj.body, { headers: { "Content-Type": "image/jpeg" } });
```

List:
```ts
const listed = await c.env.FILES_BUCKET.list({ prefix: "uploads/" });
```

## Common Patterns

### Serving HTML pages
HTML pages are Worker routes — same place as your API routes, in `worker/src/index.ts`:

```ts
app.get("/about", (c) => {
  return c.html(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>About</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <h1>About</h1>
    </body>
  </html>`);
});
```

This works for the home page (`/`), clean URLs (`/about`, `/pricing`), dynamic routes (`/p/:slug`), SEO pages, and SPA fallbacks. There is no `c.env.ASSETS` binding inside handlers — you cannot fetch a static `index.html` from Worker code.

### Linking to static assets
Reference files in `site/` by their public path. `site/styles.css` becomes `/styles.css`, `site/logo.png` becomes `/logo.png`. Don't try to read these files from inside a handler.

### Don't put HTML in site/
The `[assets]` binding serves static files **before** the Worker fetch handler runs. A `site/about.html` file will silently shadow any `app.get("/about.html", ...)` route at the same path. The deploy will still succeed, the healthcheck will still pass, and the Worker route will simply never fire. Keep HTML in routes; keep `site/` for CSS, images, favicons, and `robots.txt`.

## Selling things (Stripe)

LaunchYard handles all payments for you. **Do NOT integrate Stripe directly in this worker.** The seller creates products from their LaunchYard dashboard, then you wire up "Buy" links pointing at LaunchYard's hosted checkout.

### Buy button pattern

Once a product exists, link to it like this:

```html
<a href="https://api.launchyard.dev/v1/public/checkout/{product_id}?return_to=https://{your-app-domain}/thanks">
  Buy now
</a>
```

The link redirects the visitor to Stripe's hosted checkout. After payment, Stripe redirects to `return_to` (your success page). LaunchYard records the sale, holds funds for 14 days, then pays the seller out (minus a 20% platform fee) to their connected payout account.

### What you should NOT do

- Do not collect card details in your worker — payments go through LaunchYard.
- Do not call the Stripe API directly — there's no Stripe key wired into your worker, by design.
- Do not store buyer payment data — LaunchYard's checkout handles all of that.
- Do not implement your own checkout flow — `?return_to=` on the LaunchYard buy link covers redirects after a successful sale.

### Where products come from

The seller creates products through their LaunchYard dashboard at `launchyard.dev/dashboard`. Each product has a stable `product_id` you reference in buy buttons. If the seller hasn't created any products yet, ask them to create one before you wire up buy buttons.

## Looking Up Documentation

You have access to a real browser via the `browse` CLI. **If you are unsure about any API, syntax, or behavior, look it up instead of guessing.** Wrong guesses waste turns debugging.

Key documentation sites:
- **D1 (database):** `https://developers.cloudflare.com/d1/`
- **R2 (object storage):** `https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`
- **Workers runtime:** `https://developers.cloudflare.com/workers/`
- **Hono framework:** `https://hono.dev/docs/`
- **Workers TypeScript types:** `https://developers.cloudflare.com/workers/languages/typescript/`

To look something up:
```bash
browse open https://developers.cloudflare.com/d1/worker-api/
browse snapshot -c
# read the docs, then close
browse stop
```

Do this whenever you need to use a D1/R2/Hono/Workers API you haven't used before in this session. The cost of a few browse commands is much less than the cost of debugging a wrong guess.
