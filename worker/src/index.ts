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
      ${link("/blog", "Blog", "blog")}
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

function footer() { return `<footer class="footer"><div class="footer-links"><a href="/">Home</a><a href="/services">Services</a><a href="/blog">Blog</a><a href="/contact">Contact</a></div>Made with ❤️ using <a href="https://launchyard.dev">Launchyard</a></footer>`; }

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
    <div class="hero-badge">🦷 Trusted by Dental &amp; Medical Practices</div>
    <h1 class="hero-title">Every Missed Call Is a Missed Patient</h1>
    <p class="hero-subtitle">Your receptionists are overwhelmed. Patients call after hours and hit voicemail. Appointments go unconfirmed and no-shows pile up. Our AI Voice Agents answer every call, book appointments, and handle patient inquiries — 24/7, even when your practice is closed.</p>
    <div class="hero-ctas">
      <a href="/services" class="btn btn-primary">Get an AI Voice Agent</a>
      <a href="/services" class="btn btn-secondary">Build My Website</a>
    </div>
  </div>
</section>
</div>

<section id="pain-points" class="pain-points">
  <h2 class="section-title">The Challenges Every Practice Faces</h2>
  <div class="pain-grid">
    <div class="pain-card"><div class="pain-icon">🌙</div><h3>After-Hours Calls Go to Voicemail</h3><p>Patients call your practice in the evening or on weekends and reach a voicemail. Most don't leave a message — they call the next practice on the list instead.</p></div>
    <div class="pain-card"><div class="pain-icon">📞</div><h3>Receptionists Can't Keep Up</h3><p>During morning rush and peak hours, calls stack up, go on hold, or ring out unanswered. Your front desk team can only do so much — and patients notice.</p></div>
    <div class="pain-card"><div class="pain-icon">📅</div><h3>No-Shows Drain Your Schedule</h3><p>Appointments go unconfirmed because there's no time to call every patient. No-shows cost your practice thousands in lost revenue every month.</p></div>
    <div class="pain-card"><div class="pain-icon">🏃</div><h3>Patients on Hold Call a Competitor</h3><p>When a patient is put on hold, up to 60% hang up within 60 seconds. Many won't call back — they've already booked with a practice that answered.</p></div>
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
  <p class="section-lead">Built for dental and medical practices. Our AI voice agent handles after-hours patient inquiries, books appointments directly into your schedule, answers common patient FAQs, and routes urgent calls to the right staff member — so your practice never misses a patient, day or night.</p>
  <div class="detail-grid">
    <div class="detail-block">
      <h3 class="detail-heading">What It Does</h3>
      <ul class="check-list">
        <li>Books appointments directly into your practice schedule</li>
        <li>Answers patient FAQs — insurance, hours, directions, services</li>
        <li>Handles after-hours patient inquiries 24/7</li>
        <li>Routes urgent calls immediately to on-call staff</li>
        <li>Sends appointment reminders to reduce no-shows</li>
        <li>Manages call overflow during busy clinic hours</li>
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
      <div class="case-service-tag">Example Scenario</div>
      <h3 class="case-business">Bright Smile Dental Clinic</h3>
      <p class="case-industry">Dental Practice</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>Missing 15–20 patient calls per week after hours. Receptionist overwhelmed during morning rush. New patients calling competitors.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>AI Voice Agent handles all after-hours calls and books appointments directly into the schedule. 40% increase in new patient bookings.</p></div>
      </div>
    </div>

    <div class="case-card">
      <div class="case-service-tag">Example Scenario</div>
      <h3 class="case-business">ClearSkin Dermatology</h3>
      <p class="case-industry">Dermatology Practice</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>30% of calls during busy clinic hours going to voicemail. Patients frustrated, leaving for other practices.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>AI handles call overflow instantly, answers common patient FAQs, routes urgent cases to staff. Patient satisfaction up, zero missed calls.</p></div>
      </div>
    </div>

    <div class="case-card">
      <div class="case-service-tag">Example Scenario</div>
      <h3 class="case-business">QuickCare Urgent Care Center</h3>
      <p class="case-industry">Urgent Care</p>
      <div class="case-before-after">
        <div class="case-col"><p class="case-label before-label">Before</p><p>After-hours calls going unanswered. Patients unsure of wait times, insurance coverage, or whether to come in.</p></div>
        <div class="case-arrow">→</div>
        <div class="case-col"><p class="case-label after-label">After</p><p>AI answers after-hours calls 24/7, provides wait time estimates, handles insurance FAQs, and directs emergencies to 911. 25% reduction in unnecessary walk-ins.</p></div>
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

// ─── Blog ─────────────────────────────────────────────────────────────────────

const blogCSS = `
<style>
.blog-hero { padding: 5rem 2rem 3rem; text-align: center; }
.blog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 2rem; max-width: 1100px; margin: 0 auto; padding: 0 2rem 5rem; }
.blog-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(0,212,255,0.15); border-radius: 16px; padding: 2rem; transition: transform 0.2s, border-color 0.2s; }
.blog-card:hover { transform: translateY(-4px); border-color: rgba(0,212,255,0.4); }
.blog-card-date { font-size: 0.8rem; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
.blog-card-title { font-size: 1.2rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem; line-height: 1.4; }
.blog-card-title a { color: inherit; text-decoration: none; }
.blog-card-title a:hover { color: #00d4ff; }
.blog-card-excerpt { font-size: 0.95rem; color: rgba(255,255,255,0.6); line-height: 1.7; margin-bottom: 1.25rem; }
.blog-read-more { color: #00d4ff; font-size: 0.9rem; font-weight: 600; text-decoration: none; }
.blog-read-more:hover { text-decoration: underline; }
.article-wrap { max-width: 780px; margin: 0 auto; padding: 3rem 2rem 5rem; }
.article-meta { font-size: 0.85rem; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 1.5rem; }
.article-wrap h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; line-height: 1.25; margin-bottom: 1rem; }
.article-wrap h2 { font-size: 1.45rem; font-weight: 700; color: #00d4ff; margin-top: 2.5rem; margin-bottom: 0.9rem; }
.article-wrap p { font-size: 1.05rem; color: rgba(255,255,255,0.78); line-height: 1.8; margin-bottom: 1.2rem; }
.article-wrap ul { padding-left: 1.4rem; margin-bottom: 1.2rem; }
.article-wrap ul li { font-size: 1.05rem; color: rgba(255,255,255,0.78); line-height: 1.8; margin-bottom: 0.4rem; }
.article-wrap strong { color: #fff; }
.article-cta { margin-top: 3rem; padding: 2.5rem; background: rgba(0,212,255,0.07); border: 1px solid rgba(0,212,255,0.2); border-radius: 16px; text-align: center; }
.article-cta h3 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.75rem; }
.article-cta p { color: rgba(255,255,255,0.65); margin-bottom: 1.5rem; }
</style>`;

const blogArticles = [
  {
    slug: "ai-voice-agent-for-small-business",
    title: "How AI Voice Agents Help Local Businesses Never Miss a Call Again",
    date: "May 12, 2026",
    excerpt: "Every missed call is a missed opportunity — and most callers won't leave a voicemail. Learn how AI voice agents answer calls around the clock, book appointments automatically, and handle FAQs so your local business never loses a lead again.",
  },
  {
    slug: "small-business-website-cost-2026",
    title: "How Much Does a Small Business Website Cost in 2026?",
    date: "May 19, 2026",
    excerpt: "From DIY page builders to full-service agencies, website pricing varies wildly. Here's an honest breakdown of what local business owners actually pay in 2026 — and why $999 all-in is now a real option.",
  },
  {
    slug: "best-ai-tools-for-local-businesses-2026",
    title: "Best AI Tools for Local Businesses in 2026",
    date: "May 26, 2026",
    excerpt: "Labor costs are rising, customer expectations are higher, and bigger chains are everywhere. These are the AI tools local business owners are using in 2026 to compete, save time, and grow — without needing a tech team.",
  },
];

app.get("/blog", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head(
  "Blog — AI Tips & Resources for Local Businesses | AiTechServices",
  "Practical guides for local business owners on AI voice agents, website costs, and the best AI tools to grow your business in 2026.",
  "https://voiceforgeai.launchyard.app/blog"
)}${blogCSS}</head>
<body>
${navHTML("blog")}
<main>
<section class="blog-hero hero">
  <div class="hero-content">
    <h1 class="hero-title">AI Tips &amp; Resources for Local Businesses</h1>
    <p class="hero-subtitle">Practical guides to help you grow your business with AI — no tech background required.</p>
  </div>
</section>
<div class="blog-grid">
  ${blogArticles.map(a => `
  <article class="blog-card">
    <p class="blog-card-date">${a.date}</p>
    <h2 class="blog-card-title"><a href="/blog/${a.slug}">${a.title}</a></h2>
    <p class="blog-card-excerpt">${a.excerpt}</p>
    <a href="/blog/${a.slug}" class="blog-read-more">Read article →</a>
  </article>`).join("")}
</div>
</main>
${footer()}
<script>${navScript}${revealScript}</script>
</body>
</html>`));

app.get("/blog/ai-voice-agent-for-small-business", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head(
  "AI Voice Agent for Small Business — Never Miss a Call Again | AiTechServices",
  "Discover how an AI voice agent can answer calls, book appointments, and handle FAQs for your small business 24/7 — at a fraction of the cost of a receptionist.",
  "https://voiceforgeai.launchyard.app/blog/ai-voice-agent-for-small-business",
  `<meta property="og:type" content="article" />`
)}${blogCSS}</head>
<body>
${navHTML("blog")}
<main>
<div class="article-wrap">
  <p class="article-meta">May 12, 2026 &nbsp;·&nbsp; AI Voice Agents</p>
  <h1>How AI Voice Agents Help Local Businesses Never Miss a Call Again</h1>

  <h2>What Is an AI Voice Agent?</h2>
  <p>An AI voice agent is a software-powered phone assistant that answers incoming calls on behalf of your business — any time of day, any day of the year. It sounds natural, responds intelligently to common questions, books appointments directly into your calendar, and routes complex or urgent calls to the right person on your team.</p>
  <p>Modern AI voice agents are trained specifically for your business. You provide the details — your services, hours, FAQs, pricing — and the agent learns to represent your brand accurately. From the caller's perspective, it sounds remarkably like talking to a knowledgeable member of your team.</p>

  <h2>The Real Cost of a Missed Call</h2>
  <p>Most local service businesses underestimate how much a missed call actually costs them. Industry research consistently puts the average value of a missed call for service businesses somewhere between <strong>$100 and $500 in lost revenue</strong> — when you factor in the lifetime value of a new customer, not just a single transaction.</p>
  <p>Here's the part that stings most: the majority of callers who reach voicemail simply hang up and call the next result on Google. They don't leave a message. They don't call back. They move on. That means every unanswered ring during your lunch break, your busy hour, or your closed Sunday is potentially a customer you've lost to a competitor — permanently.</p>
  <p>For a salon that misses three bookings a day, a plumber who misses two calls while under a sink, or a dental office that's slammed on Monday mornings, the numbers add up fast.</p>

  <h2>AI Voice Agent vs. a Human Receptionist</h2>
  <p>The traditional solution to missed calls was to hire a receptionist. And while a great receptionist is invaluable, the reality for most small businesses is that it's a significant investment:</p>
  <ul>
    <li><strong>Human receptionist:</strong> $35,000–$45,000 per year in salary alone — before benefits, payroll taxes, paid time off, training, or turnover costs. They work fixed hours, take sick days, and can only handle one call at a time.</li>
    <li><strong>AI voice agent:</strong> A fraction of the annual cost. Available 24/7/365. Never calls in sick. Handles multiple calls simultaneously. No benefits, no HR headaches, no onboarding delays.</li>
  </ul>
  <p>This isn't about replacing great human staff — it's about making sure your business is covered during the hours when humans can't reasonably be available, and during busy periods when call volume exceeds capacity.</p>

  <h2>Which Industries Benefit Most?</h2>
  <p>While virtually any phone-dependent business can benefit, some industries see outsized results:</p>
  <ul>
    <li><strong>Salons &amp; spas:</strong> Stylists are often with a client when a booking call comes in. They can't answer — and the caller books elsewhere. An AI agent captures every appointment.</li>
    <li><strong>Dental clinics:</strong> Front desk staff are juggling check-ins, insurance paperwork, and in-person patients simultaneously. Calls regularly go to hold or voicemail during peak hours.</li>
    <li><strong>Auto repair shops:</strong> Technicians are on the floor with grease on their hands. The phone rings at the front, nobody picks up, the caller finds another shop.</li>
    <li><strong>General contractors:</strong> Often on-site all day. Their phone is the lifeline for new leads — but it's impossible to answer every call while managing a job site.</li>
    <li><strong>Restaurants:</strong> Staff are cooking, serving, or expediting during the dinner rush — exactly when reservation calls and takeout orders are flooding in.</li>
  </ul>
  <p>In every case, the missed call problem is the same: the business is too busy doing the work to also answer the phone. An AI voice agent solves this without adding headcount.</p>

  <h2>How Does Setup Actually Work?</h2>
  <p>One concern small business owners often have is that AI sounds complicated to set up. It's not. Here's how we do it at AiTechServices:</p>
  <ul>
    <li><strong>Step 1 — Share your business info:</strong> You fill out a short questionnaire covering your services, hours, most common questions, and how you'd like calls handled. It takes about 10 minutes.</li>
    <li><strong>Step 2 — We configure your agent:</strong> Our team trains and configures the AI voice agent to match your specific business. This typically takes 3–5 business days.</li>
    <li><strong>Step 3 — Go live:</strong> You forward your existing business number to your new AI agent (or we set up a fresh number). It goes live immediately with zero downtime.</li>
  </ul>
  <p>No technical knowledge required on your end. No hardware to install. No learning curve.</p>

  <h2>Is an AI Voice Agent Right for Your Business?</h2>
  <p>Ask yourself this: are you missing calls during your busiest hours? Are callers reaching voicemail after hours and on weekends? Are you sometimes with a customer when the phone rings and forced to let it go?</p>
  <p>If the answer to any of those is yes, an AI voice agent will almost certainly pay for itself within the first few weeks — just from the additional bookings it captures that would otherwise have been lost.</p>
  <p>It's not a luxury for big businesses anymore. It's a practical, affordable tool that's now accessible to any local service business that answers the phone.</p>

  <div class="article-cta">
    <h3>Ready to stop missing calls?</h3>
    <p>Find out how AiTechServices can set up an AI voice agent for your business — fast, affordable, and built specifically for local businesses like yours.</p>
    <a href="/services" class="btn btn-primary">View Our Services →</a>
  </div>
</div>
</main>
${footer()}
<script>${navScript}</script>
</body>
</html>`));

app.get("/blog/small-business-website-cost-2026", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head(
  "Small Business Website Cost in 2026 — What You'll Actually Pay | AiTechServices",
  "From DIY builders to full agencies, here's what a small business website actually costs in 2026 — and why $999 all-in is now possible with AI.",
  "https://voiceforgeai.launchyard.app/blog/small-business-website-cost-2026",
  `<meta property="og:type" content="article" />`
)}${blogCSS}</head>
<body>
${navHTML("blog")}
<main>
<div class="article-wrap">
  <p class="article-meta">May 19, 2026 &nbsp;·&nbsp; Websites</p>
  <h1>How Much Does a Small Business Website Cost in 2026?</h1>

  <h2>The 3 Main Options (and What They Actually Cost)</h2>
  <p>If you've started researching website options for your business, you've probably noticed the price range is enormous — anywhere from a few hundred dollars to tens of thousands. Here's a clear breakdown of what you're actually paying for at each level:</p>
  <ul>
    <li><strong>DIY website builders (Wix, Squarespace, GoDaddy):</strong> $200–$500 per year in subscription fees. The upside is low cost. The downside is that DIY sites tend to look generic, conversion rates are typically lower, and the time cost is significant — most business owners underestimate how long it takes to build something that actually looks professional.</li>
    <li><strong>Freelance web designer:</strong> $1,500–$5,000+ for a basic site. Quality varies widely depending on the designer. Timelines can stretch to 4–8 weeks. Revisions can drag on. You often end up with a site you can't update yourself and a developer who's moved on to their next project.</li>
    <li><strong>Agency:</strong> $5,000–$25,000+ for a small business site. You get professional design, project management, and usually a polished result — but most local businesses simply don't need (or can't justify) this level of investment.</li>
    <li><strong>AI-built (AiTechServices):</strong> $999 flat, all-in. Professional design, fast turnaround, and everything included — no surprise extras, no monthly subscription traps.</li>
  </ul>

  <h2>What Should a $999 Website Include?</h2>
  <p>Not all budget websites are created equal. When evaluating any $999 (or similarly priced) offer, here's what you should expect to be included as standard:</p>
  <ul>
    <li><strong>Custom design</strong> tailored to your brand — not an off-the-shelf template that looks like a thousand other sites</li>
    <li><strong>Fully mobile-responsive</strong> — looks and functions perfectly on phones, tablets, and desktops</li>
    <li><strong>Contact form</strong> so leads come directly to your inbox</li>
    <li><strong>Google indexing</strong> — submitted to Google Search Console so your site gets discovered</li>
    <li><strong>Fast load time</strong> — optimized for performance, because slow sites lose visitors before they even see your offer</li>
    <li><strong>SEO foundations</strong> — proper title tags, meta descriptions, image alt text, and a sitemap baked in from day one</li>
  </ul>
  <p>At AiTechServices, all of the above is included in our $999 website build. No upsells, no hidden fees, no "that's extra."</p>

  <h2>Hidden Costs to Watch Out For</h2>
  <p>One reason cheap website quotes rarely stay cheap: the headline price often excludes things you'll actually need. Common hidden extras include:</p>
  <ul>
    <li><strong>Domain name:</strong> $10–$20/year. Often sold separately even when "hosting is included."</li>
    <li><strong>Hosting:</strong> $100–$300/year after any free trial period ends.</li>
    <li><strong>Ongoing maintenance:</strong> Some agencies charge $100–$300/month just to keep your site up to date and secure.</li>
    <li><strong>Stock photos:</strong> A subscription to Shutterstock or similar can add $100–$200/year, or individual images are $10–$50 each.</li>
    <li><strong>Copywriting:</strong> If you expect the designer to write your website copy, that's often a separate charge — $300–$1,000 extra for a basic site.</li>
    <li><strong>SSL certificate:</strong> Now standard in most plans, but still worth confirming.</li>
  </ul>
  <p>Before signing anything, always ask: "Does this price include everything I need to go live?" A reputable provider should be able to answer that question clearly.</p>

  <h2>Does a More Expensive Website Mean Better Results?</h2>
  <p>Not necessarily — and for local businesses especially, the answer is often no. A clean, fast, mobile-friendly site with a clear service offering, a compelling headline, and a prominent call-to-action will consistently outperform an expensive, flashy site that's slow to load or confusing to navigate.</p>
  <p>Google also cares more about page speed, mobile usability, and basic SEO hygiene than about visual complexity. A $999 site built with these fundamentals will rank better than a $10,000 over-engineered site that wasn't built with search in mind.</p>
  <p>The goal of your website is simple: get found, build credibility, and convert visitors into leads. You don't need custom animations or a bespoke CMS to do that.</p>

  <h2>What to Look For When Choosing a Website Builder or Agency</h2>
  <p>Regardless of budget, these are the signals that separate good providers from bad ones:</p>
  <ul>
    <li><strong>Mobile-first design:</strong> Over 60% of web traffic is on mobile. If a provider isn't leading with this, walk away.</li>
    <li><strong>SEO foundations baked in:</strong> Not an add-on, not an upsell — it should be standard.</li>
    <li><strong>Clear, all-in pricing:</strong> No "starting from" quotes without a clear scope. You should know what you're paying before you commit.</li>
    <li><strong>Fast turnaround:</strong> Your business needs a site now, not in 3 months. Anything over 2 weeks for a standard local business site is a red flag.</li>
    <li><strong>Includes copy/content:</strong> The best providers handle the words, not just the design. You shouldn't have to write your own website copy.</li>
  </ul>

  <div class="article-cta">
    <h3>Get a professional website for $999 — all in.</h3>
    <p>AiTechServices builds fast, mobile-friendly, SEO-ready websites for local businesses. No hidden fees, no surprises — delivered in 5–7 business days.</p>
    <a href="/services" class="btn btn-primary">See What's Included →</a>
  </div>
</div>
</main>
${footer()}
<script>${navScript}</script>
</body>
</html>`));

app.get("/blog/best-ai-tools-for-local-businesses-2026", (c) => c.html(`<!doctype html>
<html lang="en">
<head>${head(
  "Best AI Tools for Local Businesses in 2026 | AiTechServices",
  "The top AI tools local business owners are using in 2026 to save time, answer calls, build websites, and automate marketing — without a tech team.",
  "https://voiceforgeai.launchyard.app/blog/best-ai-tools-for-local-businesses-2026",
  `<meta property="og:type" content="article" />`
)}${blogCSS}</head>
<body>
${navHTML("blog")}
<main>
<div class="article-wrap">
  <p class="article-meta">May 26, 2026 &nbsp;·&nbsp; AI Tools</p>
  <h1>Best AI Tools for Local Businesses in 2026</h1>

  <h2>Why Local Businesses Are Adopting AI Faster Than Ever</h2>
  <p>Three forces are converging that are pushing local businesses toward AI tools faster than at any previous point: rising labor costs, higher customer expectations, and intensifying competition from larger chains and national brands.</p>
  <p>Minimum wages have increased significantly across most US states. Finding and retaining reliable staff — even for part-time front-desk roles — has become a real challenge. Meanwhile, customers now expect instant responses, 24/7 availability, and seamless booking experiences. And the big players have the technology and budget to deliver on all of that.</p>
  <p>AI tools are how local businesses level that playing field. They don't require a tech department, a large budget, or months of implementation. Many of the best tools available today can be live and delivering value within a week.</p>

  <h2>AI Voice Agents — Never Miss a Call Again</h2>
  <p>The single most impactful AI tool for most local service businesses is an AI voice agent — a smart phone assistant that answers calls on your behalf around the clock. It books appointments, handles frequently asked questions, captures lead information, and routes complex calls to your team.</p>
  <p>For any business that depends on the phone — salons, contractors, dental offices, auto shops, restaurants — the math is straightforward: every missed call is a potential customer lost to a competitor. An AI voice agent eliminates that loss entirely.</p>
  <p><strong>AiTechServices</strong> builds and manages custom AI voice agents for local businesses. Setup is simple: you share your business details, we train and configure your agent, and it goes live within days. Starting at $299/month, it's a fraction of what a part-time receptionist costs — and it never takes a day off.</p>

  <h2>AI Website Builders — A Professional Site Without the Agency Price Tag</h2>
  <p>Five years ago, a professional local business website cost $5,000–$15,000 from a decent agency and took 6–10 weeks. In 2026, AI-assisted design and development has fundamentally changed that equation.</p>
  <p>Today, an AI-built website can look every bit as polished as an agency-built one — mobile-responsive, SEO-ready, fast-loading, and customized to your brand — for a fraction of the cost and in a fraction of the time. The technology has genuinely caught up.</p>
  <p><strong>AiTechServices</strong> delivers complete, professional websites for local businesses at <strong>$999 flat</strong> — all-in, with no hidden fees. That includes custom design, mobile optimization, SEO foundations, a contact form, and Google indexing. Delivered in 5–7 business days.</p>
  <p>If you don't have a website yet, or your current site is embarrassing you, this is the single highest-ROI investment you can make in 2026. A clean, fast, credible website means more calls, more leads, and more booked jobs.</p>

  <h2>AI Scheduling Tools</h2>
  <p>Once your website and phone coverage are sorted, automating your appointment booking is the next win. Tools like <strong>Calendly</strong> and <strong>Acuity Scheduling</strong> let customers book directly into your calendar without a back-and-forth email chain.</p>
  <p>Both integrate with Google Calendar and can be embedded on your website. Calendly offers a generous free tier that's sufficient for many small businesses. Acuity is stronger for businesses with multiple staff members or complex service menus. Either one eliminates scheduling phone tag and reduces no-shows with automated reminders.</p>

  <h2>AI Marketing Automation</h2>
  <p>AI-powered marketing tools are increasingly accessible to businesses without a dedicated marketing team. A few categories worth knowing about:</p>
  <ul>
    <li><strong>Email follow-up automation:</strong> Tools like Mailchimp and Klaviyo can automatically follow up with leads, send post-appointment check-ins, and re-engage past customers. Setting up even a simple 2-email follow-up sequence can meaningfully increase repeat bookings.</li>
    <li><strong>Review request automation:</strong> Platforms like Podium and Birdeye automatically send SMS or email review requests after a completed service. More Google reviews directly improves your local search ranking and builds trust with new visitors.</li>
    <li><strong>Google Business Profile tools:</strong> Keeping your Google Business Profile updated — hours, photos, posts, responses to reviews — is one of the highest-leverage free actions for local SEO. Tools like Semrush Local or BrightLocal can help you monitor and manage it at scale.</li>
  </ul>

  <h2>How to Pick the Right AI Tools for Your Business</h2>
  <p>With hundreds of AI tools on the market, it's easy to get overwhelmed — or to sign up for five tools and only use one. Here's a more practical framework:</p>
  <ul>
    <li><strong>Start with your biggest pain point.</strong> For most local businesses, that's either missed calls or no online presence. Solve one problem completely before adding more tools.</li>
    <li><strong>Don't overbuy.</strong> A $300/month stack of tools you're barely using is worse than one $50/month tool you use daily. Complexity kills adoption.</li>
    <li><strong>Pick tools with quick setup times.</strong> If it takes 6 months to implement, it's not the right fit for a small business. Look for tools that can be live in days, not quarters.</li>
    <li><strong>Measure results simply.</strong> You don't need a data analytics team. Just track: are you getting more calls? More leads? More bookings? If yes, the tool is working.</li>
  </ul>
  <p>For most local businesses, the highest-ROI starting point in 2026 is clear: get a professional website and make sure every incoming call gets answered. Everything else is secondary.</p>

  <div class="article-cta">
    <h3>AiTechServices — AI voice + website, in one place.</h3>
    <p>We're the one-stop shop for local businesses that want to stop missing calls and start looking credible online. AI voice agent from $299/month. Professional website for $999. Fast setup, no tech knowledge needed.</p>
    <a href="/services" class="btn btn-primary">Explore Our Services →</a>
  </div>
</div>
</main>
${footer()}
<script>${navScript}</script>
</body>
</html>`));

// ─── Sitemap & Robots ─────────────────────────────────────────────────────────

app.get("/sitemap.xml", (c) =>
  c.text(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.aitechservices.tech/</loc><lastmod>2025-01-01</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://www.aitechservices.tech/services</loc><lastmod>2025-01-01</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>https://www.aitechservices.tech/contact</loc><lastmod>2025-01-01</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://www.aitechservices.tech/blog</loc><lastmod>2026-05-26</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>https://www.aitechservices.tech/blog/ai-voice-agent-for-small-business</loc><lastmod>2026-05-12</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://www.aitechservices.tech/blog/small-business-website-cost-2026</loc><lastmod>2026-05-19</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://www.aitechservices.tech/blog/best-ai-tools-for-local-businesses-2026</loc><lastmod>2026-05-26</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
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
