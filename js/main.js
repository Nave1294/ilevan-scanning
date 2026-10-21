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

// Pricing estimator: the first invoice for each tier at the size typed in,
// worked out from the same figures the cards print. Hidden without
// JavaScript, where the cards' own terms still give the full price.
const sqftInput = document.querySelector("[data-sqft]");
if (sqftInput) {
  const tiers = document.querySelectorAll(".tier");
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const update = () => {
    const size = Math.max(0, Number(sqftInput.value) || 0);
    tiers.forEach((tier) => {
      const d = Object.fromEntries(Object.entries(tier.dataset).map(([k, v]) => [k, Number(v) || 0]));
      const job = d.flat ? d.flat + Math.max(0, size - d.upTo) * d.over : Math.max(d.min, size * d.rate);
      tier.querySelector("[data-estimate]").textContent = money(job + d.hosting);
    });
  };
  sqftInput.closest(".estimator").hidden = false;
  tiers.forEach((tier) => (tier.querySelector(".tier-estimate").hidden = false));
  sqftInput.addEventListener("input", update);
  update();
}
