// Work dialogs: open from a card, close on the × button, Escape, or a click
// on the backdrop. Tours are only loaded when their dialog opens, so a page
// full of jobs doesn't start a dozen 3D viewers in the background.
document.querySelectorAll("[data-open]").forEach((card) => {
  const dialog = document.getElementById(card.dataset.open);
  if (!dialog || typeof dialog.showModal !== "function") return;

  card.addEventListener("click", () => {
    dialog.querySelectorAll("iframe[data-src]").forEach((frame) => {
      if (!frame.src) frame.src = frame.dataset.src;
    });
    dialog.showModal();
  });

  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
});

// ---------- pricing ----------
// The build writes every price into one JSON block. All three calculators
// (pricing cards, booking form, job builder) quote through quote() below.
const pricing = (() => {
  try {
    return JSON.parse(document.getElementById("pricing").textContent);
  } catch {
    return { tiers: [], plans: null };
  }
})();
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const isPlans = (pkg) => !!pricing.plans && pkg === pricing.plans.name;

// A package at a size, with schematic add-ons and the optional tour.
// One-off cost and monthly hosting are kept apart; anything priced at 0 is
// "quoted" and named rather than added.
const quote = ({ pkg, sqft, addons = [], tour = false }) => {
  if (isPlans(pkg)) {
    const p = pricing.plans;
    const priced = (x) => x.flat || x.rate;
    const cost = (x) => x.flat || Math.max(x.min || 0, x.rate * sqft);
    const chosen = p.addons.filter((a) => addons.includes(a.name));
    const quoted = [...(priced(p) ? [] : ["the schematic plan"]), ...chosen.filter((a) => !priced(a)).map((a) => a.name)];
    const once = (priced(p) ? cost(p) : 0) + chosen.filter(priced).reduce((sum, a) => sum + cost(a), 0);
    return { once, hosting: tour ? p.tourHosting : 0, quoted };
  }
  const t = pricing.tiers.find((x) => x.name === pkg);
  if (!t) return null;
  const once = t.flat ? t.flat + Math.max(0, sqft - t.upTo) * t.over : Math.max(t.min, sqft * t.rate);
  return { once, hosting: t.hosting, quoted: [] };
};

// "First" only when a monthly fee follows, and then the fee is named. The
// first invoice includes the first month of hosting.
const describe = (q, prefix = "Estimated ") => {
  if (!q.once && q.quoted.length) return "Priced by quote once we've seen the property.";
  const first = q.once + q.hosting;
  const label = q.hosting ? `${prefix}first invoice` : `${prefix}invoice`;
  const quoted = q.quoted.length ? ` + quote for ${q.quoted.join(" and ")}` : "";
  const monthly = q.hosting ? ` + ${money(q.hosting)}/mo after first month` : "";
  return `${label.charAt(0).toUpperCase() + label.slice(1)}: ${money(first)}${quoted}${monthly}`;
};

// ---------- pricing cards ----------
// Hidden without JavaScript, where the cards' own terms give the full price.
const sqftInput = document.querySelector("[data-sqft]");
if (sqftInput) {
  const tiers = document.querySelectorAll(".tier");
  const update = () => {
    const sqft = Math.max(0, Number(sqftInput.value) || 0);
    tiers.forEach((tier) => {
      const q = quote({ pkg: tier.querySelector("h3").textContent, sqft });
      if (q) tier.querySelector("[data-estimate]").textContent = money(q.once + q.hosting);
    });
  };
  sqftInput.closest(".estimator").hidden = false;
  tiers.forEach((tier) => (tier.querySelector(".tier-estimate").hidden = false));
  sqftInput.addEventListener("input", update);
  update();
}

// ---------- booking form ----------
const booking = document.querySelector("[data-booking]");
if (booking) {
  // FormSubmit needs an absolute address to return to. Worked out here rather
  // than at build time so it follows the site onto a custom domain. Without
  // JavaScript the field stays empty and FormSubmit shows its own thank-you.
  booking.querySelector("[data-next]").value = new URL("thanks.html", location.href).href;

  const pkg = booking.querySelector("[data-book-package]");
  const size = booking.querySelector("[data-book-sqft]");
  const line = booking.querySelector("[data-book-estimate]");
  const addonsBox = booking.querySelector("[data-addons]");
  const addons = [...booking.querySelectorAll("[data-addon]")];
  const tour = booking.querySelector("[data-tour]");
  const extras = [...addons, ...(tour ? [tour] : [])];

  // Arriving from a pricing card or the job builder:
  // ?package=Pro, plus &sqft=1500&addons=Elevations%20%26%20sections&tour=1.
  const params = new URLSearchParams(location.search);
  const wanted = params.get("package");
  if (wanted && [...pkg.options].some((o) => o.value === wanted)) pkg.value = wanted;
  if (Number(params.get("sqft")) > 0) size.value = Number(params.get("sqft"));
  const wantedAddons = (params.get("addons") || "").split("|");
  addons.forEach((a) => (a.checked = wantedAddons.includes(a.dataset.name)));
  if (tour) tour.checked = params.get("tour") === "1";

  const update = () => {
    const plans = isPlans(pkg.value);
    // Add-ons belong to schematic plans only; untick them when hidden so a
    // tour booking never carries them into the email.
    if (addonsBox) addonsBox.hidden = !plans;
    if (!plans) extras.forEach((x) => (x.checked = false));

    const sqft = Number(size.value) || 0;
    const q = sqft > 0 ? quote({
      pkg: pkg.value,
      sqft,
      addons: addons.filter((a) => a.checked).map((a) => a.dataset.name),
      tour: !!tour?.checked,
    }) : null;
    line.hidden = !q;
    if (q) line.textContent = describe(q);
  };
  extras.forEach((x) => x.addEventListener("change", update));
  pkg.addEventListener("change", update);
  size.addEventListener("input", update);
  update();
}

// ---------- job builder ----------
// Questions appear one at a time as earlier ones are answered. The whole
// section is hidden without JavaScript, since it can't work without it.
const builder = document.querySelector("[data-builder]");
if (builder) {
  builder.hidden = false;
  document.querySelectorAll("[data-builder-link]").forEach((a) => (a.hidden = false));

  const form = builder.querySelector("[data-builder-form]");
  const result = builder.querySelector("[data-builder-result]");
  const val = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const show = (key, on) => form.querySelectorAll(`[data-show="${key}"]`).forEach((f) => (f.hidden = !on));

  // Which package answers the questions, and why, in one line.
  const recommend = () => {
    const purpose = val("purpose");
    if (purpose === "plans") {
      const addons = [...form.querySelectorAll("[data-builder-addon]:checked")].map((x) => x.value);
      const tour = val("tour") === "yes";
      const extras = [...addons.map((a) => a.toLowerCase()), ...(tour ? ["the branded Realsee tour"] : [])];
      return {
        pkg: pricing.plans.name, addons, tour,
        why: `A schematic plan of every level as it stands${extras.length ? `, with ${extras.join(" and ")}` : ""}.`,
      };
    }
    if (val("kind") === "commercial")
      return { pkg: "Pro", why: "Zillow is for homes, so a branded tour is the way to show commercial space, with a marketing plan." };
    return {
      zillow: { pkg: "Basic", why: "A Zillow tour and Zillow plan are all a Zillow listing needs." },
      own: { pkg: "Pro", why: "A branded tour to share on your own website, social and email, with a marketing plan." },
      both: { pkg: "Complete", why: "The Zillow tour and Zillow plan for your Zillow listing, and the branded tour and marketing plan for everywhere else." },
    }[val("where")];
  };

  const update = () => {
    const purpose = val("purpose");
    show("listing", purpose === "listing");
    show("home", purpose === "listing" && val("kind") === "home");
    show("plans", purpose === "plans");
    const answered =
      purpose === "plans" ? !pricing.plans.tourHosting || !!val("tour")
      : purpose === "listing" && (val("kind") === "commercial" || (val("kind") === "home" && !!val("where")));
    show("size", answered);

    const sqft = Number(form.querySelector("[data-builder-sqft]").value) || 0;
    const rec = answered && sqft > 0 ? recommend() : null;
    result.hidden = !rec;
    if (!rec) return;

    result.querySelector("[data-builder-name]").textContent = rec.pkg;
    result.querySelector("[data-builder-why]").textContent = rec.why;
    result.querySelector("[data-builder-estimate]").textContent = describe(quote({ ...rec, sqft }));
    const link = new URLSearchParams({ package: rec.pkg, sqft: String(sqft) });
    if (rec.addons?.length) link.set("addons", rec.addons.join("|"));
    if (rec.tour) link.set("tour", "1");
    const book = result.querySelector("[data-builder-book]");
    book.href = `book.html?${link}`;
    book.textContent = `Book ${rec.pkg}`;
  };
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => e.preventDefault());
}
