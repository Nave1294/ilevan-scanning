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
// js/main.js brings it to life: the logo's eye comes in through the front
// door, goes room to room through the doorways, sends out dotted lines of
// sight, and each room's walls build in as it's scanned. Then it moves in,
// measures up, furnishes the place, and welcomes its family; a whole evening
// later, it ends with everyone asleep. Each room's walls are revealed by a
// circle growing from the eye, clipped to that room (with a little extra, so
// the walls on its edges come too). Without JavaScript, or with reduced motion, it's simply the finished,
// furnished plan.
//
// Rooms are listed in the order the eye scans them; doors join two rooms
// (by index) at a point on the wall between them.
const PLAN_ROOMS = [
  { x: 20, y: 200, w: 280, h: 140 }, // living room, entered by the front door right of the sofa
  { x: 300, y: 200, w: 160, h: 140 }, // dining
  { x: 330, y: 20, w: 130, h: 180 }, // kitchen
  { x: 200, y: 90, w: 130, h: 110 }, // kids' room
  { x: 200, y: 20, w: 130, h: 70 }, // bathroom, between the two bedrooms
  { x: 20, y: 20, w: 180, h: 180 }, // bedroom
];
const PLAN_DOORS = [
  [0, 1, 300, 225],
  [1, 2, 345, 200],
  // Kids' room to bathroom listed before kids' room to living room, so the
  // way from the kids' room to the big bedroom is through the bathroom.
  [3, 4, 265, 90],
  [0, 3, 250, 200],
  [4, 5, 200, 55],
  [5, 0, 105, 200],
];
// Furniture, as simple outlines. Hidden while the eye is still to place it.
const PLAN_ITEMS = {
  counter: '<rect x="424" y="32" width="26" height="150" rx="2"/>',
  stove: '<rect x="424" y="80" width="26" height="42" rx="2"/><circle cx="437" cy="92" r="5"/><circle cx="437" cy="110" r="5"/>',
  table: '<circle cx="390" cy="285" r="24"/><rect x="383" y="250" width="14" height="8" rx="2"/><rect x="383" y="312" width="14" height="8" rx="2"/>',
  tv: '<rect x="150" y="208" width="80" height="10" rx="2"/><rect class="plan-screen" x="153" y="210" width="74" height="6" rx="1"/>',
  sofa: '<rect x="70" y="300" width="120" height="26" rx="6"/><path d="M76 312 H184"/><rect x="62" y="296" width="12" height="32" rx="4"/><rect x="186" y="296" width="12" height="32" rx="4"/>',
  speaker: '<rect x="34" y="214" width="20" height="28" rx="3"/><circle cx="44" cy="233" r="5"/><circle cx="44" cy="221" r="2"/>',
  // Two little beds against the side walls, clear of both doorways.
  kidbeds: '<rect x="208" y="100" width="34" height="58" rx="4"/><rect x="213" y="105" width="24" height="11" rx="3"/><rect x="288" y="100" width="34" height="58" rx="4"/><rect x="293" y="105" width="24" height="11" rx="3"/>',
  sink: '<rect x="214" y="26" width="48" height="16" rx="3"/><circle cx="226" cy="34" r="4.5"/><circle cx="250" cy="34" r="4.5"/>',
  tub: '<rect x="288" y="27" width="34" height="56" rx="12"/><circle cx="305" cy="75" r="3"/>',
  bed: '<rect x="36" y="36" width="84" height="110" rx="4"/><rect x="44" y="44" width="30" height="16" rx="3"/><rect x="82" y="44" width="30" height="16" rx="3"/><path d="M36 72 H120"/>',
};
const planSvg = `<svg class="plan" viewBox="0 0 480 360" aria-hidden="true" focusable="false" data-plan data-rooms='${JSON.stringify(PLAN_ROOMS)}' data-doors='${JSON.stringify(PLAN_DOORS)}'>
  <defs>
    ${PLAN_ROOMS.map((r, i) => `<clipPath id="plan-room-${i}"><rect x="${r.x - 4}" y="${r.y - 4}" width="${r.w + 8}" height="${r.h + 8}"/></clipPath>`).join("\n    ")}
    <mask id="plan-built" maskUnits="userSpaceOnUse" x="-10" y="-10" width="500" height="380">
      ${PLAN_ROOMS.map((r, i) => `<g clip-path="url(#plan-room-${i})"><circle class="plan-reveal" cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" r="0" fill="#fff"/></g>`).join("\n      ")}
    </mask>
  </defs>
  <g class="plan-walls">
    <path d="M20 20 H460 V340 H262 M224 340 H20 V20"/>
    <path d="M200 20 V40 M200 70 V200 M20 200 H90 M120 200 H235 M265 200 H330 V20 M300 200 V210 M300 240 V340"/>
    <path d="M200 90 H250 M280 90 H330 M360 200 H460"/>
  </g>
  <g class="plan-items">
    ${Object.entries(PLAN_ITEMS).map(([name, d]) => `<g class="plan-item" data-item="${name}">${d}</g>`).join("\n    ")}
  </g>
  <g class="plan-marks"></g>
  <g class="plan-rays"></g>
  <g class="plan-fx"></g>
  <g class="plan-eye" transform="translate(62 100) scale(1 1)">
    <circle class="plan-eye-ball" r="10"/>
    <circle class="plan-eye-pupil" r="3.6"/>
  </g>
</svg>`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n) => "$" + (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2));
const sqft = (n) => n.toLocaleString("en-US") + " sq ft";

// Prices are stored as numbers, not prose, so the card text and the
// estimator are worked out from the same figures and can never disagree.
// A tier's price in words: the headline price, its condition, and hosting.
const tierTerms = (t) => {
  const flat = num(t.flat), upTo = num(t.flatUpTo), over = num(t.overRate);
  const rate = num(t.rate), min = num(t.min), hosting = num(t.hosting);
  return {
    hosting,
    amount: flat ? money(flat) : money(rate),
    unit: flat ? "flat" : "/sq ft",
    // The least a job can cost, for "from $159" on phones.
    from: flat ? money(flat) : money(min || rate),
    detail: flat
      ? [upTo ? `Up to ${sqft(upTo)}` : "", over ? `then ${money(over)}/sq ft` : ""].filter(Boolean).join(", ")
      : min ? `${money(min)} minimum` : "",
    host: hosting ? `+ ${money(hosting)}/mo hosting` : t.hostingNote || "",
  };
};

const tiers = (site.tiers || [])
  .map((t) => {
    const { hosting, amount, unit, detail, host } = tierTerms(t);
    const price = `<span class="tier-amount">${amount}</span><span class="tier-unit">${unit}</span>`;
    return `<li class="tier${t.featured ? " tier-featured" : ""}">
        <h3>${esc(t.name)}</h3>
        <p class="tier-includes">${esc(t.includes)}</p>
        <p class="tier-price">${price}</p>
        <ul class="tier-terms">
          ${detail ? `<li>${esc(detail)}</li>` : ""}
          ${host ? `<li>${esc(host)}</li>` : ""}
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
// A subsection of marketing pricing, not a section of its own: it explains
// the choice between the tiers above it.
const compareBlock = compareOptions
  ? `<div class="compare-block" id="compare" aria-labelledby="compare-heading">
          <div class="section-head section-head-stack">
            <h3 id="compare-heading" class="subhead">${esc(compare.heading || "Which tour?")}</h3>
            ${compare.intro ? `<p>${esc(compare.intro)}</p>` : ""}
          </div>
          <div class="compare">
            ${compareOptions}
          </div>
          ${compare.both ? `<p class="compare-both">${esc(compare.both)}</p>` : ""}
        </div>`
  : "";

// A category's small label above its heading.
const kicker = (text) => (text ? `<p class="eyebrow kicker">${esc(text)}</p>` : "");
const pricingHeading = esc(site.pricingHeading || "Pricing");

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
          ${kicker(plans.kicker)}
          <h2 id="plans-heading">${esc(plans.heading || PLANS_PACKAGE)}</h2>
          ${plans.intro ? `<p>${esc(plans.intro)}</p>` : ""}
        </div>
        <div class="plans">
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
            ${choice("purpose", "rental", "Renting it out")}
            ${plans.name ? choice("purpose", "plans", "A renovation or addition") : ""}
          </fieldset>
          <fieldset class="q" data-show="rental" hidden>
            <legend>What kind of rental?</legend>
            ${choice("rental", "long", "Long-term, to tenants")}
            ${choice("rental", "short", "Short-term, like Airbnb or Vrbo")}
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
          <fieldset class="q" data-show="short" hidden>
            <legend>Want a tour for your own booking site and social too? <span class="hint">Airbnb and Vrbo listings are built around photos, so the marketing plan goes in with yours either way.</span></legend>
            ${choice("stay", "yes", "Yes, a branded tour too")}
            ${choice("stay", "no", "No, just the marketing plan")}
          </fieldset>
          <fieldset class="q" data-show="plans" hidden>
            <legend>What do you need drawn?</legend>
            ${choice("need", "asfound", "As-found plans of the building as it is")}
            ${choice("need", "design", "Plans to design changes from")}
          </fieldset>
          <fieldset class="q" data-show="design" hidden>
            <legend>Add to the schematic plan? <span class="hint">A schematic plan of every level is included. Pick any extras, or none.</span></legend>
            ${(plans.addons || []).map(tick).join("\n            ")}
          </fieldset>
          ${tourHosting ? `<fieldset class="q" data-show="design" hidden>
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

// The loader, inlined so the booking page can end its bounce with a wink.
// The status text beside it says what's happening, so it's hidden from
// screen readers here.
const loaderSvg = readFileSync(join(ROOT, "assets/brand/loader.svg"), "utf8")
  .replace(/<!--[\s\S]*?-->\s*/g, "")
  .replace('role="img" aria-label="Loading"', 'class="loader" aria-hidden="true" focusable="false"');

// The hero intro's first sentence, then the rest in a span phones hide.
const ledeHtml = (() => {
  const intro = String(site.intro || "");
  const cut = intro.search(/[.!?]\s/);
  return cut < 0 ? esc(intro) : `${esc(intro.slice(0, cut + 1))}<span class="lede-more"> ${esc(intro.slice(cut + 2))}</span>`;
})();

// Phones get every package as one short list of rows that open up, in place
// of the pricing, comparison and schematic plan sections, which desktop
// keeps. Native <details>, so it works without JavaScript; sharing a name
// makes it an accordion where supported.
const chevron = `<svg class="svc-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const svcRow = ({ name, line, from, body }) => `<details class="svc" name="packages">
          <summary>
            <span class="svc-text"><span class="svc-name">${esc(name)}</span><span class="svc-line">${esc(line)}</span></span>
            <span class="svc-price"><span class="svc-from">from</span>${esc(from)}</span>
            ${chevron}
          </summary>
          <div class="svc-body">
            ${body}
          </div>
        </details>`;
const svcPoints = (items) => (items.length ? `<ul class="svc-points">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
const svcBook = (pkg, label = `Book ${pkg}`) => `<a class="button svc-book" href="book.html?package=${encodeURIComponent(pkg)}">${esc(label)}</a>`;

const tierRows = (site.tiers || []).map((t) => {
  const terms = tierTerms(t);
  // Basic and Pro explain themselves with their comparison points; Complete,
  // which is both, lists what it includes and says why.
  const compared = (compare.options || []).find((o) => o.tag === t.name);
  const both = !compared && (t.deliverables || []).length > 2;
  return svcRow({
    name: t.name,
    line: t.short || (t.deliverables || []).join(" + "),
    from: terms.from,
    body: `<p class="svc-terms"><strong>${terms.amount}${terms.unit === "flat" ? " flat" : terms.unit}</strong>${
              [terms.detail, terms.host.replace(/^\+ /, "")].filter(Boolean).length
                ? `<span>${esc([terms.detail, terms.host.replace(/^\+ /, "")].filter(Boolean).join(" · "))}</span>`
                : ""
            }</p>
            ${both && compare.both ? `<p class="svc-desc">${esc(compare.both)}</p>` : ""}
            ${svcPoints(compared ? compared.points || [] : t.deliverables || [])}
            ${svcBook(t.name)}`,
  });
});

// Schematic plan pricing on phones: one card listing every line with its
// price, open from the start, since each line is a single number.
const plansList = plans.name
  ? (() => {
      const base = priceLabel(plans);
      const rows = [
        [plans.name, `${base.main}${base.unit}`, base.terms],
        ...(plans.addons || []).map((a) => {
          const pr = priceLabel(a, "+");
          const under = [a.per === "changes" ? "of changes" : "", num(a.min) ? `${money(num(a.min))} minimum` : ""].filter(Boolean).join(" · ");
          return [a.name, `${pr.main}${pr.unit === "Quoted" ? "" : "/sq ft"}`, under];
        }),
        ...(tourHosting ? [["Branded Realsee tour", `${money(tourHosting)}/mo`, "hosting"]] : []),
      ];
      return `<div class="plan-list">
          <p class="svc-desc">${esc(plans.includes)}</p>
          <ul class="svc-addons">${rows
            .map(([n, pr, under], i) => `<li${i ? "" : ' class="plan-base"'}><span>${esc(n)}${i ? "" : `<small>Included</small>`}</span><span class="svc-addon-price">${esc(pr)}${under ? `<small>${esc(under)}</small>` : ""}</span></li>`)
            .join("")}</ul>
          ${plans.note ? `<p class="fine">${esc(plans.note)}</p>` : ""}
          ${svcBook(PLANS_PACKAGE, "Book schematic plans")}
        </div>`;
    })()
  : "";

// Placed after the schematic plans section, not beside the builder where
// phones show it: on desktop even a hidden section in between changes which
// section borders apply. On phones the two sections before it (marketing
// pricing and schematic plan pricing) are hidden, so it follows the builder
// anyway.
// On phones, the two kinds of pricing fold away under a dropdown each, so
// Build your job (and, once there is some, the work) leads; each says
// briefly what's inside.
const fromPrice = (t) => num(t.flat) || num(t.min) || num(t.rate);
const tierFrom = Math.min(...(site.tiers || []).map(fromPrice).filter(Boolean));
const drop = (kick, heading, teaser, body, id = "") => `<details class="m-drop">
          <summary>
            <span class="m-drop-text">${kicker(kick)}<span class="m-heading"${id ? ` id="${id}"` : ""}>${heading}</span>${teaser ? `<span class="m-drop-teaser">${esc(teaser)}</span>` : ""}</span>
            ${chevron}
          </summary>
          <div class="m-drop-body">
          ${body}
          </div>
        </details>`;
const packagesSection = `<section class="section m-only" id="packages" aria-labelledby="packages-heading">
      <div class="wrap">
        ${drop(site.pricingKicker, pricingHeading,
          (site.tiers || []).length ? `${site.tiers.length} packages, from ${money(tierFrom)}` : "",
          `<div class="svc-list">
          ${tierRows.join("\n          ")}
          </div>
          ${site.pricingNote ? `<p class="fine">${esc(site.pricingNote)}</p>` : ""}`, "packages-heading")}
        ${plansList ? drop(plans.kicker, esc(plans.heading || PLANS_PACKAGE), num(plans.min) ? `From ${money(num(plans.min))}` : "", plansList) : ""}
      </div>
    </section>`;

/* ---------- shared frame ----------
   On the home page the nav jumps within the page; elsewhere it links back to
   the home page's sections. */
// Link previews (iMessage, Facebook, LinkedIn) need absolute URLs; a relative
// og:image is ignored by most of them. Change siteUrl when a custom domain
// goes live.
const siteUrl = String(site.siteUrl || "").trim().replace(/\/?$/, "/").replace(/^\/$/, "");

// The header's mark: the logo's eye, a dot with its pupil, which floats,
// blinks and glances about (css/style.css).
const brandEye = `<svg class="brand-eye" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><g class="brand-ball"><circle cx="10" cy="10" r="9"/><circle class="brand-pupil" cx="10" cy="9.4" r="2.7"/></g></svg>`;

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
      <a class="brand" href="${home ? "#top" : "index.html"}">${brandEye}${name}</a>
      <nav aria-label="Main">
        <a href="${at}#pricing">${pricingHeading}</a>
        ${plansSection ? `<a href="${at}#plans">${esc(plans.heading || PLANS_PACKAGE)}</a>` : ""}
        ${hasWork ? `<a href="${at}#work">Work</a>` : ""}
        <a href="book.html"${path === "book.html" ? ' aria-current="page"' : ""}>Book</a>
      </nav>
    </div>
  </header>

  <main id="top">
${body}
  </main>

  ${home ? `<section class="mascot" aria-hidden="true">
    <div class="wrap">${loaderSvg}</div>
  </section>` : ""}

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
          <div>
            ${kicker(site.pricingKicker)}
            <h2 id="pricing-heading">${pricingHeading}</h2>
          </div>
          <label class="estimator" hidden>
            <span>Home size</span>
            <input type="number" inputmode="numeric" min="100" step="50" value="1500" data-sqft>
            <span>sq ft</span>
          </label>
        </div>
        <ul class="tiers">
      ${tiers}
        </ul>
        ${site.pricingNote ? `<p class="pricing-note">${esc(site.pricingNote)}</p>` : ""}

        ${compareBlock}
      </div>
    </section>


    ${plansSection}

    ${packagesSection}

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
  .map((t) => `<option value="${esc(t.name)}">${esc(t.name)}: ${esc(t.short || t.includes)}</option>`)
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

        <form class="booking" action="https://formsubmit.co/${esc(email)}" method="POST" data-booking
          data-ajax="https://formsubmit.co/ajax/${esc(email)}" data-mailto="${esc(email)}">
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
                ${plans.name ? `<option value="${PLANS_PACKAGE}">${PLANS_PACKAGE}: ${esc(plans.short || plans.includes)}</option>` : ""}
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
                <option value="Long-term rental">Long-term rental</option>
                <option value="Short-term rental">Short-term rental (Airbnb, Vrbo)</option>
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

          <p><button class="button" type="submit" data-book-send>Send booking request</button></p>
          <div class="sending-screen" role="status" aria-live="polite" hidden data-book-wait>
            <div class="sending-inner">
              ${loaderSvg}
              <p class="sending-title" data-book-status>Sending your request…</p>
              <p class="sending-note" data-book-slow>Please wait. This can take up to a minute, so keep this page open.</p>
            </div>
          </div>
          <div class="send-error" role="alert" hidden data-book-error>
            <p><strong>That didn't go through.</strong> The form service had a problem, so nothing was sent. Your answers are still here. Email them instead, or try again in a minute.</p>
            <p class="send-error-actions"><a class="button" href="#" data-book-mailto>Email this booking</a> <button class="text-link" type="submit">Try again</button></p>
          </div>
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
