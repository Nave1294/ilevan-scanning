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

// First invoice for one tier at a given size, from the figures the build
// writes onto each pricing card and package option.
const estimate = (el, size) => {
  const d = Object.fromEntries(Object.entries(el.dataset).map(([k, v]) => [k, Number(v) || 0]));
  const job = d.flat ? d.flat + Math.max(0, size - d.upTo) * d.over : Math.max(d.min, size * d.rate);
  return job + d.hosting;
};
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Pricing estimator. Hidden without JavaScript, where the cards' own terms
// still give the full price.
const sqftInput = document.querySelector("[data-sqft]");
if (sqftInput) {
  const tiers = document.querySelectorAll(".tier");
  const update = () => {
    const size = Math.max(0, Number(sqftInput.value) || 0);
    tiers.forEach((tier) => (tier.querySelector("[data-estimate]").textContent = money(estimate(tier, size))));
  };
  sqftInput.closest(".estimator").hidden = false;
  tiers.forEach((tier) => (tier.querySelector(".tier-estimate").hidden = false));
  sqftInput.addEventListener("input", update);
  update();
}

// Booking form.
const booking = document.querySelector("[data-booking]");
if (booking) {
  // FormSubmit needs an absolute address to return to. Worked out here rather
  // than at build time so it follows the site onto a custom domain. Without
  // JavaScript the field stays empty and FormSubmit shows its own thank-you.
  booking.querySelector("[data-next]").value = new URL("thanks.html", location.href).href;

  const pkg = booking.querySelector("[data-book-package]");
  const size = booking.querySelector("[data-book-sqft]");
  const line = booking.querySelector("[data-book-estimate]");

  // "Book Pro" on a pricing card arrives with ?package=Pro.
  const wanted = new URLSearchParams(location.search).get("package");
  if (wanted && [...pkg.options].some((o) => o.value === wanted)) pkg.value = wanted;

  const addonsBox = booking.querySelector("[data-addons]");
  const addons = [...booking.querySelectorAll("[data-addon]")];

  const update = () => {
    const option = pkg.selectedOptions[0];
    const sqft = Number(size.value) || 0;
    const isPlans = option && "plans" in option.dataset;

    // Add-ons belong to schematic plans only; untick them when hidden so a
    // tour booking never carries them into the email.
    if (addonsBox) addonsBox.hidden = !isPlans;
    if (!isPlans) addons.forEach((a) => (a.checked = false));

    const known = option && "rate" in option.dataset && sqft > 0;
    line.hidden = !known;
    if (!known) return;

    if (isPlans) {
      // A price of 0 means "quoted": named, not added to the total.
      const priced = (el) => Number(el.dataset.flat) || Number(el.dataset.rate);
      const cost = (el) => Number(el.dataset.flat) || Number(el.dataset.rate) * sqft;
      const parts = [option, ...addons.filter((a) => a.checked)];
      const quoted = parts.filter((el) => !priced(el)).map((el) => el.dataset.name || "the drawings");
      const total = (priced(option) ? estimate(option, sqft) : 0) + addons.filter((a) => a.checked && priced(a)).reduce((sum, a) => sum + cost(a), 0);
      line.textContent = !total
        ? "Priced by quote once we've seen the property."
        : `Estimated invoice: ${money(total)}${quoted.length ? ` + quote for ${quoted.join(" and ")}` : ""}`;
      return;
    }

    // "First" only when a monthly hosting fee follows, and then the fee is named.
    const hosting = Number(option.dataset.hosting) || 0;
    line.textContent = hosting
      ? `Estimated first invoice: ${money(estimate(option, sqft))} + ${money(hosting)}/mo after first month`
      : `Estimated invoice: ${money(estimate(option, sqft))}`;
  };
  addons.forEach((a) => a.addEventListener("change", update));
  pkg.addEventListener("change", update);
  size.addEventListener("input", update);
  update();
}
