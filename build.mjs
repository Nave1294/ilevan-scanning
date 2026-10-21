// Generates the static site from content/ into dist/.
//   node build.mjs
// No dependencies. Everything the dashboard edits lives in content/.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist");

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// Cache-busting: a returning visitor never pairs new HTML with an old script.
const version = (p) =>
  createHash("sha1").update(readFileSync(join(ROOT, p), "utf8").replace(/\r/g, "")).digest("hex").slice(0, 8);

/* Content comes from a dashboard, so it is never trusted as markup. */
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Paths typed into the dashboard: relative files, or https links. Anything
// carrying another scheme (javascript:, data:) is dropped.
const safeUrl = (s) => {
  const v = String(s ?? "").trim().replace(/^\/+/, "");
  if (!v) return "";
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
  return !scheme || /^https$/i.test(scheme[1]) ? v : "";
};

// Matterport share links ("/show/?m=…") and Realsee short links embed
// directly, as both services' own embed codes iframe that same URL. Anything
// else becomes a button.
const embeddable = (url) =>
  /^https:\/\/(my\.)?matterport\.com\/show\//i.test(url) || /^https:\/\/([a-z0-9-]+\.)*realsee\.ai\//i.test(url);

/* ---------- load content ---------- */
const site = read("content/site.json");

const work = readdirSync(join(ROOT, "content/work"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(join("content/work", f)))
  .filter((w) => w.published !== false)
  .map((w) => ({
    ...w,
    cover: safeUrl(w.cover) || safeUrl(w.images?.[0]?.src),
    tourUrl: safeUrl(w.tourUrl),
    images: (w.images || []).map((i) => ({ ...i, src: safeUrl(i.src) })).filter((i) => i.src),
  }))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.title).localeCompare(String(b.title)));

/* ---------- pieces ---------- */
const email = String(site.email || "").trim();
const phone = String(site.phone || "").trim();
const mailto = email ? `mailto:${email}?subject=${encodeURIComponent("Scan enquiry")}` : "#contact";

// A floor plan being scanned: the mark of the business, drawn rather than
// photographed so the page looks finished before there is any work to show.
const planSvg = `<svg class="plan" viewBox="0 0 480 360" aria-hidden="true" focusable="false">
  <g class="plan-walls">
    <path d="M20 20 H300 M330 20 H460 V200 M460 230 V340 H20 V20"/>
    <path d="M200 20 V110 M200 140 V200 M20 200 H90 M120 200 H300 V260 M300 290 V340 M300 200 H330 V20"/>
    <path d="M360 200 H460"/>
  </g>
  <g class="plan-rays">
    <path d="M250 270 L20 200 M250 270 L20 340 M250 270 L300 200 M250 270 L120 200 M250 270 L160 340"/>
  </g>
  <g class="plan-scan">
    <circle cx="250" cy="270" r="30"/>
    <circle cx="250" cy="270" r="62"/>
    <circle cx="250" cy="270" r="96"/>
  </g>
  <circle class="plan-scanner" cx="250" cy="270" r="6"/>
</svg>`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n) => "$" + (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2));
const sqft = (n) => n.toLocaleString("en-US") + " sq ft";

// Prices are stored as numbers, not prose, so the card text and the
// estimator are worked out from the same figures and can never disagree.
const tiers = (site.tiers || [])
  .map((t) => {
    const flat = num(t.flat), upTo = num(t.flatUpTo), over = num(t.overRate);
    const rate = num(t.rate), min = num(t.min), hosting = num(t.hosting);
    const price = flat
      ? `<span class="tier-amount">${money(flat)}</span><span class="tier-unit">flat</span>`
      : `<span class="tier-amount">${money(rate)}</span><span class="tier-unit">/sq ft</span>`;
    const detail = flat
      ? [upTo ? `Up to ${sqft(upTo)}` : "", over ? `then ${money(over)}/sq ft` : ""].filter(Boolean).join(", ")
      : min ? `${money(min)} minimum` : "";
    const host = hosting ? `+ ${money(hosting)}/mo hosting` : t.hostingNote || "";
    return `<li class="tier${t.featured ? " tier-featured" : ""}">
        <h3>${esc(t.name)}</h3>
        <p class="tier-includes">${esc(t.includes)}</p>
        <p class="tier-price">${price}</p>
        <ul class="tier-terms">
          ${detail ? `<li>${esc(detail)}</li>` : ""}
          ${host ? `<li${hosting ? ' class="tier-hosting"' : ""}>${esc(host)}</li>` : ""}
        </ul>
        <p class="tier-estimate" hidden>${hosting ? "First invoice" : "Invoice"} <strong data-estimate></strong>${hosting ? ` <span class="tier-after">+ ${money(hosting)}/mo after first month</span>` : ""}</p>
        <a class="tier-book" href="book.html?package=${encodeURIComponent(t.name || "")}">Book ${esc(t.name)}</a>
      </li>`;
  })
  .join("\n      ");

const steps = (site.steps || [])
  .map(
    (s, i) => `<li>
        <span class="step-num">${i + 1}</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.text)}</p>
      </li>`
  )
  .join("\n      ");

const workCard = (w, i) => {
  const meta = [w.location, w.date].map((v) => String(v ?? "").trim()).filter(Boolean).map(esc).join(" · ");
  const frame = w.cover
    ? `<img src="${esc(w.cover)}" alt="" loading="lazy" decoding="async">`
    : w.tourUrl
      ? `<span class="work-empty"><span class="brand-mark" aria-hidden="true"></span>3D tour</span>`
      : `<span class="work-empty">No image yet</span>`;
  return `<li>
        <button class="work-card" type="button" data-open="work-${i}">
          <span class="work-frame">${frame}</span>
          <span class="work-title">${esc(w.title)}</span>
          ${meta ? `<span class="work-meta">${meta}</span>` : ""}
        </button>
      </li>`;
};

// Each job opens in a dialog: its summary, the tour, then every image.
const workDialog = (w, i) => {
  const meta = [w.location, w.date].map((v) => String(v ?? "").trim()).filter(Boolean).map(esc).join(" · ");
  const tour = w.tourUrl
    ? embeddable(w.tourUrl)
      ? `<div class="tour"><iframe data-src="${esc(w.tourUrl)}" title="3D tour of ${esc(w.title)}" allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer" allowfullscreen></iframe></div>
          <p><a class="text-link" href="${esc(w.tourUrl)}" target="_blank" rel="noopener">Open the tour full screen</a></p>`
      : `<p><a class="button" href="${esc(w.tourUrl)}" target="_blank" rel="noopener">Open the 3D tour</a></p>`
    : "";
  const figures = w.images
    .map(
      (img) => `<figure>
            <img src="${esc(img.src)}" alt="${esc(img.caption || w.title)}" loading="lazy" decoding="async">
            ${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ""}
          </figure>`
    )
    .join("\n          ");
  return `<dialog class="work-dialog" id="work-${i}" aria-labelledby="work-${i}-title">
      <div class="dialog-inner">
        <header class="dialog-head">
          <div>
            <h3 id="work-${i}-title">${esc(w.title)}</h3>
            ${meta ? `<p class="work-meta">${meta}</p>` : ""}
          </div>
          <button class="dialog-close" type="button" data-close aria-label="Close">×</button>
        </header>
        ${w.summary ? `<p class="dialog-summary">${esc(w.summary)}</p>` : ""}
        ${tour}
        <div class="dialog-images">
          ${figures}
        </div>
      </div>
    </dialog>`;
};

// With nothing published the Work section, and its nav link, disappear
// rather than showing an empty grid.
const hasWork = work.length > 0;
const workSection = hasWork
  ? `<section class="section" id="work" aria-labelledby="work-heading">
    <div class="wrap">
      <div class="section-head">
        <h2 id="work-heading">Work</h2>
        ${site.workIntro ? `<p>${esc(site.workIntro)}</p>` : ""}
      </div>
      <ul class="work-grid">
      ${work.map(workCard).join("\n      ")}
      </ul>
    </div>
    ${work.map(workDialog).join("\n    ")}
  </section>`
  : "";

const contactLines = [
  email ? `<a href="${esc(mailto)}">${esc(email)}</a>` : "",
  phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(phone)}</a>` : "",
]
  .filter(Boolean)
  .join("\n          ");

const name = esc(site.name || "Ilevan Scanning");
const description = esc(site.intro || site.tagline || "");
const bookLabel = esc(site.ctaLabel || "Book a scan");

// Basic or Pro, side by side. Left out entirely when the dashboard has no
// options for it.
const compare = site.compare || {};
const compareOptions = (compare.options || [])
  .map(
    (o) => `<div class="compare-card${o.featured ? " compare-featured" : ""}">
            ${o.tag ? `<span class="compare-tag">${esc(o.tag)}</span>` : ""}
            <h3>${esc(o.title)}</h3>
            <ul>
              ${(o.points || []).map((pt) => `<li>${esc(pt)}</li>`).join("\n              ")}
            </ul>
          </div>`
  )
  .join("\n          ");
const compareSection = compareOptions
  ? `<section class="section" id="compare" aria-labelledby="compare-heading">
      <div class="wrap">
        <div class="section-head section-head-stack">
          <h2 id="compare-heading">${esc(compare.heading || "Which tour?")}</h2>
          ${compare.intro ? `<p>${esc(compare.intro)}</p>` : ""}
        </div>
        <div class="compare" data-tabs>
          ${compareOptions}
        </div>
        ${compare.both ? `<p class="compare-both">${esc(compare.both)}</p>` : ""}
      </div>
    </section>`
  : "";

// Schematic plans: a base drawing set plus optional add-ons. Each is priced
// flat, per square foot (with a minimum), or left at 0 to read "Quoted".
const plans = site.plans || {};
const tourHosting = num(plans.tourHosting);
const PLANS_PACKAGE = "Schematic plans";
const priceLabel = (p, prefix = "") => {
  const flat = num(p.flat), rate = num(p.rate), min = num(p.min);
  if (flat) return { main: `${prefix}${money(flat)}`, unit: "flat", terms: "" };
  const unit = p.per === "changes" ? "/sq ft of proposed changes" : "/sq ft";
  // Rates always show cents ($2.00, not $2), like the other per-sq-ft prices.
  if (rate) return { main: `${prefix}$${rate.toFixed(2)}`, unit, terms: min ? `${money(min)} minimum` : "" };
  return { main: "Quoted", unit: "", terms: "Priced after we see the property" };
};
const plansCard = (p, { tag, addon = false, featured = false }) => {
  const price = priceLabel(p, addon ? "+ " : "");
  return `<div class="plans-card${featured ? " plans-featured" : ""}">
            <span class="compare-tag">${esc(tag)}</span>
            <h3>${esc(p.name)}</h3>
            <p class="plans-text">${esc(addon ? p.text : p.includes)}</p>
            <div class="plans-price">
              <p class="tier-price"><span class="plans-amount">${esc(price.main)}</span>${price.unit ? `<span class="tier-unit">${price.unit}</span>` : ""}</p>
              ${price.terms ? `<p class="hint">${esc(price.terms)}</p>` : ""}
            </div>
          </div>`;
};
const plansSection = plans.name
  ? `<section class="section" id="plans" aria-labelledby="plans-heading">
      <div class="wrap">
        <div class="section-head section-head-stack">
          <h2 id="plans-heading">${esc(plans.heading || PLANS_PACKAGE)}</h2>
          ${plans.intro ? `<p>${esc(plans.intro)}</p>` : ""}
        </div>
        <div class="plans" data-tabs>
          ${plansCard(plans, { tag: "Included", featured: true })}
          ${(plans.addons || []).map((a) => plansCard(a, { tag: "Add-on", addon: true })).join("\n          ")}
        </div>
        ${plans.note ? `<p class="pricing-note">${esc(plans.note)}</p>` : ""}
        <p><a class="button" href="book.html?package=${encodeURIComponent(PLANS_PACKAGE)}">Book schematic plans</a></p>
      </div>
    </section>`
  : "";

// Every price the site's calculators use, in one place: the pricing cards'
// estimator, the booking form and the job builder all read this, so no two
// of them can quote differently. "<" is escaped so content can't close the
// script tag early.
const pricing = {
  tiers: (site.tiers || []).map((t) => ({
    name: String(t.name || ""), flat: num(t.flat), upTo: num(t.flatUpTo), over: num(t.overRate),
    rate: num(t.rate), min: num(t.min), hosting: num(t.hosting),
    deliverables: (t.deliverables || []).map(String),
  })),
  plans: plans.name
    ? {
        name: PLANS_PACKAGE, flat: num(plans.flat), rate: num(plans.rate), min: num(plans.min), tourHosting,
        base: `Schematic plan: ${String(plans.name).toLowerCase()}`,
        addons: (plans.addons || []).map((a) => ({
          name: String(a.name || ""), flat: num(a.flat), rate: num(a.rate), min: num(a.min),
          per: a.per === "changes" ? "changes" : "building",
        })),
      }
    : null,
};
const pricingScript = `<script type="application/json" id="pricing-data">${JSON.stringify(pricing).replace(/</g, "\\u003c")}</script>`;

const choice = (name, value, label, extra = "") =>
  `<label class="chip"><input type="radio" name="${name}" value="${value}"${extra}><span>${label}</span></label>`;
const tick = (a) =>
  `<label class="chip"><input type="checkbox" data-builder-addon value="${esc(a.name)}"${a.per === "changes" ? " data-per-changes" : ""}><span>${esc(a.name)}</span></label>`;

const builderSection = `<section class="section section-alt" id="builder" aria-labelledby="builder-heading" hidden data-builder>
      <div class="wrap builder">
        <div class="section-head section-head-stack">
          <h2 id="builder-heading">Build your job</h2>
          <p>Answer a few questions and we'll suggest a package and an estimate.</p>
        </div>
        <form class="builder-form" data-builder-form>
          <fieldset class="q">
            <legend>What's the scan for?</legend>
            ${choice("purpose", "listing", "Marketing a listing")}
            ${plans.name ? choice("purpose", "plans", "A renovation or addition") : ""}
          </fieldset>
          <fieldset class="q" data-show="listing" hidden>
            <legend>What kind of property?</legend>
            ${choice("kind", "home", "Home")}
            ${choice("kind", "commercial", "Commercial or mixed-use")}
          </fieldset>
          <fieldset class="q" data-show="home" hidden>
            <legend>Where will the tour be seen?</legend>
            ${choice("where", "zillow", "On Zillow")}
            ${choice("where", "own", "My website, social and email")}
            ${choice("where", "both", "Both")}
          </fieldset>
          <fieldset class="q" data-show="plans" hidden>
            <legend>Add to the schematic plan? <span class="hint">A schematic plan of every level is included. Pick any extras, or none.</span></legend>
            ${(plans.addons || []).map(tick).join("\n            ")}
          </fieldset>
          ${tourHosting ? `<fieldset class="q" data-show="plans" hidden>
            <legend>Keep a walkthrough of the property?</legend>
            ${choice("tour", "yes", `Yes, the branded Realsee tour (+${money(tourHosting)}/mo)`)}
            ${choice("tour", "no", "No, just the schematic plan")}
          </fieldset>` : ""}
          <fieldset class="q" data-show="size" hidden>
            <legend><label for="builder-sqft">Square footage of the building</label></legend>
            <input id="builder-sqft" type="number" inputmode="numeric" min="100" step="50" placeholder="e.g. 1500" data-builder-sqft>
          </fieldset>
          <fieldset class="q" data-show="changes" hidden>
            <legend><label for="builder-changes">Square footage of proposed changes</label> <span class="hint">The area you're reworking or adding, e.g. a 300 sq ft kitchen and dining room.</span></legend>
            <input id="builder-changes" type="number" inputmode="numeric" min="1" step="10" placeholder="e.g. 300" data-builder-changes>
          </fieldset>
        </form>
        <div class="builder-result" aria-live="polite" data-builder-result hidden>
          <span class="compare-tag">We'd suggest</span>
          <h3 data-builder-name></h3>
          <p class="builder-why" data-builder-why></p>
          <table class="breakdown" data-builder-breakdown></table>
          <p class="builder-estimate" data-builder-estimate></p>
          <p><a class="button" href="book.html" data-builder-book>Book this</a></p>
        </div>
      </div>
    </section>`;

// Line icons for the phone index, drawn on a 24px grid in currentColor.
const ICONS = {
  pricing: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  compare: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  plans: '<rect x="3" y="3" width="18" height="18"/><path d="M3 12h6M14 12h7M12 3v5M12 15v6"/>',
  builder: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M20 18h0"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/>',
  work: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
  book: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

// Only sections that exist get a button. Phones only; desktop keeps the
// header links.
const railItems = [
  ["builder", "Build your job", true],
  ["pricing", "Pricing", true],
  ["compare", "Tours", !!compareSection],
  ["plans", "Schematic plans", !!plansSection],
  ["work", "Work", hasWork],
].filter(([, , on]) => on);
const rail = `<nav class="rail" aria-label="Sections">
    ${railItems.map(([id, label]) => `<a href="#${id}" data-rail="${id}" aria-label="${label}"${id === "builder" ? " data-builder-link hidden" : ""}>${icon(id)}<span class="rail-label">${label}</span></a>`).join("\n    ")}
    <a href="book.html" class="rail-book" aria-label="Book">${icon("book")}<span class="rail-label">Book</span></a>
  </nav>`;

// The hero intro's first sentence, then the rest in a span phones hide.
const ledeHtml = (() => {
  const intro = String(site.intro || "");
  const cut = intro.search(/[.!?]\s/);
  return cut < 0 ? esc(intro) : `${esc(intro.slice(0, cut + 1))}<span class="lede-more"> ${esc(intro.slice(cut + 2))}</span>`;
})();

/* ---------- shared frame ----------
   On the home page the nav jumps within the page; elsewhere it links back to
   the home page's sections. */
// Link previews (iMessage, Facebook, LinkedIn) need absolute URLs; a relative
// og:image is ignored by most of them. Change siteUrl when a custom domain
// goes live.
const siteUrl = String(site.siteUrl || "").trim().replace(/\/?$/, "/").replace(/^\/$/, "");

const page = ({ title, desc = description, home = false, path = "", body }) => {
  const at = home ? "" : "index.html";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${name}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  ${siteUrl ? `<meta property="og:url" content="${esc(siteUrl + path)}">
  <meta property="og:image" content="${esc(siteUrl + "assets/brand/og-image.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${name} logo">
  <meta name="twitter:card" content="summary_large_image">` : ""}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23111'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%23fff'/%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%23fff' stroke-width='2' opacity='.5'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="css/style.css?v=${version("css/style.css")}">
  ${pricingScript}
  <script defer src="js/main.js?v=${version("js/main.js")}"></script>
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="${home ? "#top" : "index.html"}"><span class="brand-mark" aria-hidden="true"></span>${name}</a>
      <nav aria-label="Main"${home ? ' class="nav-home"' : ""}>
        <a href="${at}#pricing">Pricing</a>
        ${plansSection ? `<a href="${at}#plans">Schematic plans</a>` : ""}
        ${hasWork ? `<a href="${at}#work">Work</a>` : ""}
        <a href="book.html">Book</a>
      </nav>
    </div>
  </header>

  <main id="top"${home ? ' class="has-rail"' : ""}>
${body}
  </main>
  ${home ? rail : ""}

  <footer class="site-footer">
    <div class="wrap">© ${new Date().getFullYear()} ${name}</div>
  </footer>
</body>
</html>
`;
};

/* ---------- home ---------- */
const home = page({
  title: name,
  home: true,
  body: `    <section class="hero">
      <div class="wrap hero-inner">
        <div class="hero-text">
          ${site.eyebrow ? `<p class="eyebrow">${esc(site.eyebrow)}</p>` : ""}
          <h1>${esc(site.tagline)}</h1>
          <p class="lede">${ledeHtml}</p>
          <p class="hero-actions"><a class="button" href="book.html">${bookLabel}</a> <a class="text-link" href="#builder" data-builder-link hidden>Help me choose</a></p>
        </div>
        <div class="hero-art">${planSvg}</div>
      </div>
    </section>

    ${builderSection}

    <section class="section" id="pricing" aria-labelledby="pricing-heading">
      <div class="wrap">
        <div class="section-head">
          <h2 id="pricing-heading">Pricing</h2>
          <label class="estimator" hidden>
            <span>Home size</span>
            <input type="number" inputmode="numeric" min="100" step="50" value="1500" data-sqft>
            <span>sq ft</span>
          </label>
        </div>
        <ul class="tiers" data-tabs data-tabs-default="featured">
      ${tiers}
        </ul>
        ${site.pricingNote ? `<p class="pricing-note">${esc(site.pricingNote)}</p>` : ""}
      </div>
    </section>

    ${compareSection}

    ${plansSection}

    <section class="section section-alt" aria-labelledby="process-heading">
      <div class="wrap">
        <div class="section-head">
          <h2 id="process-heading">How it works</h2>
        </div>
        <ol class="steps">
      ${steps}
        </ol>
      </div>
    </section>

    ${workSection}

    <section class="section" id="contact" aria-labelledby="contact-heading">
      <div class="wrap contact">
        <div>
          <h2 id="contact-heading">Book a scan</h2>
          ${site.about ? `<p>${esc(site.about)}</p>` : ""}
          ${site.area ? `<p class="muted">${esc(site.area)}</p>` : ""}
          <p><a class="button" href="book.html">${bookLabel}</a></p>
        </div>
        <div class="contact-lines">
          ${contactLines}
        </div>
      </div>
    </section>`,
});

/* ---------- booking form ----------
   GitHub Pages can't send mail, so the form posts to FormSubmit, which emails
   the fields to the address in site.json. Its very first submission sends that
   address an activation link instead; nothing is delivered until it's clicked.
   Fields starting with _ are FormSubmit settings, not questions. */
const tierOptions = (site.tiers || [])
  .map((t) => `<option value="${esc(t.name)}">${esc(t.name)}: ${esc(t.includes)}</option>`)
  .join("\n                ");

const field = (id, label, input, hint = "") =>
  `<div class="field">
              <label for="${id}">${label}</label>
              ${input}
              ${hint ? `<p class="hint">${hint}</p>` : ""}
            </div>`;

const req = `<span class="req" aria-hidden="true">*</span>`;

const book = page({
  path: "book.html",
  title: `${bookLabel} · ${name}`,
  body: `    <section class="section form-section">
      <div class="wrap form-layout">
        <div class="form-intro">
          <h1>${bookLabel}</h1>
          <p class="lede">Tell us what you need and about the property, and we'll reply to confirm a time and the price.</p>
          <div class="contact-lines contact-lines-small">
            ${contactLines}
          </div>
        </div>

        <form class="booking" action="https://formsubmit.co/${esc(email)}" method="POST" data-booking>
          <input type="hidden" name="_subject" value="New scan booking">
          <input type="hidden" name="_template" value="table">
          <input type="hidden" name="_captcha" value="false">
          <input type="hidden" name="_next" value="" data-next>
          <input class="honey" type="text" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true">

          <input type="hidden" name="Deliverables" value="" data-book-deliverables>
          <input type="hidden" name="Estimate" value="" data-book-estimate-field>
          <input type="hidden" name="Price breakdown" value="" data-book-breakdown-field>

          <fieldset>
            <legend>Your job</legend>
            ${field("package", `What do you need? ${req}`, `<select id="package" name="Package" required data-book-package>
                <option value="">Choose a package</option>
                ${tierOptions}
                ${plans.name ? `<option value="${PLANS_PACKAGE}">${PLANS_PACKAGE}: ${esc(plans.includes)}</option>` : ""}
                <option value="Not sure">Not sure yet</option>
              </select>`, `Not sure? <a href="index.html#builder">Build your job</a> and we'll suggest one.`)}
            ${(plans.addons || []).length || tourHosting ? `<div class="field addons" hidden data-addons>
              <span class="addons-label">Add to the schematic plan</span>
              ${plans.addons
                .map(
                  (a) => `<label class="check"><input type="checkbox" data-addon data-name="${esc(a.name)}"${a.per === "changes" ? " data-per-changes" : ""}> ${esc(a.name)}</label>`
                )
                .join("\n              ")}
              ${tourHosting ? `<label class="check"><input type="checkbox" data-tour> Branded Realsee tour from the same scan (+${money(tourHosting)}/mo hosting)</label>` : ""}
            </div>` : ""}
            ${field("kind", "Property type", `<select id="kind" name="Property type" data-book-kind>
                <option value="">Choose one</option>
                <option value="Home">Home</option>
                <option value="Commercial or mixed-use">Commercial or mixed-use</option>
              </select>`)}
            ${field("sqft", `Square footage of the building ${req}`, `<input id="sqft" name="Square footage" type="number" inputmode="numeric" min="100" step="1" required data-book-sqft>`)}
            <div class="field" hidden data-changes-field>
              <label for="changes">Square footage of proposed changes ${req}</label>
              <input id="changes" name="Proposed changes (sq ft)" type="number" inputmode="numeric" min="1" step="1" data-book-changes disabled>
              <p class="hint">The area you're reworking or adding.</p>
            </div>
            <div class="job-summary" hidden data-book-summary>
              <span class="compare-tag">You're booking</span>
              <ul data-book-list></ul>
              <p class="estimate-line" data-book-estimate></p>
            </div>
          </fieldset>

          <fieldset>
            <legend>The property</legend>
            ${field("address", `Address ${req}`, `<input id="address" name="Address" type="text" autocomplete="street-address" required>`)}
            ${field("access", "Access", `<input id="access" name="Access" type="text" placeholder="Lockbox, occupied, pets…">`)}
          </fieldset>

          <fieldset>
            <legend>You</legend>
            ${field("name", `Name ${req}`, `<input id="name" name="Name" type="text" autocomplete="name" required>`)}
            ${field("email", `Email ${req}`, `<input id="email" name="email" type="email" autocomplete="email" required>`, "Replies go here.")}
            ${field("phone", "Phone", `<input id="phone" name="Phone" type="tel" autocomplete="tel">`)}
            ${field("brokerage", "Brokerage or company", `<input id="brokerage" name="Brokerage or company" type="text" autocomplete="organization">`)}
          </fieldset>

          <fieldset>
            <legend>Scheduling</legend>
            ${field("dates", "Preferred dates or times", `<input id="dates" name="Preferred dates" type="text" placeholder="e.g. Tue or Wed morning">`)}
            ${field("notes", "Anything else", `<textarea id="notes" name="Notes" rows="4"></textarea>`)}
          </fieldset>

          <p><button class="button" type="submit">Send booking request</button></p>
          <p class="hint">This sends your details to ${name} by email. We'll reply to confirm; nothing is booked until we do.</p>
        </form>
      </div>
    </section>`,
});

const thanks = page({
  path: "thanks.html",
  title: `Thanks · ${name}`,
  body: `    <section class="section form-section">
      <div class="wrap thanks">
        <h1>Request sent.</h1>
        <p class="lede">Thanks. We'll reply by email to confirm a time and the price.</p>
        <p><a class="button" href="index.html">Back to the site</a></p>
      </div>
    </section>`,
});

if (!email) console.warn("Warning: no email in content/site.json, so the booking form has nowhere to send.");

/* ---------- write ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), home);
writeFileSync(join(OUT, "book.html"), book);
writeFileSync(join(OUT, "thanks.html"), thanks);
writeFileSync(join(OUT, ".nojekyll"), "");
for (const dir of ["css", "js", "assets"]) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
console.log(`Built index, book and thanks pages — ${work.length} published job${work.length === 1 ? "" : "s"}.`);
