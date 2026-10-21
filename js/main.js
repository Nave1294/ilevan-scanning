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
    return JSON.parse(document.getElementById("pricing-data").textContent);
  } catch {
    return { tiers: [], plans: null };
  }
})();
// "a", "a and b", "a, b and c".
const listJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const isPlans = (pkg) => !!pricing.plans && pkg === pricing.plans.name;

// A package at a size, with schematic add-ons and the optional tour, as
// itemised lines. `changes` is the square footage of proposed changes, which
// prices any add-on set to "per changes"; everything else goes by the
// building's size. The totals are summed from the lines, so a breakdown and
// its total can't disagree. Anything priced at 0 is "quoted": listed, not
// added. A per-changes add-on with no area yet is "waiting": named, not
// counted at its minimum.
const sqftText = (n) => `${n.toLocaleString("en-US")} sq ft`;
const rateText = (r) => `$${r.toFixed(2)}`;
// One priced item: flat, or area × rate with its minimum.
const priceLine = (label, x, area, areaLabel = "") => {
  if (x.flat) return { label, detail: "Flat", amount: x.flat };
  const raw = area * x.rate;
  const detail = `${sqftText(area)}${areaLabel} × ${rateText(x.rate)}`;
  return x.min && raw < x.min
    ? { label, detail: `${detail} = ${money(raw)}, ${money(x.min)} minimum`, amount: x.min }
    : { label, detail, amount: raw };
};

const quote = ({ pkg, sqft, changes = 0, addons = [], tour = false }) => {
  const lines = [];
  const quoted = [];
  const waiting = [];
  let hosting = 0;

  if (isPlans(pkg)) {
    const p = pricing.plans;
    const priced = (x) => x.flat || x.rate;
    if (priced(p)) lines.push(priceLine(p.base, p, sqft));
    else quoted.push("the schematic plan");
    p.addons.filter((a) => addons.includes(a.name)).forEach((a) => {
      const perChanges = a.per === "changes";
      if (!priced(a)) quoted.push(a.name);
      else if (perChanges && !a.flat && !changes) waiting.push(a.name);
      else lines.push(priceLine(a.name, a, perChanges ? changes : sqft, perChanges ? " of changes" : ""));
    });
    if (tour) hosting = p.tourHosting;
  } else {
    const t = pricing.tiers.find((x) => x.name === pkg);
    if (!t) return null;
    if (t.flat) {
      lines.push({ label: t.name, detail: t.upTo ? `Flat, up to ${sqftText(t.upTo)}` : "Flat", amount: t.flat });
      const over = Math.max(0, sqft - t.upTo);
      if (t.upTo && over && t.over) lines.push({ label: `Over ${sqftText(t.upTo)}`, detail: `${sqftText(over)} × ${rateText(t.over)}`, amount: over * t.over });
    } else {
      lines.push(priceLine(t.name, t, sqft));
    }
    hosting = t.hosting;
  }

  // The first invoice includes the first month of hosting.
  if (hosting) lines.push({ label: "Tour hosting, first month", detail: "", amount: hosting });
  const once = lines.reduce((sum, l) => sum + l.amount, 0) - hosting;
  return { lines, once, hosting, quoted, waiting };
};

// "First" only when a monthly fee follows, and then the fee is named. The
// first invoice includes the first month of hosting.
const describe = (q, prefix = "Estimated ") => {
  if (!q.once && q.quoted.length) return "Priced by quote once we've seen the property.";
  const first = q.once + q.hosting;
  const label = q.hosting ? `${prefix}first invoice` : `${prefix}invoice`;
  const quoted = q.quoted.length ? ` + quote for ${q.quoted.join(" and ")}` : "";
  const monthly = q.hosting ? ` + ${money(q.hosting)}/mo after first month` : "";
  const waiting = q.waiting.length ? `, plus ${q.waiting.join(" and ").toLowerCase()} once you enter the square footage of proposed changes` : "";
  return `${label.charAt(0).toUpperCase() + label.slice(1)}: ${money(first)}${quoted}${monthly}${waiting}`;
};

// The deliverables for a job, as a list: the package's own, or for
// schematic plans the base plan plus whatever was added.
const deliverables = ({ pkg, addons = [], changes = 0, tour = false }) => {
  if (isPlans(pkg)) {
    const p = pricing.plans;
    const perChanges = new Set(p.addons.filter((a) => a.per === "changes").map((a) => a.name));
    return [
      p.base,
      ...p.addons.filter((a) => addons.includes(a.name)).map((a) =>
        perChanges.has(a.name) && changes ? `${a.name} (${changes.toLocaleString("en-US")} sq ft of proposed changes)` : a.name
      ),
      ...(tour ? [`Branded Realsee tour (${money(p.tourHosting)}/mo hosting)`] : []),
    ];
  }
  const t = pricing.tiers.find((x) => x.name === pkg);
  if (!t) return [];
  return [...t.deliverables, ...(t.hosting ? [`Hosting (${money(t.hosting)}/mo)`] : [])];
};

const breakdownText = (q) => q.lines.map((l) => `${l.label}${l.detail ? ` (${l.detail})` : ""}: ${money(l.amount)}`).join("; ");

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
  const kind = booking.querySelector("[data-book-kind]");
  const summary = booking.querySelector("[data-book-summary]");
  const list = booking.querySelector("[data-book-list]");
  const line = booking.querySelector("[data-book-estimate]");
  // Hidden fields, so the email carries the summary the visitor saw.
  const sentDeliverables = booking.querySelector("[data-book-deliverables]");
  const sentEstimate = booking.querySelector("[data-book-estimate-field]");
  const sentBreakdown = booking.querySelector("[data-book-breakdown-field]");
  const subject = booking.querySelector('input[name="_subject"]');
  const addonsBox = booking.querySelector("[data-addons]");
  const addons = [...booking.querySelectorAll("[data-addon]")];
  const tour = booking.querySelector("[data-tour]");
  const extras = [...addons, ...(tour ? [tour] : [])];
  const changesField = booking.querySelector("[data-changes-field]");
  const changes = booking.querySelector("[data-book-changes]");

  // Arriving from a pricing card or the job builder:
  // ?package=Pro, plus &sqft=1500&addons=Elevations%20%26%20sections&tour=1.
  const params = new URLSearchParams(location.search);
  const wanted = params.get("package");
  if (wanted && [...pkg.options].some((o) => o.value === wanted)) pkg.value = wanted;
  if (Number(params.get("sqft")) > 0) size.value = Number(params.get("sqft"));
  const wantedAddons = (params.get("addons") || "").split("|");
  addons.forEach((a) => (a.checked = wantedAddons.includes(a.dataset.name)));
  if (tour) tour.checked = params.get("tour") === "1";
  if (changes && Number(params.get("changes")) > 0) changes.value = Number(params.get("changes"));
  const kinds = { home: "Home", commercial: "Commercial or mixed-use" };
  if (kind && kinds[params.get("kind")]) kind.value = kinds[params.get("kind")];

  const update = () => {
    const plans = isPlans(pkg.value);
    // Add-ons belong to schematic plans only; untick them when hidden so a
    // tour booking never carries them into the email.
    if (addonsBox) addonsBox.hidden = !plans;
    if (!plans) extras.forEach((x) => (x.checked = false));

    // The changes area is asked for, and required, only while an add-on
    // priced on it is ticked. Disabled when hidden, so it isn't sent empty.
    if (changesField) {
      const needed = addons.some((a) => a.checked && "perChanges" in a.dataset);
      changesField.hidden = !needed;
      changes.disabled = !needed;
      changes.required = needed;
    }

    const sqft = Number(size.value) || 0;
    const job = {
      pkg: pkg.value,
      sqft,
      addons: addons.filter((a) => a.checked).map((a) => a.dataset.name),
      changes: changes && !changes.disabled ? Number(changes.value) || 0 : 0,
      tour: !!tour?.checked,
    };
    const items = deliverables(job);
    const q = sqft > 0 ? quote(job) : null;

    summary.hidden = !items.length;
    list.replaceChildren(...items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    line.hidden = !q;
    if (q) line.textContent = describe(q);

    sentDeliverables.value = items.join("; ") || (pkg.value === "Not sure" ? "Not sure yet" : "");
    sentEstimate.value = q ? describe(q, "") : "";
    sentBreakdown.value = q ? breakdownText(q) : "";
    // "New booking: Pro, 1,500 sq ft" reads at a glance in the inbox.
    subject.value = ["New booking", [pkg.value, sqft ? `${sqft.toLocaleString("en-US")} sq ft` : ""].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(": ");
  };
  extras.forEach((x) => x.addEventListener("change", update));
  pkg.addEventListener("change", update);
  size.addEventListener("input", update);
  changes?.addEventListener("input", update);
  // One last pass on submit, so the email can never carry a stale summary.
  booking.addEventListener("submit", update);
  update();

  // Send in the background rather than leaving the page, so a failure at
  // the form service doesn't strand the visitor on its error page with
  // their booking lost. On failure, the same answers can go by email
  // instead. Without JavaScript the form still posts the ordinary way.
  const send = booking.querySelector("[data-book-send]");
  const wait = booking.querySelector("[data-book-wait]");
  const slowNote = booking.querySelector("[data-book-slow]");
  const status = booking.querySelector("[data-book-status]");

  // Done: the dot stops bouncing, settles back on its i and winks, then on
  // to the thank-you page. If the browser can't animate, it just goes.
  const wink = async () => {
    const dot = wait.querySelector(".ilv-dot");
    const stem = wait.querySelector(".ilv-stem");
    if (!dot || !dot.animate) return;
    const from = getComputedStyle(dot).transform;
    dot.style.animation = stem.style.animation = "none";
    await dot.animate([{ transform: from === "none" ? "none" : from }, { transform: "none" }], { duration: 260, easing: "ease-out" }).finished;
    dot.style.transformOrigin = "50% 50%";
    await dot.animate(
      [{ transform: "none" }, { transform: "scale(1.08, 0.1)", offset: 0.4 }, { transform: "scale(1.08, 0.1)", offset: 0.55 }, { transform: "none" }],
      { duration: 520, easing: "ease-in-out" }
    ).finished;
    await new Promise((r) => setTimeout(r, 180));
  };
  const failed = booking.querySelector("[data-book-error]");
  const mailto = booking.querySelector("[data-book-mailto]");
  if (booking.dataset.ajax && window.fetch) {
    booking.addEventListener("submit", async (e) => {
      e.preventDefault();
      failed.hidden = true;
      // Disabled while sending, so an impatient second tap can't book twice.
      send.disabled = true;
      send.textContent = "Sending…";
      // The bouncing logo shows at once. FormSubmit sends the email before
      // it answers, which can take a while, so after a moment say so too.
      wait.hidden = false;
      slowNote.hidden = true;
      status.textContent = "Sending your request…";
      const slow = setTimeout(() => (slowNote.hidden = false), 3000);
      const data = new FormData(booking);
      let ok = false;
      try {
        const res = await fetch(booking.dataset.ajax, { method: "POST", body: data, headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        ok = res.ok && String(body.success) === "true";
      } catch {
        ok = false;
      }
      clearTimeout(slow);
      if (ok) {
        // Coming back with the Back button restores this page as it was
        // left, mid-wink; reset it to a fresh form.
        addEventListener("pageshow", (ev) => ev.persisted && location.reload(), { once: true });
        slowNote.hidden = true;
        status.textContent = "Sent!";
        await wink().catch(() => {});
        location.href = booking.querySelector("[data-next]").value || "thanks.html";
        return;
      }
      // Everything the visitor filled in, as a ready-to-send email. Fields
      // starting with _ are the form service's settings, not answers.
      const lines = [...data.entries()].filter(([k, v]) => !k.startsWith("_") && String(v).trim()).map(([k, v]) => `${k}: ${v}`);
      mailto.href = `mailto:${booking.dataset.mailto}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(lines.join("\n"))}`;
      wait.hidden = true;
      failed.hidden = false;
      send.disabled = false;
      send.textContent = "Send booking request";
      failed.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
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
      const changes = Number(form.querySelector("[data-builder-changes]")?.value) || 0;
      const tour = val("tour") === "yes";
      const perChanges = new Set(pricing.plans.addons.filter((a) => a.per === "changes").map((a) => a.name));
      const extras = [
        ...addons.map((a) => (perChanges.has(a) ? `a ${a.toLowerCase()} for ${changes.toLocaleString("en-US")} sq ft of changes` : a.toLowerCase())),
        ...(tour ? ["the branded Realsee tour"] : []),
      ];
      return {
        pkg: pricing.plans.name, addons, tour, changes,
        why: `A schematic plan of every level as it stands${extras.length ? `, with ${listJoin(extras)}` : ""}.`,
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
    // A second size, for the proposed changes, only when an add-on priced
    // on it is ticked; the result waits until it's filled in.
    const needsChanges = purpose === "plans" && !!form.querySelector("[data-builder-addon][data-per-changes]:checked");
    show("changes", answered && needsChanges);
    const changes = Number(form.querySelector("[data-builder-changes]")?.value) || 0;

    const sqft = Number(form.querySelector("[data-builder-sqft]").value) || 0;
    const rec = answered && sqft > 0 && (!needsChanges || changes > 0) ? recommend() : null;
    result.hidden = !rec;
    if (!rec) return;

    result.querySelector("[data-builder-name]").textContent = rec.pkg;
    result.querySelector("[data-builder-why]").textContent = rec.why;
    const q = quote({ ...rec, sqft });
    const cell = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text, className: cls || "" });
    const rows = q.lines.map((l) => {
      const tr = document.createElement("tr");
      const what = cell("th", l.label);
      what.scope = "row";
      if (l.detail) what.append(cell("span", l.detail, "breakdown-detail"));
      tr.append(what, cell("td", money(l.amount)));
      return tr;
    });
    const total = document.createElement("tr");
    total.className = "breakdown-total";
    total.append(cell("th", q.hosting ? "First invoice" : "Invoice"), cell("td", money(q.once + q.hosting)));
    total.firstChild.scope = "row";
    result.querySelector("[data-builder-breakdown]").replaceChildren(...rows, total);
    // Under the table, only what the table can't show: the monthly fee
    // and anything quoted separately.
    const after = [
      ...(q.hosting ? [`Then ${money(q.hosting)}/mo hosting.`] : []),
      ...(q.quoted.length ? [`Plus a quote for ${listJoin(q.quoted)}.`] : []),
    ];
    const note = result.querySelector("[data-builder-estimate]");
    note.textContent = after.join(" ");
    note.hidden = !after.length;
    const link = new URLSearchParams({ package: rec.pkg, sqft: String(sqft) });
    if (rec.addons?.length) link.set("addons", rec.addons.join("|"));
    if (rec.tour) link.set("tour", "1");
    if (needsChanges) link.set("changes", String(changes));
    if (purpose === "listing" && val("kind")) link.set("kind", val("kind"));
    const book = result.querySelector("[data-builder-book]");
    book.href = `book.html?${link}`;
    book.textContent = `Book ${rec.pkg}`;
  };
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => e.preventDefault());
}
