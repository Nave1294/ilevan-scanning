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

  const update = () => {
    const option = pkg.selectedOptions[0];
    const sqft = Number(size.value) || 0;
    const known = option && "rate" in option.dataset && sqft > 0;
    line.hidden = !known;
    if (known) line.textContent = `Estimated first invoice: ${money(estimate(option, sqft))}`;
  };
  pkg.addEventListener("change", update);
  size.addEventListener("input", update);
  update();
}
