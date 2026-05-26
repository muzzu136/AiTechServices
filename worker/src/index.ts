import { Hono } from "hono";
import { cors } from "hono/cors";

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

app.get("/api/healthz", (c) => c.json({ status: "ok" }));

async function initializeDatabase(db: D1Database) {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      interest TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    )`).run();
    try { await db.prepare(`ALTER TABLE leads ADD COLUMN message TEXT`).run(); } catch { /* exists */ }
  } catch (e) { console.error("DB init error:", e); }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function navHTML(active = "") {
  const link = (href: string, label: string, page: string) =>
    `<a href="${href}" class="nav-link${active === page ? " active" : ""}">${label}</a>`;
  return `
  <nav class="nav">
    <a href="/" class="logo"><img src="/attachments/media-1778601875209.png" alt="AiTechServices" /></a>
    <div class="nav-links" id="navLinks">
      ${link("/", "Home", "home")}
      ${link("/services", "Services", "services")}
      ${link("/contact", "Contact", "contact")}
    </div>
    <div class="nav-right">
      <a href="#contact" class="btn-nav-cta">Get Started</a>
      <button class="hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>`;
}

const navScript = `
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');
  hamburger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(open));
  });
`;

const revealScript = `
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fade-in'); obs.unobserve(e.target); }});
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('section').forEach(el => { el.classList.add('js-reveal'); obs.observe(el); });
  }
`;

function head(title: string, desc: string, canonical: string, ogExtra: string = "") {
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="AiTechServices" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="${canonical}" />
  ${ogExtra}<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />`;
}

function contactFormHTML(formId: string, msgId: string) {
  return `
  <form id="${formId}" class="contact-form">
    <div class="form-group"><label>Full Name *<input type="text" name="name" required placeholder="John Smith" /></label></div>
    <div class="form-group"><label>Business Name *<input type="text" name="business_name" required placeholder="ABC Plumbing" /></label></div>
    <div class="form-group"><label>Email Address *<input type="email" name="email" required placeholder="john@example.com" /></label></div>
    <div class="form-group"><label>Phone Number *<input type="tel" name="phone" required placeholder="(555) 123-4567" /></label></div>
    <div class="form-group"><label>Service Interest *
      <select name="interest" required>
        <option value="">— Select an option —</option>
        <option value="AI Voice Agent">AI Voice Agent</option>
        <option value="Website Build">Website Build</option>
        <option value="Both">Both</option>
      </select>
    </label></div>
    <div class="form-group"><label>Message (optional)<textarea name="message" rows="4" placeholder="Tell us a bit about your business and what you need…"></textarea></label></div>
    <button type="submit" class="btn btn-primary btn-full">Send Message</button>
    <div id="${msgId}" class="form-message"></div>
  </form>`;
}

function contactFormScript(formId: string, msgId: string) {
  return `(function(){
    const form = document.getElementById('${formId}');
    const msg  = document.getElementById('${msgId}');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = { name: fd.get('name'), business_name: fd.get('business_name'), email: fd.get('email'), phone: fd.get('phone'), interest: fd.get('interest'), message: fd.get('message') };
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) {
          msg.textContent = '\u2713 Thanks! We\u2019ll reach out within a few hours.';
          msg.className = 'form-message success';
          form.reset();
        } else {
          msg.textContent = '\u2717 Something went wrong. Please try again.';
          msg.className = 'form-message error';
        }
      } catch {
        msg.textContent = '\u2717 Network error. Please try again.';
        msg.className = 'form-message error';
      }
    });
  })();`;
}

function footer() { return `<footer class="footer">Made with \u2764\uFE0F using <a href="https://launchyard.dev">Launchyard</a></footer>`; }

// ─── Contact API ──────────────────────────────────────────────────────────────

app.post("/api/contact", async (c) => {
  try {
    const { name, business_name, email, phone, interest, message } = await c.req.json();
    if (!name || !business_name || !email || !phone || !interest) return c.json({ error: "Missing required fields" }, 400);
    const id = "lead_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    const created_at = new Date().toISOString();
    await initializeDatabase(c.env.DB);
    await c.env.DB.prepare(`INSERT INTO leads (id, name, business_name, email, phone, interest, message, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, name, business_name, email, phone, interest, message || "", created_at).run();
    const emailBody = `New lead on AiTechServices:\n\nName: ${name}\nBusiness: ${business_name}\nEmail: ${email}\nPhone: ${phone}\nInterest: ${interest}\n${message ? "Message: " + message + "\n" : ""}\nAt: ${created_at}`;
    await fetch(`${c.env.LAUNCHYARD_API_BASE_URL}/v1/public/companies/${c.env.COMPANY_ID}/founder-notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.env.LAUNCHYARD_API_KEY}` },
      body: JSON.stringify({ subject: `New lead: ${business_name} — ${interest}`, body: emailBody }),
    });
    return c.json({ success: true, id });
  } catch (e) {
    console.error("Contact error:", e);
    return c.json({ error: "Failed to submit" }, 500);
  }
});

// ─── Home page ────────────────────────────────────────────────────────────────

const jsonLdLocalBusiness = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"AiTechServices","description":"AI voice agents and website builds for local businesses","url":"https://www.aitechservices.tech","areaServed":"United States","serviceType":["AI Voice Agent","Website Build"]}</script>`;

app.get("/", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head("AiTechServices — AI Voice Agents & Websites for Local Businesses | Austin TX","AiTechServices builds AI voice agents and professional websites for local businesses. Never miss a call, book more appointments, and get a stunning website for $999.","https://www.aitechservices.tech/")}
${jsonLdLocalBusiness}</head>
<body>
${navHTML("home")}
<main>
<div id="hero">
<section class="hero">
  <div class="hero-content">
    <div class="hero-badge">⚡ Trusted by 200+ Local Businesses</div>
    <h1 class="hero-title">AI Voice Agents &amp; Websites for Local Businesses</h1>
    <p class="hero-subtitle">AI Voice Agents that answer calls, book appointments &amp; handle FAQs 24/7. Professional websites built in 5 days. Everything your local business needs.</p>
    <div class="hero-ctas">
      <a href="/services" class="btn btn-primary">Get an AI Voice Agent</a>
      <a href="/services" class="btn btn-secondary">Build My Website</a>
    </div>
  </div>
</section>
</div>

<section id="pain-points" class="pain-points">
  <h2 class="section-title">The Problem Most Local Businesses Face</h2>
  <div class="pain-grid">
    <div class="pain-card"><div class="pain-icon">📞</div><h3>Missed Calls = Lost Revenue</h3><p>Every unanswered call is a customer walking to your competitor. You can't answer 100+ calls a day, and your voicemail isn't closing deals.</p></div>
    <div class="pain-card"><div class="pain-icon">👻</div><h3>No Website = Invisible</h3><p>Customers search for businesses online first. Without a professional website, you're losing customers before they ever call.</p></div>
    <div class="pain-card"><div class="pain-icon">💸</div><h3>Hiring Staff is Expensive</h3><p>A receptionist costs $30K–50K/year. An AI agent costs $299/month and never takes a day off.</p></div>
  </div>
</section>

<section id="services" class="services">
  <h2 class="section-title">Our Services</h2>
  <div class="services-grid">
    <div class="service-card">
      <div class="service-header"><h3 class="service-title">AI Voice Agents</h3><p class="service-price">Starting from <span class="price">$299/mo</span></p></div>
      <ul class="service-features"><li>Answers calls 24/7, even on weekends</li><li>Books appointments automatically</li><li>Handles FAQs and common questions</li><li>Routes urgent calls to you</li><li>Custom voice &amp; personality</li><li>Live in just 48 hours</li></ul>
      <p class="service-desc">Your personal AI receptionist. Never miss another lead.</p>
    </div>
    <div class="service-card">
      <div class="service-header"><h3 class="service-title">Website Builds</h3><p class="service-price">Starting from <span class="price">$999</span></p></div>
      <ul class="service-features"><li>Professional, modern design</li><li>Mobile-optimized (100% responsive)</li><li>SEO-ready and fast</li><li>Contact forms &amp; CTA buttons</li><li>Your own domain (included)</li><li>Live in 5 business days</li></ul>
      <p class="service-desc">Show up online. Get found by customers.</p>
    </div>
  </div>
</section>

<section id="how-it-works" class="how-it-works">
  <h2 class="section-title">How It Works</h2>
  <div class="steps-grid">
    <div class="step"><div class="step-number">1</div><h3>Tell Us About Your Business</h3><p>Fill out a quick form. We learn about your industry, goals, and what's holding you back.</p></div>
    <div class="step"><div class="step-number">2</div><h3>We Build Your AI Agent or Site</h3><p>Our team builds &amp; customizes everything for you. We handle all the technical work.</p></div>
    <div class="step"><div class="step-number">3</div><h3>Go Live in Days</h3><p>Your AI agent answers your first call or your website goes live — fully live and ready to work.</p></div>
  </div>
</section>

<section id="testimonials" class="testimonials">
  <h2 class="section-title">What Our Clients Say</h2>
  <p class="testimonials-subtitle"><em>Fictional testimonials for illustration</em></p>
  <div class="testimonials-grid">
    <div class="testimonial-card"><div class="quote-mark">"</div><p class="testimonial-text">We stopped missing calls on weekends. The AI booked 12 new appointments in the first week alone.</p><div class="testimonial-author"><div class="testimonial-avatar"></div><div><p class="author-name">Maria S.</p><p class="author-role">Salon Owner</p></div></div></div>
    <div class="testimonial-card"><div class="quote-mark">"</div><p class="testimonial-text">Five days later, we had a beautiful website and started getting calls from customers finding us on Google.</p><div class="testimonial-author"><div class="testimonial-avatar"></div><div><p class="author-name">James L.</p><p class="author-role">HVAC Contractor</p></div></div></div>
    <div class="testimonial-card"><div class="quote-mark">"</div><p class="testimonial-text">The whole setup was painless. The team explained everything and had our AI running the next day.</p><div class="testimonial-author"><div class="testimonial-avatar"></div><div><p class="author-name">Priya M.</p><p class="author-role">Dental Practice Manager</p></div></div></div>
  </div>
</section>

<section id="pricing" class="pricing">
  <h2 class="section-title">Simple, Transparent Pricing</h2>
  <div class="pricing-grid">
    <div class="pricing-card"><h3 class="pricing-title">AI Voice Agent</h3><div class="pricing-amount"><span class="price-setup">$499</span><span class="price-label">setup</span></div><p class="pricing-recur">$299/month thereafter</p><ul class="pricing-features"><li>24/7 call answering</li><li>Appointment booking</li><li>FAQ handling</li><li>Lead routing</li><li>Call recordings &amp; analytics</li><li>48-hour setup</li></ul></div>
    <div class="pricing-card"><h3 class="pricing-title">Website Build</h3><div class="pricing-amount"><span class="price-setup">$999</span><span class="price-label">one-time</span></div><p class="pricing-recur">No monthly fees</p><ul class="pricing-features"><li>Professional design</li><li>Mobile-responsive</li><li>SEO optimized</li><li>Contact forms</li><li>Your custom domain</li><li>5-day turnaround</li></ul></div>
    <div class="pricing-card pricing-card-featured"><div class="badge">Most Popular</div><h3 class="pricing-title">Website + Voice Agent</h3><div class="pricing-amount"><span class="price-setup">$1,199</span><span class="price-label">setup</span></div><p class="pricing-recur">$249/month thereafter</p><ul class="pricing-features"><li>Professional website</li><li>AI voice agent</li><li>Custom domain</li><li>Everything above</li><li>$199 savings</li><li>Complete solution</li></ul></div>
  </div>
</section>

<section id="contact" class="contact">
  <h2 class="section-title">Let's Get Started</h2>
  <p class="contact-subtitle">Fill out the form below and we'll reach out within 24 hours to discuss your needs.</p>
  ${contactFormHTML("contactForm", "formMessage")}
</section>
</main>
${footer()}
<script>
${navScript}
${contactFormScript("contactForm", "formMessage")}
document.querySelectorAll('a[href^="#"]').forEach(a => { a.addEventListener('click', e => { const t=document.querySelector(a.getAttribute('href')); if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth'});} }); });
${revealScript}
</script>
</body>
</html>`));

// ─── Services page ────────────────────────────────────────────────────────────

app.get("/services", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head("AI Voice Agent & Website Build Services — AiTechServices","Explore AiTechServices' AI voice agent and website build services. Automate your calls, book more clients, and get a professional website for $999.","https://www.aitechservices.tech/services")}</head>
<body>
${navHTML("services")}
<main>

<section class="hero">
  <div class="hero-content">
    <h1 class="hero-title">AI Voice Agent &amp; Website Build Services</h1>
    <p class="hero-subtitle">AI-powered solutions built for local businesses — so you can focus on running your business while we handle the technology.</p>
  </div>
</section>

<section class="services-detail page-section-border">
  <div class="detail-badge">🎙️ Service 1</div>
  <h2 class="section-title text-left">AI Voice Agent</h2>
  <p class="section-lead">Your business, always available. Our AI voice agent answers every call, books appointments, and handles common questions — 24 hours a day, 7 days a week, 365 days a year.</p>
  <div class="detail-grid">
    <div class="detail-block">
      <h3 class="detail-heading">What It Does</h3>
      <ul class="check-list">
        <li>Answers calls 24/7 — evenings, weekends, holidays</li>
        <li>Books appointments directly into your calendar</li>
        <li>Handles FAQs so your team doesn't have to repeat themselves</li>
        <li>Routes urgent or complex calls to the right person</li>
        <li>Captures every lead so no enquiry slips through the cracks</li>
      </ul>
    </div>
    <div class="detail-block">
      <h3 class="detail-heading">Industries We Serve</h3>
      <div class="industry-tags">
        <span class="tag">✂️ Salons &amp; Spas</span>
        <span class="tag">🦷 Dental Clinics</span>
        <span class="tag">🔧 Auto Shops</span>
        <span class="tag">🏗️ Contractors &amp; Trades</span>
        <span class="tag">🍽️ Restaurants</span>
      </div>
    </div>
  </div>
  <div class="steps-block">
    <h3 class="detail-heading center-text" style="margin-bottom:2rem;">How Setup Works — 3 Simple Steps</h3>
    <div class="steps-grid">
      <div class="step"><div class="step-number">1</div><h3>We Learn Your Business</h3><p>You fill out a short form covering your services, business hours, and most common customer questions. Takes about 10 minutes.</p></div>
      <div class="step"><div class="step-number">2</div><h3>We Build &amp; Train Your Agent</h3><p>Our team configures and trains your AI voice agent to match your business personality and handle your specific scenarios. Typically 3–5 days.</p></div>
      <div class="step"><div class="step-number">3</div><h3>Forward Your Number &amp; Go Live</h3><p>Forward your existing phone number (or we set up a new one). Your AI goes live immediately — no downtime, no disruption.</p></div>
    </div>
  </div>
  <p class="price-callout center-text" style="margin-top:2rem;">Starting from <strong class="price">$299/month</strong> &nbsp;·&nbsp; One-time setup: <strong class="price">$499</strong></p>
</section>

<section class="services-detail page-section-border">
  <div class="detail-badge">🌐 Service 2</div>
  <h2 class="section-title text-left">Website Build</h2>
  <p class="section-lead">A professional website that makes your business look credible, loads fast, and gets found on Google — delivered in 5–7 business days.</p>
  <div class="detail-grid">
    <div class="detail-block">
      <h3 class="detail-heading">What's Included</h3>
      <ul class="check-list">
        <li>Custom design tailored to your brand</li>
        <li>Fully mobile-friendly — looks great on any device</li>
        <li>Contact form so leads come straight to you</li>
        <li>Google-ready SEO basics (titles, descriptions, sitemap)</li>
        <li>Fast loading — optimized for performance</li>
        <li>Hosting included for the first year</li>
      </ul>
    </div>
    <div class="detail-block">
      <h3 class="detail-heading">Design Styles</h3>
      <div class="style-cards">
        <div class="style-card"><strong>Clean &amp; Professional</strong><p>Crisp layouts, neutral tones, clear calls-to-action. Ideal for healthcare, finance, and service businesses.</p></div>
        <div class="style-card"><strong>Bold &amp; Modern</strong><p>High contrast, strong typography, vibrant accents. Perfect for contractors, auto shops, and trades.</p></div>
        <div class="style-card"><strong>Minimal &amp; Elegant</strong><p>Refined, understated, content-first. Great for salons, studios, and boutique businesses.</p></div>
      </div>
    </div>
  </div>
  <p class="price-callout center-text" style="margin-top:2rem;">One-time price: <strong class="price">$999</strong> &nbsp;·&nbsp; Delivered in 5–7 business days</p>
</section>

<section class="case-studies page-section-border">
  <h2 class="section-title">Example Client Scenarios</h2>
  <div class="case-notice">⚠️ These are example scenarios to illustrate typical results. Not real clients.</div>
  <div class="case-grid">

    <div class="case-card">
      <div class="case-service-tag">AI Voice Agent</div>
      <h3 class="case-business">Glamour Hair Studio</h3>
      <p class="case-industry">Salon</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>Missing 8–12 calls per day during busy periods. Clients hanging up and booking elsewhere.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>AI voice agent answers every call and books appointments automatically. Estimated 15+ extra bookings per month.</p></div>
      </div>
    </div>

    <div class="case-card">
      <div class="case-service-tag">Website Build</div>
      <h3 class="case-business">Peak Roofing &amp; Repairs</h3>
      <p class="case-industry">Contractor</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>No website. Losing jobs to competitors who showed up on Google when customers searched locally.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>New $999 website live in 6 days. Now ranking locally and receiving 3–5 inbound leads per week.</p></div>
      </div>
    </div>

    <div class="case-card">
      <div class="case-service-tag">AI Voice Agent</div>
      <h3 class="case-business">Bright Smile Dental</h3>
      <p class="case-industry">Dental Clinic</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>Receptionist overwhelmed with calls. Patients waiting on hold during peak hours.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>AI voice agent handles appointment bookings and FAQs. Receptionist freed up for in-person patients.</p></div>
      </div>
    </div>

  </div>
</section>

<section style="text-align:center;background:linear-gradient(180deg,rgba(0,212,255,0.06) 0%,transparent 100%);padding:5rem 2rem;">
  <h2 class="section-title">Ready to Get Started?</h2>
  <p class="hero-subtitle" style="margin-bottom:2.5rem;">Tell us about your business and we'll put together a plan — no obligation.</p>
  <a href="/contact" class="btn btn-primary" style="font-size:1.1rem;padding:1rem 2.5rem;">Get in Touch →</a>
</section>

</main>
${footer()}
<script>${navScript}${revealScript}</script>
</body>
</html>`));

// ─── Contact page ─────────────────────────────────────────────────────────────

app.get("/contact", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head("Contact AiTechServices — Get an AI Voice Agent or Website","Get in touch with AiTechServices to set up an AI voice agent for your business or get a professional website built for $999. We serve local businesses across the US.","https://www.aitechservices.tech/contact")}</head>
<body>
${navHTML("contact")}
<main>
<section class="hero" style="padding-bottom:1rem;">
  <div class="hero-content">
    <h1 class="hero-title">Contact Us — Get an AI Voice Agent or Website</h1>
    <p class="hero-subtitle">We usually respond within a few hours. Tell us about your business and we'll get back to you with a plan — no pressure, no obligation.</p>
  </div>
</section>
<section class="contact" style="padding-top:0;">
  ${contactFormHTML("contactPageForm", "contactPageMsg")}
</section>
</main>
${footer()}
<script>${navScript}${contactFormScript("contactPageForm","contactPageMsg")}${revealScript}</script>
</body>
</html>`));

// ─── Sitemap & Robots ─────────────────────────────────────────────────────────

app.get("/sitemap.xml", (c) =>
  c.text(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.aitechservices.tech/</loc><lastmod>2025-01-01</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://www.aitechservices.tech/services</loc><lastmod>2025-01-01</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>https://www.aitechservices.tech/contact</loc><lastmod>2025-01-01</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>`, 200, { "Content-Type": "application/xml" })
);

app.get("/robots.txt", (c) =>
  c.text("User-agent: *\nAllow: /\nSitemap: https://www.aitechservices.tech/sitemap.xml\n", 200, { "Content-Type": "text/plain" })
);

// ─── Analytics (DO NOT MODIFY) ────────────────────────────────────────────────

function _hashIP(ip: string): string {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return "v1:" + (h >>> 0).toString(36);
}

app.post("/api/_ping", async (c) => {
  try {
    const ipHash = _hashIP(c.req.header("cf-connecting-ip") || "unknown");
    const ua = c.req.header("user-agent") || "";
    let referrer = "";
    try { const body = await c.req.json<{ r?: string }>(); if (typeof body.r === "string") referrer = body.r; } catch { /* no body */ }
    if (!referrer) referrer = c.req.header("referer") || "";
    c.env.ANALYTICS.writeDataPoint({ indexes: [c.env.COMPANY_ID], blobs: [ipHash, referrer, ua], doubles: [1] });
  } catch { /* best-effort */ }
  return c.body(null, 204);
});

export default app;
