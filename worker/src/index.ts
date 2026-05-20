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
  LAUNCHYARD_API_BASE_URL: string;
  LAUNCHYARD_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// ─── Health Check ────────────────────────────────────────────────────────────
// Used by the platform to verify the worker is running after deploy.

app.get("/api/healthz", (c) => c.json({ status: "ok" }));

// ─── Initialize Database ─────────────────────────────────────────────────────

async function initializeDatabase(db: D1Database) {
  try {
    await db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        business_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        interest TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
      )
      .run();
  } catch (e) {
    // Table might already exist
    console.error("Database init error:", e);
  }
}

// ─── Contact Form API ────────────────────────────────────────────────────────

app.post("/api/contact", async (c) => {
  try {
    const { name, business_name, email, phone, interest } = await c.req.json();

    // Validation
    if (!name || !business_name || !email || !phone || !interest) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Generate a simple ID
    const id =
      "lead_" +
      Date.now() +
      "_" +
      Math.random().toString(36).substring(2, 9);
    const created_at = new Date().toISOString();

    // Insert into database
    await initializeDatabase(c.env.DB);
    const result = await c.env.DB.prepare(
      `
      INSERT INTO leads (id, name, business_name, email, phone, interest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(id, name, business_name, email, phone, interest, created_at)
      .run();

    // Send email notification to founder
    const emailBody =
      `New lead submitted on VoiceForge AI:\n\n` +
      `Name:          ${name}\n` +
      `Business Name: ${business_name}\n` +
      `Email:         ${email}\n` +
      `Phone:         ${phone}\n` +
      `Interest:      ${interest}\n\n` +
      `Submitted at: ${created_at}`;

    await fetch(
      `${c.env.LAUNCHYARD_API_BASE_URL}/v1/public/companies/${c.env.COMPANY_ID}/emails`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.LAUNCHYARD_API_KEY}`,
        },
        body: JSON.stringify({
          to: "skillsuccess9@gmail.com",
          subject: `New lead: ${business_name} — ${interest}`,
          body: emailBody,
        }),
      }
    );

    return c.json({ success: true, id }, 200);
  } catch (e) {
    console.error("Contact form error:", e);
    return c.json({ error: "Failed to submit form" }, 500);
  }
});

// ─── Home page ───────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VoiceForge AI - AI Receptionists & Websites for Local Businesses</title>
  <meta name="description" content="AI Voice Agents that answer calls 24/7 and professional websites built in 5 days. Starting from $299/mo." />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <nav class="nav">
    <a href="/" class="logo">VoiceForge AI</a>
  </nav>

  <main>
    <!-- HERO SECTION -->
    <section id="hero" class="hero">
      <div class="hero-content">
        <h1 class="hero-title">Never Miss a Call Again</h1>
        <p class="hero-subtitle">AI Voice Agents that answer calls, book appointments & handle FAQs 24/7. Professional websites built in 5 days. Everything your local business needs.</p>
        <div class="hero-ctas">
          <a href="#services" class="btn btn-primary">Get an AI Voice Agent</a>
          <a href="#services" class="btn btn-secondary">Build My Website</a>
        </div>
      </div>
    </section>

    <!-- PAIN POINTS SECTION -->
    <section id="pain-points" class="pain-points">
      <h2 class="section-title">The Problem Most Local Businesses Face</h2>
      <div class="pain-grid">
        <div class="pain-card">
          <div class="pain-icon">📞</div>
          <h3>Missed Calls = Lost Revenue</h3>
          <p>Every unanswered call is a customer walking to your competitor. You can't answer 100+ calls a day, and your voicemail isn't closing deals.</p>
        </div>
        <div class="pain-card">
          <div class="pain-icon">👻</div>
          <h3>No Website = Invisible</h3>
          <p>Customers search for businesses online first. Without a professional website, you're losing customers before they ever call.</p>
        </div>
        <div class="pain-card">
          <div class="pain-icon">💸</div>
          <h3>Hiring Staff is Expensive</h3>
          <p>A receptionist costs $30K–50K/year. An AI agent costs $299/month and never takes a day off.</p>
        </div>
      </div>
    </section>

    <!-- SERVICES SECTION -->
    <section id="services" class="services">
      <h2 class="section-title">Our Services</h2>
      <div class="services-grid">
        <!-- AI Voice Agents -->
        <div class="service-card">
          <div class="service-header">
            <h3 class="service-title">AI Voice Agents</h3>
            <p class="service-price">Starting from <span class="price">$299/mo</span></p>
          </div>
          <ul class="service-features">
            <li>✓ Answers calls 24/7, even on weekends</li>
            <li>✓ Books appointments automatically</li>
            <li>✓ Handles FAQs and common questions</li>
            <li>✓ Routes urgent calls to you</li>
            <li>✓ Custom voice & personality</li>
            <li>✓ Live in just 48 hours</li>
          </ul>
          <p class="service-desc">Your personal AI receptionist. Never miss another lead.</p>
        </div>

        <!-- Website Builds -->
        <div class="service-card">
          <div class="service-header">
            <h3 class="service-title">Website Builds</h3>
            <p class="service-price">Starting from <span class="price">$799</span></p>
          </div>
          <ul class="service-features">
            <li>✓ Professional, modern design</li>
            <li>✓ Mobile-optimized (100% responsive)</li>
            <li>✓ SEO-ready and fast</li>
            <li>✓ Contact forms & CTA buttons</li>
            <li>✓ Your own domain (included)</li>
            <li>✓ Live in 5 business days</li>
          </ul>
          <p class="service-desc">Show up online. Get found by customers.</p>
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS SECTION -->
    <section id="how-it-works" class="how-it-works">
      <h2 class="section-title">How It Works</h2>
      <div class="steps-grid">
        <div class="step">
          <div class="step-number">1</div>
          <h3>Tell Us About Your Business</h3>
          <p>Fill out a quick form. We learn about your industry, goals, and what's holding you back.</p>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <h3>We Build Your AI Agent or Site</h3>
          <p>Our team builds & customizes everything for you. We handle all the technical work.</p>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <h3>Go Live in Days</h3>
          <p>Your AI agent answers your first call or your website goes live — fully live and ready to work.</p>
        </div>
      </div>
    </section>

    <!-- TESTIMONIALS SECTION -->
    <section id="testimonials" class="testimonials">
      <h2 class="section-title">What Our Clients Say</h2>
      <p class="testimonials-subtitle"><em>Fictional testimonials for illustration</em></p>
      <div class="testimonials-grid">
        <div class="testimonial-card">
          <div class="quote-mark">"</div>
          <p class="testimonial-text">We stopped missing calls on weekends. The AI booked 12 new appointments in the first week alone. It's like hiring a receptionist for a fraction of the cost.</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar"></div>
            <div>
              <p class="author-name">Maria S.</p>
              <p class="author-role">Salon Owner</p>
            </div>
          </div>
        </div>

        <div class="testimonial-card">
          <div class="quote-mark">"</div>
          <p class="testimonial-text">We had no online presence. Five days later, we had a beautiful website and started getting calls from customers finding us on Google. Best investment we made.</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar"></div>
            <div>
              <p class="author-name">James L.</p>
              <p class="author-role">HVAC Contractor</p>
            </div>
          </div>
        </div>

        <div class="testimonial-card">
          <div class="quote-mark">"</div>
          <p class="testimonial-text">The whole setup was painless. The team explained everything, customized our AI agent to match our voice, and had it running the next day. Highly recommend.</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar"></div>
            <div>
              <p class="author-name">Priya M.</p>
              <p class="author-role">Dental Practice Manager</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- PRICING SECTION -->
    <section id="pricing" class="pricing">
      <h2 class="section-title">Simple, Transparent Pricing</h2>
      <div class="pricing-grid">
        <!-- AI Voice Agent -->
        <div class="pricing-card">
          <h3 class="pricing-title">AI Voice Agent</h3>
          <div class="pricing-amount">
            <span class="price-setup">\$499</span>
            <span class="price-label">setup</span>
          </div>
          <p class="pricing-recur">\$299/month thereafter</p>
          <ul class="pricing-features">
            <li>✓ 24/7 call answering</li>
            <li>✓ Appointment booking</li>
            <li>✓ FAQ handling</li>
            <li>✓ Lead routing</li>
            <li>✓ Call recordings & analytics</li>
            <li>✓ 48-hour setup</li>
          </ul>
        </div>

        <!-- Website Build -->
        <div class="pricing-card">
          <h3 class="pricing-title">Website Build</h3>
          <div class="pricing-amount">
            <span class="price-setup">\$999</span>
            <span class="price-label">one-time</span>
          </div>
          <p class="pricing-recur">No monthly fees</p>
          <ul class="pricing-features">
            <li>✓ Professional design</li>
            <li>✓ Mobile-responsive</li>
            <li>✓ SEO optimized</li>
            <li>✓ Contact forms</li>
            <li>✓ Your custom domain</li>
            <li>✓ 5-day turnaround</li>
          </ul>
        </div>

        <!-- Bundle -->
        <div class="pricing-card pricing-card-featured">
          <div class="badge">Most Popular</div>
          <h3 class="pricing-title">Website + Voice Agent</h3>
          <div class="pricing-amount">
            <span class="price-setup">\$1,199</span>
            <span class="price-label">setup</span>
          </div>
          <p class="pricing-recur">\$249/month thereafter</p>
          <ul class="pricing-features">
            <li>✓ Professional website</li>
            <li>✓ AI voice agent</li>
            <li>✓ Custom domain</li>
            <li>✓ Everything above</li>
            <li>✓ \$199 savings</li>
            <li>✓ Complete solution</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- CONTACT FORM SECTION -->
    <section id="contact" class="contact">
      <h2 class="section-title">Let's Get Started</h2>
      <p class="contact-subtitle">Fill out the form below and we'll reach out within 24 hours to discuss your needs.</p>
      
      <form id="contactForm" class="contact-form">
        <div class="form-group">
          <label for="name">Your Name *</label>
          <input type="text" id="name" name="name" required placeholder="John Smith" />
        </div>

        <div class="form-group">
          <label for="business_name">Business Name *</label>
          <input type="text" id="business_name" name="business_name" required placeholder="ABC Plumbing" />
        </div>

        <div class="form-group">
          <label for="email">Email *</label>
          <input type="email" id="email" name="email" required placeholder="john@example.com" />
        </div>

        <div class="form-group">
          <label for="phone">Phone *</label>
          <input type="tel" id="phone" name="phone" required placeholder="(555) 123-4567" />
        </div>

        <div class="form-group">
          <label for="interest">I'm Interested In *</label>
          <select id="interest" name="interest" required>
            <option value="">— Select an option —</option>
            <option value="voice_agent">AI Voice Agent</option>
            <option value="website">Website Build</option>
            <option value="both">Both (Bundle)</option>
          </select>
        </div>

        <button type="submit" class="btn btn-primary btn-full">Let's Talk</button>
        <div id="formMessage" class="form-message"></div>
      </form>
    </section>
  </main>

  <footer class="footer">
    Made with ❤️ using <a href="https://launchyard.dev">Launchyard</a>
  </footer>

  <script>
    // Contact form submission
    const form = document.getElementById('contactForm');
    const formMessage = document.getElementById('formMessage');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('name').value;
      const business_name = document.getElementById('business_name').value;
      const email = document.getElementById('email').value;
      const phone = document.getElementById('phone').value;
      const interest = document.getElementById('interest').value;

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, business_name, email, phone, interest })
        });

        if (response.ok) {
          formMessage.textContent = '✓ Thanks! We'll reach out within 24 hours.';
          formMessage.className = 'form-message success';
          form.reset();
        } else {
          formMessage.textContent = '✗ Something went wrong. Please try again.';
          formMessage.className = 'form-message error';
        }
      } catch (err) {
        formMessage.textContent = '✗ Network error. Please try again.';
        formMessage.className = 'form-message error';
      }
    });

    // Smooth scroll behavior for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && document.querySelector(href)) {
          e.preventDefault();
          document.querySelector(href).scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // Progressive-enhancement scroll animations
    // Sections are visible by default (opacity:1). Only add the hidden state
    // once we know JS + IntersectionObserver are available, so they can be
    // revealed as the user scrolls.
    if ('IntersectionObserver' in window) {
      const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in');
            observer.unobserve(entry.target);
          }
        });
      }, observerOptions);

      document.querySelectorAll('section').forEach(el => {
        el.classList.add('js-reveal');
        observer.observe(el);
      });
    }
  </script>

  <script>navigator.sendBeacon("/api/_ping");</script>
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
