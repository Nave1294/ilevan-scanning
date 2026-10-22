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

// ---------- the loader's personality ----------
// On the booking page the loader is inlined, and while a request sends its
// dot becomes an eye: a white pupil appears, and the eye sits on the i or
// the l for a while, shows how it feels through where it looks and how it
// moves, then leaps to the other perch. Sends can take up to a minute, so
// it takes its time. When the send succeeds it floats back to its place in
// the logo, winks, and the pupil goes. The SVG keeps its own steady CSS
// loop for anywhere it's a plain image; with reduced motion, or without the
// Web Animations API, that's what shows.
// `roam`, if given, says how far it may run along the ground: a function
// returning { left, right } as the furthest offsets (in the drawing's units)
// the eye can reach while staying on screen. Without it, runs stay short.
const character = (svg, { roam } = {}) => {
  const q = (sel) => svg.querySelector(sel);
  const X = q(".ilv-x"), Y = q(".ilv-y"), hover = q(".ilv-hover"), dot = q(".ilv-dot"), stem = q(".ilv-stem"), bar = q(".ilv-bar");
  const eye = q(".ilv-eye"), pupil = q(".ilv-pupil");
  const parts = [X, Y, hover, dot, stem, bar, eye, pupil];
  // Perches, matching the offsets documented in loader.svg. `sink` is how
  // far the eye rides down with what it lands on as that gives.
  const PERCH = {
    i: { x: 0, y: 243, under: stem, give: "scaleY(0.93)", sink: 84 },
    l: { x: 575, y: -313, under: bar, give: "scaleY(0.96)", sink: 70 },
  };
  // How far the pupil can travel inside the eye before it touches the edge.
  const REACH = 62;
  const able = !!svg.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let running = false;
  let on = "i";
  let lastMood = "";

  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // One animation, run to its end and kept there as inline style. Resolves
  // quietly if it's cancelled partway.
  const play = (el, frames, opts) => {
    const a = el.animate(frames, { fill: "forwards", ...opts });
    return a.finished.then(
      () => {
        const last = frames[frames.length - 1];
        if (last.transform) el.style.transform = last.transform;
        if (last.opacity !== undefined) el.style.opacity = last.opacity;
        a.cancel();
      },
      () => {}
    );
  };
  // The eye squashes from its base, but blinks and wobbles about its middle.
  const fromBase = () => (dot.style.transformOrigin = "50% 100%");
  const fromMiddle = () => (dot.style.transformOrigin = "50% 50%");
  const at = (p) => ({ x: `translateX(${p.x}px)`, y: `translateY(${p.y}px)` });
  const look = (x, y, extra = "") => `translate(${x}px, ${y}px)${extra}`;
  // Which way the other perch is: +1 to the right, -1 to the left.
  const across = () => (on === "i" ? 1 : -1);

  // Where the eye is now, as offsets from its place in the logo.
  let cx = 0, cy = PERCH.i.y;
  const tx = (v) => `translateX(${v}px)`;
  const ty = (v) => `translateY(${v}px)`;

  // Squash on arrival. Against the ground or a letter top it squashes
  // downward (and sinks with a letter that gives); against a wall it
  // flattens sideways towards that wall.
  const squash = ({ under = null, give = "", sink = 0, wall = 0 } = {}) => {
    if (wall) {
      dot.style.transformOrigin = wall > 0 ? "100% 50%" : "0% 50%";
      return play(dot, [{ transform: "none" }, { transform: "scale(0.74, 1.14)", offset: 0.4 }, { transform: "none" }], { duration: 300, easing: "ease-out" });
    }
    fromBase();
    return Promise.all([
      play(dot, [{ transform: "scale(0.88, 1.14)" }, { transform: `translateY(${sink}px) scale(1.3, 0.7)`, offset: 0.35 }, { transform: "scale(1.08, 0.92)", offset: 0.7 }, { transform: "none" }], { duration: 420, easing: "ease-out" }),
      under && play(under, [{ transform: "none" }, { transform: give, offset: 0.35, easing: "cubic-bezier(0.3, 1.6, 0.5, 1)" }, { transform: "none" }], { duration: 420 }),
    ]);
  };

  // A leap to (x, y): crouch, arc over a peak `rise` above the higher end,
  // arrive. Time up and time down follow the square root of each drop, as
  // under gravity. `across` times the sideways travel: "even", "early" (get
  // clear of a letter before dropping past it) or "late" (rise clear of one
  // before moving over it).
  const leap = async (x, y, { rise = 260, ms = 720, across = "even", crouch = true, arrive = {} } = {}) => {
    const peak = Math.min(cy, y) - rise;
    const up = Math.sqrt(cy - peak), down = Math.sqrt(y - peak);
    const top = up / (up + down || 1);
    if (crouch) {
      fromBase();
      await play(dot, [{ transform: "none" }, { transform: "scale(1.18, 0.82)" }], { duration: 220, easing: "ease-out" });
    }
    const xFrames = {
      even: [{ transform: tx(cx) }, { transform: tx(x) }],
      early: [{ transform: tx(cx) }, { transform: tx(x), offset: 0.4 }, { transform: tx(x) }],
      late: [{ transform: tx(cx) }, { transform: tx(cx), offset: 0.55 }, { transform: tx(x) }],
    }[across];
    await Promise.all([
      play(X, xFrames, { duration: ms, easing: across === "even" ? "linear" : "ease-in-out" }),
      play(Y, [
        { transform: ty(cy), easing: "cubic-bezier(0.2, 0.6, 0.35, 1)" },
        { transform: ty(peak), offset: top, easing: "cubic-bezier(0.65, 0, 0.8, 0.4)" },
        { transform: ty(y) },
      ], { duration: ms }),
      play(dot, [{ transform: "scale(0.86, 1.16)" }, { transform: "none", offset: 0.3 }, { transform: "none", offset: 0.8 }, { transform: "scale(0.88, 1.14)" }], { duration: ms }),
    ]);
    cx = x; cy = y;
    await squash(arrive);
  };
  const onto = (name) => ({ under: PERCH[name].under, give: PERCH[name].give, sink: PERCH[name].sink });

  // The plain leap between the two letters.
  const jump = async () => {
    const to = on === "i" ? "l" : "i";
    await leap(PERCH[to].x, PERCH[to].y, { rise: 265, arrive: onto(to) });
    on = to;
  };

  // Shuffling along a wall or the ground: a few short moves, each a little
  // squash and stretch.
  const step = (x, y, ms) =>
    Promise.all([
      play(X, [{ transform: tx(cx) }, { transform: tx(x) }], { duration: ms, easing: "ease-in-out" }),
      play(Y, [{ transform: ty(cy) }, { transform: ty(y) }], { duration: ms, easing: "ease-in-out" }),
      (fromBase(), play(dot, [{ transform: "none" }, { transform: "scale(1.06, 0.94)", offset: 0.5 }, { transform: "none" }], { duration: ms })),
    ]).then(() => { cx = x; cy = y; });
  // A running stride: a quick low hop along the ground.
  const stride = (x, ms = 230) =>
    Promise.all([
      play(X, [{ transform: tx(cx) }, { transform: tx(x) }], { duration: ms, easing: "linear" }),
      play(Y, [{ transform: ty(cy), easing: "ease-out" }, { transform: ty(cy - 70), offset: 0.5, easing: "ease-in" }, { transform: ty(cy) }], { duration: ms }),
      (fromBase(), play(dot, [{ transform: "scale(1.1, 0.9)" }, { transform: "scale(0.94, 1.06)", offset: 0.5 }, { transform: "scale(1.1, 0.9)" }], { duration: ms })),
    ]).then(() => { cx = x; });
  const lookTo = (x, y, ms = 400) => play(pupil, [{ transform: pupil.style.transform || "none" }, { transform: x || y ? look(x, y) : "none" }], { duration: ms, easing: "ease-in-out" });
  const tremble = (ms) => {
    fromMiddle();
    const n = 14;
    return play(dot, Array.from({ length: n + 1 }, (_, k) => ({ transform: k === n ? "none" : `translateX(${k % 2 ? 7 : -7}px)` })), { duration: ms, easing: "linear" });
  };

  // Where things are, as offsets (the logo's dot is centred at 155, 158,
  // radius 155): the bar's far side is at x 835, so the eye hugging it is
  // centred 155 further out; the gap between the letters runs from x 265 to
  // 625; the ground, at the letters' foot, is y 1752.
  const GROUND = 1752 - 155 - 158;
  const FAR_WALL = 835;
  const GAP = { mid: 290, leftWall: 265, rightWall: 315 };
  // Where it lands hopping down outside a letter (further out on the i's
  // side when there's a hoop on it).
  const OUTSIDE = { i: -268, l: 845 };

  // ---- The yard: things on the ground, when there's room to roam ----
  // Set out once the eye first starts and the screen's width is known, in
  // the drawing's units. On the i's side: a basketball hoop hung on the i
  // and its ball, a crate, and a patch of ice with a fishing hole. On the
  // l's side: a football and, at the far end, three bowling pins. Short of
  // room, it packs a little closer. Footprints are x
  // ranges; the eye's x offset is its left edge, so it overlaps something
  // when x + 310 > x0 and x < x1.
  const FLOOR = 1752;
  let props = [], balls = [], ball = null, bball = null, hoop = null, ice = null, pins = null, gear = null, fish = null;
  // How far the eye goes on a run: inside the column, short of the ice and
  // the bowling lane.
  let walk = null;
  let yard = null;
  const SVGNS = "http://www.w3.org/2000/svg";
  const draw = (tag, attrs, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    parent.append(el);
    return el;
  };
  // Balls, the fish and the pins are drawn about their own origin and put
  // in place with a transform, so they can move, spin and fall over.
  const pose = (x, y, spin = 0) => `translate(${x}px, ${y}px) rotate(${spin}deg)`;
  const put = (o) => (o.el.style.transform = pose(o.x, o.y, o.spin));
  const makeBall = (layer, cls, x, r, seams, range) => {
    const el = draw("g", { class: `ilv-ball ${cls}` }, layer);
    draw("circle", { cx: 0, cy: 0, r }, el);
    draw("path", { d: seams }, el);
    const b = { el, x, y: FLOOR - r, r, spin: 0, lo: range[0] + r, hi: range[1] - r, carried: false };
    put(b);
    balls.push(b);
    return b;
  };

  const setUpYard = () => {
    const { left, right, runs } = roam();
    const letters = svg.querySelector(":scope > g");
    const layer = () => svg.insertBefore(draw("g", { class: "ilv-yard" }, svg), letters);
    // Behind the balls, the balls (and the fish), and in front of them.
    yard = { back: layer(), mid: layer(), front: layer() };

    // The i's side. With room, the hoop goes on the i, and the eye hops
    // down further out so it never drops through the rim.
    if (OUTSIDE.i - 120 - left > 1500) {
      OUTSIDE.i = -560;
      const y = 1060, x0 = -215, x1 = 40;
      draw("rect", { class: "ilv-board", x: 18, y: y - 300, width: 40, height: 360, rx: 6 }, yard.back);
      draw("path", { class: "ilv-board", d: `M52 ${y - 130} L14 ${y}` }, yard.back);
      const tops = [-205, -127, -48, 30], bottoms = [-168, -112, -58, -4], h = 180;
      const net = draw("path", {
        class: "ilv-net",
        d: [`M${tops[0]} ${y} L${bottoms[0]} ${y + h}`, `M${tops[3]} ${y} L${bottoms[3]} ${y + h}`,
          ...tops.slice(0, 3).map((t, k) => `M${t} ${y} L${bottoms[k + 1]} ${y + h} M${tops[k + 1]} ${y} L${bottoms[k]} ${y + h}`)].join(" "),
      }, yard.front);
      net.style.transformOrigin = `${(x0 + x1) / 2}px ${y}px`;
      const rim = draw("line", { class: "ilv-rim", x1: x0, y1: y, x2: x1, y2: y }, yard.front);
      hoop = { x: (x0 + x1) / 2, x0, y, net, rim };
    }
    // Beyond the hoop, its ball's resting place and the spot it shoots
    // from; then, given room, the crate; then the ice, closer in if there's
    // no crate.
    const L = [left, OUTSIDE.i - 120];
    const room = L[1] - L[0];
    const rest = L[1] - 320, spot = rest - 95 - 318;
    if (hoop && room > 2200) {
      const x1 = spot - 240, x0 = x1 - 300, top = FLOOR - 300;
      props.push({ x0, x1, top });
      const g = draw("g", { class: "ilv-prop" }, yard.back);
      draw("rect", { x: x0, y: top, width: 300, height: 300, rx: 14 }, g);
      draw("path", { d: `M${x0 + 30} ${top + 30} L${x0 + 270} ${FLOOR - 30} M${x0 + 270} ${top + 30} L${x0 + 30} ${FLOOR - 30}` }, g);
    }
    if (hoop && room > 1420) {
      // Out at the far end, given room; otherwise as near as it fits.
      const rx = 300, x = Math.min(L[0] + rx + 100, (props.length ? props[0].x0 - 300 : spot - 60) - rx);
      const g = draw("g", { class: "ilv-ice" }, yard.back);
      draw("ellipse", { cx: x, cy: FLOOR, rx, ry: 42 }, g);
      draw("path", { class: "ilv-crack", d: `M${x - 230} ${FLOOR - 6} l60 10 l40 -8 M${x + 140} ${FLOOR + 14} l50 -10 l40 6` }, g);
      draw("ellipse", { class: "ilv-hole", cx: x, cy: FLOOR, rx: 82, ry: 17 }, g);
      ice = { x, x0: x - rx, x1: x + rx };
      fish = { el: draw("g", { class: "ilv-fish" }, yard.mid), x, y: FLOOR + 40, spin: 0 };
      draw("ellipse", { cx: 0, cy: 0, rx: 62, ry: 30 }, fish.el);
      draw("path", { d: "M50 0 L100 -32 L100 32 Z" }, fish.el);
      draw("circle", { class: "ilv-fish-eye", cx: -30, cy: -6, r: 7 }, fish.el);
      fish.el.style.opacity = 0;
      put(fish);
      // The rod and line ride with the eye, on its float layer, behind it.
      // The tip sits right over the hole when the eye stands 120 to its right.
      const tip = { x: -120, y: -160 }, bob = FLOOR - GROUND - 14;
      const rod = draw("line", { class: "ilv-rod", x1: 70, y1: 210, x2: tip.x, y2: tip.y }, hover);
      const line = draw("line", { class: "ilv-line", x1: tip.x, y1: tip.y, x2: tip.x, y2: bob }, hover);
      const bobber = draw("circle", { class: "ilv-bobber", cx: tip.x, cy: bob, r: 22 }, hover);
      [rod, line, bobber].forEach((el) => hover.insertBefore(el, dot));
      rod.style.transformOrigin = "70px 210px";
      rod.style.transform = "scale(0)";
      line.style.transformOrigin = `${tip.x}px ${tip.y}px`;
      line.style.transform = "scaleY(0)";
      bobber.style.opacity = 0;
      gear = { rod, line, bobber, length: bob - tip.y };
    }
    if (hoop) {
      const r = 95;
      bball = makeBall(yard.mid, "ilv-bball", rest, r,
        `M${-r} 0 H${r} M0 ${-r} V${r} M${-0.72 * r} ${-0.69 * r} Q${-0.25 * r} 0 ${-0.72 * r} ${0.69 * r} M${0.72 * r} ${-0.69 * r} Q${0.25 * r} 0 ${0.72 * r} ${0.69 * r}`,
        [ice ? ice.x1 + 40 : L[0], L[1]]);
      bball.rest = rest;
      hoop.spot = spot;
    }

    // The l's side: the bowling lane at the far end, and the football
    // between it and the letters, kept clear of the lane. Short of room
    // (phones), a shorter run-up, the pins closer together and the ball
    // nearer the letters.
    const R = [OUTSIDE.l + 310 + 120, right + 310], wide = R[1] - R[0] > 2800;
    if (R[1] - R[0] > 2240) {
      const x0 = R[1] - 500, gap = wide ? 105 : 80, xs = [x0, x0 + gap, x0 + 2 * gap];
      const els = xs.map((x) => {
        const el = draw("g", { class: "ilv-pin" }, yard.back);
        // About its base's right-hand corner, so it topples to the right.
        const c = -18;
        draw("path", { d: `M${c - 18} 0 C${c - 40} -50 ${c - 40} -110 ${c - 20} -145 C${c - 12} -160 ${c - 13} -178 ${c - 15} -192 C${c - 18} -222 ${c + 18} -222 ${c + 15} -192 C${c + 13} -178 ${c + 12} -160 ${c + 20} -145 C${c + 40} -110 ${c + 40} -50 ${c + 18} 0 Z` }, el);
        draw("path", { class: "ilv-stripe", d: `M${c - 13} -168 H${c + 13}` }, el);
        el.style.transform = pose(x + 18, FLOOR);
        return el;
      });
      pins = { xs, els, start: x0 - (wide ? 1040 : 840) };
    }
    if (R[1] - R[0] > 1100) {
      const r = 110, x = R[0] + (pins && !wide ? 350 : Math.min(500, (R[1] - R[0]) * 0.25));
      ball = makeBall(yard.mid, "ilv-football", x, r, `M${-r} 0 Q0 -70 ${r} 0 M0 ${-r} Q60 0 0 ${r}`,
        [R[0] + 150, pins ? pins.start - 340 : R[1] - 450]);
      ball.kick = true;
    }
    // Runs stop short of the ice and the lane, and of `runs` if given, so
    // only fishing and bowling go out to the yard's far ends.
    walk = {
      left: Math.max(ice ? ice.x1 + 40 : left, runs?.left ?? -Infinity),
      right: Math.min(pins ? pins.start : right, runs?.right ?? Infinity),
    };
  };

  const propAt = (x) => props.find((p) => x + 310 > p.x0 && x < p.x1);
  const onTopOf = (p) => p.top - 155 - 158;
  const onGround = () => cy >= GROUND - 5;
  const ballAt = (x) => balls.find((b) => !b.carried && x + 310 > b.x - b.r && x < b.x + b.r);

  // Rolling a ball: away it goes, spinning, until it nears the end of its
  // stretch of ground or meets a prop.
  const roll = async (b, dir, distance) => {
    let to = Math.max(b.lo, Math.min(b.hi, b.x + dir * distance));
    for (const p of props) {
      if (dir > 0 && p.x0 >= b.x + b.r) to = Math.min(to, p.x0 - b.r);
      if (dir < 0 && p.x1 <= b.x - b.r) to = Math.max(to, p.x1 + b.r);
    }
    const moved = to - b.x;
    if (Math.abs(moved) < 40) return false;
    const spin = b.spin + (moved / b.r) * (180 / Math.PI);
    await play(b.el, [{ transform: pose(b.x, b.y, b.spin) }, { transform: pose(to, b.y, spin) }], { duration: 450 + Math.abs(moved) * 0.6, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)" });
    b.x = to;
    b.spin = spin;
    return true;
  };
  // Through the air to (x, y) over a peak, as under gravity, turning as it
  // goes. Works for anything posed with put(): balls, the fish.
  const toss = (o, x, y, peak, ms, turn = 0) => {
    const x0 = o.x, y0 = o.y, s0 = o.spin;
    const up = Math.sqrt(Math.max(0, y0 - peak)), down = Math.sqrt(Math.max(0, y - peak));
    const tp = up / (up + down || 1);
    const frames = Array.from({ length: 21 }, (_, k) => {
      const t = k / 20;
      const h = t < tp ? peak + (y0 - peak) * ((tp - t) / tp) ** 2 : peak + (y - peak) * ((t - tp) / (1 - tp || 1)) ** 2;
      return { transform: pose(x0 + (x - x0) * t, h, s0 + turn * t) };
    });
    Object.assign(o, { x, y, spin: s0 + turn });
    return play(o.el, frames, { duration: ms, easing: "linear" });
  };
  // A kick: a lunge at the ball as it rolls off.
  const kick = (b, dir, distance = rand(700, 1300)) => {
    fromBase();
    return Promise.all([
      play(dot, [{ transform: "none" }, { transform: `translateX(${dir * 50}px) scale(1.16, 0.86)`, offset: 0.35 }, { transform: "none" }], { duration: 360, easing: "ease-out" }),
      sleep(110).then(() => roll(b, dir, distance)),
    ]);
  };
  // Over a ball, landing on the ground or a prop beyond it.
  const hopOver = async (b, dir) => {
    const x = dir > 0 ? b.x + b.r + 20 : b.x - b.r - 310 - 20;
    const p = propAt(x);
    await leap(x, p ? onTopOf(p) : GROUND, { rise: 230, ms: 620, crouch: true });
  };

  // Moving along the ground to x: up onto a prop in the way, along its top,
  // down off the far end, and a ball knocked ahead (the football) or hopped
  // over (the basketball). Steps never overshoot x.
  const moveTo = async (x, ms = 230, length = 260) => {
    for (let guard = 0; guard < 300 && Math.abs(x - cx) > 2; guard++) {
      const dir = Math.sign(x - cx);
      let next = cx + dir * Math.min(length, Math.abs(x - cx));
      const standingOn = onGround() ? null : propAt(cx);
      const ahead = propAt(next);
      if (!standingOn && ahead) {
        next = Math.max(ahead.x0 - 60, Math.min(ahead.x1 - 250, next));
        await leap(next, onTopOf(ahead), { rise: 140, ms: 460, crouch: false });
        continue;
      }
      if (standingOn && !(next + 155 > standingOn.x0 && next + 155 < standingOn.x1)) {
        next = dir > 0 ? Math.max(next, standingOn.x1 + 10) : Math.min(next, standingOn.x0 - 320);
        await leap(next, GROUND, { rise: 100, ms: 480, crouch: false });
        continue;
      }
      const b = onGround() && ballAt(next);
      if (b) {
        if (!(b.kick && (await kick(b, dir, rand(500, 900)))[1])) await hopOver(b, dir);
        continue;
      }
      await stride(next, ms);
    }
  };

  // A ball on the eye's head: it rides along on the float layer, sitting
  // just into the top of the eye.
  const carry = (b) => {
    b.carried = true;
    hover.insertBefore(b.el, dot);
    Object.assign(b, { x: 155, y: 9 - b.r });
    put(b);
  };
  const letGo = (b) => {
    b.carried = false;
    yard.mid.append(b.el);
    Object.assign(b, { x: cx + 155, y: cy + 9 - b.r });
    put(b);
  };
  // Flicked up off the ground and caught on its head.
  const scoop = async (b) => {
    fromBase();
    await play(dot, [{ transform: "none" }, { transform: "scale(1.15, 0.85)" }], { duration: 200, easing: "ease-out" });
    const x = cx + 155, y = cy + 9 - b.r;
    await Promise.all([
      play(dot, [{ transform: "scale(1.15, 0.85)" }, { transform: "scale(0.9, 1.1)", offset: 0.3 }, { transform: "none" }], { duration: 500 }),
      toss(b, x, y, y - 380, 700, Math.sign(x - b.x) * 200),
    ]);
    carry(b);
    await squash();
  };
  // Keepy-uppy on its head.
  const headers = async (b, n) => {
    for (let k = 0; k < n; k++) {
      fromBase();
      await Promise.all([
        play(dot, [{ transform: "none" }, { transform: "scale(1.12, 0.88)", offset: 0.12 }, { transform: "scale(0.94, 1.06)", offset: 0.25 }, { transform: "none", offset: 0.45 }, { transform: "none", offset: 0.9 }, { transform: "scale(1.08, 0.92)" }], { duration: 700 }),
        toss(b, b.x, b.y, b.y - 220, 700, 120),
      ]);
    }
    await squash();
  };
  // A little celebration on the spot: pupil wide, two or three bounces.
  const cheer = async (n = 2) => {
    await play(pupil, [{ transform: pupil.style.transform || "none" }, { transform: look(0, -14, " scale(1.4)") }], { duration: 250 });
    for (let k = 0; k < n; k++) await leap(cx, cy, { rise: 160, ms: 420, crouch: k === 0 });
    await play(pupil, [{ transform: look(0, -14, " scale(1.4)") }, { transform: "none" }], { duration: 250 });
  };
  // Aww: a sag, eyes down.
  const aww = () => {
    fromBase();
    return Promise.all([
      play(pupil, [{ transform: pupil.style.transform || "none" }, { transform: look(0, 42), offset: 0.3 }, { transform: look(0, 42), offset: 0.8 }, { transform: "none" }], { duration: 1600, easing: "ease-in-out" }),
      play(dot, [{ transform: "none" }, { transform: "scale(1.08, 0.82)", offset: 0.35 }, { transform: "scale(1.08, 0.82)", offset: 0.8 }, { transform: "none" }], { duration: 1600, easing: "ease-in-out" }),
    ]);
  };
  // Down off a letter to the ground outside it, and back up.
  const hopDown = async (perch) => {
    if (on !== perch) await jump();
    await eyeOpen();
    await lookTo((perch === "i" ? -1 : 1) * REACH, 45, 400);
    await leap(OUTSIDE[perch], GROUND, { rise: 120, ms: 820, across: "early" });
  };
  const goHome = async (perch) => {
    await lookTo((perch === "i" ? 1 : -1) * REACH, 0, 250);
    await moveTo(OUTSIDE[perch], 230);
    await lookTo(0, -REACH, 400);
    await sleep(250);
    await leap(PERCH[perch].x, PERCH[perch].y, { rise: 180, ms: 950, across: "late", arrive: onto(perch) });
    on = perch;
    await lookTo(0, 0, 400);
    await sleep(250);
    await eyeClose();
  };
  // A shot at the hoop from the eye's head, as it springs: in, or off the
  // front of the rim. Either way the ball rolls back out to where it rests.
  const shoot = async (score) => {
    const b = bball;
    fromBase();
    await play(dot, [{ transform: "none" }, { transform: "scale(1.18, 0.82)" }], { duration: 260, easing: "ease-out" });
    letGo(b);
    const spring = leap(cx, cy, { rise: 170, ms: 560, crouch: false });
    if (score) {
      await toss(b, hoop.x, hoop.y - b.r - 30, hoop.y - 620, 1150, 330);
      const fall = toss(b, hoop.x, FLOOR - b.r, hoop.y - b.r - 30, 520, 40);
      await sleep(140);
      play(hoop.net, [{ transform: "none" }, { transform: "scaleY(1.22)", offset: 0.3 }, { transform: "scaleY(0.92)", offset: 0.65 }, { transform: "none" }], { duration: 650, easing: "ease-out" });
      await fall;
      await toss(b, hoop.x - 170, FLOOR - b.r, FLOOR - b.r - 330, 560, -100);
      await toss(b, hoop.x - 280, FLOOR - b.r, FLOOR - b.r - 120, 340, -60);
    } else {
      const lip = { x: hoop.x0 - b.r * 0.75, y: hoop.y - b.r * 0.7 };
      await toss(b, lip.x, lip.y, hoop.y - 560, 1050, 330);
      play(hoop.rim, [{ transform: "none" }, { transform: "translateY(16px)", offset: 0.2 }, { transform: "translateY(-8px)", offset: 0.5 }, { transform: "none" }], { duration: 400 });
      await toss(b, lip.x - 300, FLOOR - b.r, lip.y - 140, 720, -140);
      await toss(b, lip.x - 470, FLOOR - b.r, FLOOR - b.r - 220, 460, -90);
    }
    await spring;
    await roll(b, -1, b.x - b.rest);
  };
  // The fishing line: the bobber dips by d, the line stretching with it.
  const dip = (d, ms, frames = 1) => {
    const len = (v) => `scaleY(${((gear.length + v) / gear.length).toFixed(3)})`;
    const ds = Array.from({ length: frames * 2 + 1 }, (_, k) => (k % 2 ? d : 0));
    return Promise.all([
      play(gear.bobber, ds.map((v) => ({ transform: `translateY(${v}px)` })), { duration: ms, easing: "ease-in-out" }),
      play(gear.line, ds.map((v) => ({ transform: len(v) })), { duration: ms, easing: "ease-in-out" }),
    ]);
  };
  const lean = (dx, ms) => play(X, [{ transform: tx(cx) }, { transform: tx(cx + dx) }, { transform: tx(cx) }], { duration: ms, easing: "ease-in-out" });
  // Pins down, staggered, each sliding a little as it goes; and back up.
  const knockDown = () => Promise.all(pins.els.map((el, k) => sleep(k * 110).then(() => {
    const x = pins.xs[k] + 18, to = x + 40 + k * 25;
    return play(el, [{ transform: pose(x, FLOOR) }, { transform: pose(to, FLOOR, 98), offset: 0.75 }, { transform: pose(to, FLOOR, 90) }], { duration: 560, easing: "ease-in" });
  })));
  const standUp = (k) => {
    const x = pins.xs[k] + 18;
    return play(pins.els[k], [{ transform: pins.els[k].style.transform }, { transform: pose(x, FLOOR, -8), offset: 0.7 }, { transform: pose(x, FLOOR) }], { duration: 520, easing: "ease-out" });
  };

  // ---- The story: at first, the ground is too scary ----
  // On the roaming strip the eye starts out timid. It peers over the far
  // side of the l and climbs down a little, and a fright sends it back up;
  // the next time it gets further; then it takes a deep breath and goes all
  // the way down, finds nothing bad happens, and only then do the games
  // come into play. The booking page's loader is brave from the start.
  let brave = !roam, nerve = 0;
  const fright = async (depth) => {
    if (on !== "l") await jump();
    await eyeOpen();
    await lookTo(REACH, 40, 600);
    await sleep(500);
    await leap(FAR_WALL, -58, { rise: 120, ms: 620, across: "early", arrive: { wall: -1 } });
    await lookTo(0, 50, 300);
    const down = [142, 342, 542].slice(0, depth);
    for (const y of down) {
      await step(FAR_WALL, y, 520);
      await sleep(rand(180, 380));
    }
    await lookTo(0, 55, 500);
    await sleep(400);
    // Too far: a fright, then up and out as fast as it can go.
    await Promise.all([play(pupil, [{ transform: look(0, 55) }, { transform: look(0, -20, " scale(0.35)") }], { duration: 160, easing: "ease-out" }), tremble(900)]);
    for (const y of [...down.slice(0, -1).reverse(), -58]) await step(FAR_WALL, y, 220);
    await leap(PERCH.l.x, PERCH.l.y, { rise: 160, ms: 560, across: "late", arrive: onto("l") });
    on = "l";
    await lookTo(0, 0, 500);
    await sleep(300);
    await eyeClose();
  };
  const courage = async () => {
    if (on !== "l") await jump();
    await eyeOpen();
    await lookTo(REACH, 50, 600);
    await sleep(700);
    // A deep breath, then another, and a determined look.
    fromBase();
    for (let k = 0; k < 2; k++) await play(dot, [{ transform: "none" }, { transform: "scale(1.08, 1.1)", offset: 0.5 }, { transform: "none" }], { duration: 1000, easing: "ease-in-out" });
    await play(pupil, [{ transform: pupil.style.transform || "none" }, { transform: look(0, 20, " scale(0.8)") }], { duration: 300 });
    await sleep(400);
    await leap(FAR_WALL, -58, { rise: 120, ms: 620, across: "early", arrive: { wall: -1 } });
    await lookTo(0, 50, 300);
    for (const y of [142, 342, 542]) {
      await step(FAR_WALL, y, 560);
      await sleep(rand(200, 400));
    }
    // Where it turned back before: a wobble, and on it goes.
    await lookTo(0, 55, 400);
    await tremble(500);
    await sleep(600);
    for (const y of [742, 942, 1142, 1342]) {
      await step(FAR_WALL, y, 480);
      await sleep(rand(150, 300));
    }
    await leap(OUTSIDE.l, GROUND, { rise: 30, ms: 320, crouch: false });
    // Made it, and nothing bad happens.
    await lookTo(0, 45, 400);
    await sleep(900);
    await MOODS.lookAround();
    await cheer(3);
    brave = true;
    // And there's a ball.
    if (ball) {
      await lookTo(REACH, 10, 300);
      await sleep(500);
      await moveTo(ball.x - ball.r - 310 - 6, 260);
      await sleep(400);
      await kick(ball, 1, 300);
      await sleep(400);
      await cheer(2);
    }
    await goHome("l");
  };
  const story = () => {
    const chapter = [() => fright(1), () => fright(3), courage][Math.min(nerve, 2)];
    nerve++;
    svg.dataset.adventure = ["fright1", "fright3", "courage"][Math.min(nerve - 1, 2)];
    return chapter().finally(() => delete svg.dataset.adventure);
  };

  const ADVENTURES = {
    // Over the edge of the l: a peek, a climb down the far side, a fright,
    // and a scramble back up. The loader's; on the strip it's the story.
    farSide: {
      when: () => on === "l" && !roam,
      run: () => fright(3),
    },

    // Down the gap between the letters, then wall-hopping back out.
    gap: {
      when: () => true,
      run: async () => {
        await eyeOpen();
        await lookTo(on === "i" ? REACH : -REACH, 45, 500);
        await sleep(300);
        await eyeClose();
        await leap(GAP.mid, GROUND, { rise: on === "i" ? 120 : 200, ms: 900, across: "early" });
        await eyeOpen();
        await lookTo(0, -REACH, 600);
        await sleep(700);
        // Up it goes, bouncing off one wall and then the other.
        const hops = [[GAP.rightWall, 1080, 1], [GAP.leftWall, 720, -1], [GAP.rightWall, 380, 1]];
        for (const [x, y, wall] of hops) {
          await leap(x, y, { rise: 60, ms: 420, crouch: false, arrive: { wall } });
          await lookTo(wall * -40, -REACH, 160);
        }
        const to = Math.random() < 0.5 ? "i" : "l";
        await leap(PERCH[to].x, PERCH[to].y, { rise: 200, ms: 620, crouch: false, across: to === "l" ? "late" : "even", arrive: onto(to) });
        on = to;
        await lookTo(0, 0, 400);
        await sleep(250);
        await eyeClose();
      },
    },

    // Hopscotch: back and forth between the letters, quicker and higher
    // each time, then a dizzy moment.
    hopscotch: {
      when: () => true,
      run: async () => {
        await eyeOpen();
        for (const [rise, ms] of [[200, 640], [260, 600], [330, 560], [400, 540]]) {
          const to = on === "i" ? "l" : "i";
          await lookTo(across() * REACH, -20, 150);
          await leap(PERCH[to].x, PERCH[to].y, { rise, ms, crouch: rise === 200, arrive: onto(to) });
          on = to;
        }
        await lookTo(0, 0, 200);
        await MOODS.dizzy();
        await eyeClose();
      },
    },

    // Teetering: out to the very edge of the letter it's on, a wobble that
    // nearly tips it over, arms-out recovery, and back to the middle.
    teeter: {
      when: () => true,
      run: async () => {
        const p = PERCH[on], out = on === "i" ? -1 : 1, edge = p.x + out * 95;
        await eyeOpen();
        await lookTo(out * REACH, 40, 400);
        await step(edge, p.y, 520);
        await sleep(300);
        fromBase();
        await Promise.all([
          play(dot, [
            { transform: "none" }, { transform: `rotate(${out * 14}deg)`, offset: 0.2 }, { transform: `rotate(${-out * 10}deg)`, offset: 0.4 },
            { transform: `rotate(${out * 22}deg)`, offset: 0.62 }, { transform: `rotate(${-out * 6}deg)`, offset: 0.82 }, { transform: "none" },
          ], { duration: 2200, easing: "ease-in-out" }),
          play(pupil, [{ transform: look(out * REACH, 40) }, { transform: look(out * 30, 55, " scale(0.5)"), offset: 0.62 }, { transform: look(0, 0, " scale(0.5)"), offset: 0.8 }, { transform: "none" }], { duration: 2200, easing: "ease-in-out" }),
        ]);
        await sleep(200);
        await step(p.x, p.y, 380);
        await squash(onto(on));
        await sleep(300);
        await eyeClose();
      },
    },

    // Down to the ground outside a letter, a run off to the side, a look
    // back, a run home and a big leap up.
    groundRun: {
      ground: true,
      when: () => true,
      run: async () => {
        const home = on, side = on === "i" ? -1 : 1;
        await hopDown(home);
        await lookTo(side * REACH, 0, 300);
        // How far: a short dash, or with room to roam, most of the way to
        // the end of its run, at a longer stride.
        const start = OUTSIDE[home];
        const edge = roam ? (side < 0 ? walk.left : walk.right) : start + side * 650;
        const span = Math.max(0, (edge - start) * side) * (roam ? rand(0.6, 0.95) : 1);
        const length = roam ? 260 : 130;
        await moveTo(start + side * span, 230, length);
        await sleep(300);
        await lookTo(-side * REACH, 0, 250);
        await sleep(500);
        await moveTo(start, 230, length);
        await goHome(home);
      },
    },

    // With a football: down to it, a kick and a chase, a hop over it, a
    // kick back, a little celebration, and home.
    kickball: {
      ground: true,
      game: true,
      when: () => !!ball,
      run: async () => {
        await hopDown("l");
        // Standing just short of the ball, on the side away from `dir`.
        const behind = (dir) => (dir > 0 ? ball.x - ball.r - 310 - 6 : ball.x + ball.r + 6);
        await lookTo(REACH, 10, 250);
        await moveTo(behind(1), 230);
        await sleep(rand(200, 500));
        await kick(ball, 1);
        await sleep(200);
        await moveTo(behind(1), 230);
        await lookTo(REACH, -REACH, 300);
        await hopOver(ball, 1);
        await lookTo(-REACH, 10, 300);
        await sleep(400);
        await kick(ball, -1, rand(500, 900));
        await sleep(300);
        await cheer(2);
        await goHome("l");
      },
    },

    // Basketball: the ball flicked up onto its head, a couple of headers,
    // back to its spot, and a shot that rattles off the rim. A sigh, the
    // ball back on its head, and the second shot drops through the net.
    basketball: {
      ground: true,
      game: true,
      when: () => !!hoop,
      run: async () => {
        const b = bball;
        await hopDown("i");
        await lookTo(-REACH, 20, 250);
        await moveTo(b.x + b.r + 8, 230);
        await lookTo(-REACH, 30, 250);
        await sleep(300);
        await scoop(b);
        await headers(b, 2);
        await lookTo(-REACH, 0, 250);
        await moveTo(hoop.spot, 260);
        await lookTo(REACH, -45, 500);
        await sleep(700);
        await shoot(false);
        await aww();
        await sleep(300);
        await lookTo(REACH, 20, 300);
        await scoop(b);
        await lookTo(REACH, -45, 500);
        // A squint of concentration.
        fromBase();
        await play(dot, [{ transform: "none" }, { transform: "scale(1.04, 0.9)" }, { transform: "none" }], { duration: 900, easing: "ease-in-out" });
        await shoot(true);
        await cheer(3);
        await goHome("i");
      },
    },

    // Ice fishing: out on the ice by the hole, rod out, line down. A long
    // wait, a nibble or two, then a bite and a tug of war, and up comes a
    // fish. Delight, a kind look, and the fish flips back into the hole.
    fishing: {
      ground: true,
      game: true,
      when: () => !!ice,
      run: async () => {
        await hopDown("i");
        await lookTo(-REACH, 0, 250);
        await moveTo(ice.x + 120, 230);
        await lookTo(-REACH, 50, 400);
        await sleep(400);
        await play(gear.rod, [{ transform: "scale(0)" }, { transform: "scale(1.08)", offset: 0.7 }, { transform: "none" }], { duration: 450, easing: "ease-out" });
        await play(gear.line, [{ transform: "scaleY(0)" }, { transform: "none" }], { duration: 650, easing: "ease-in" });
        await play(gear.bobber, [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "none" }], { duration: 250 });
        gear.bobber.style.transform = "";
        // Waiting, eyes drooping.
        fromBase();
        await Promise.all([
          play(pupil, [{ transform: look(-REACH, 50) }, { transform: look(-REACH * 0.6, 58) }], { duration: 2200, easing: "ease-in-out" }),
          play(dot, [{ transform: "none" }, { transform: "scale(1.05, 0.84)" }], { duration: 2200, easing: "ease-in-out" }),
        ]);
        await sleep(900);
        // A nibble: awake at once. Nothing. Another.
        for (let k = 0; k < 2; k++) {
          await Promise.all([dip(16, 360), play(dot, [{ transform: k ? "none" : "scale(1.05, 0.84)" }, { transform: "scale(0.94, 1.08)" }, { transform: "none" }], { duration: 360 })]);
          await lookTo(-REACH, 55, 150);
          await sleep(1400);
        }
        // A bite! Tug, tug, tug.
        await Promise.all([dip(50, 1500, 4), tremble(1500), lean(36, 500).then(() => lean(36, 500)).then(() => lean(50, 500))]);
        // Up it comes.
        fish.el.style.opacity = 1;
        await Promise.all([
          play(gear.rod, [{ transform: "none" }, { transform: "rotate(18deg)" }, { transform: "none" }], { duration: 500, easing: "ease-out" }),
          play(gear.line, [{ transform: "none" }, { transform: "scaleY(0.25)" }], { duration: 300, easing: "ease-out" }),
          play(gear.bobber, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
          toss(fish, ice.x - 190, FLOOR - 30, FLOOR - 700, 900, -360),
        ]);
        for (const s of [-24, 18, -10]) await toss(fish, fish.x, fish.y, fish.y - 60, 260, s);
        await cheer(2);
        // Better back in the water.
        await lookTo(-REACH, 30, 400);
        fromBase();
        await play(dot, [{ transform: "none" }, { transform: "scale(0.92)", offset: 0.4 }, { transform: "scale(0.92)", offset: 0.7 }, { transform: "none" }], { duration: 1400, easing: "ease-in-out" });
        await lean(-30, 400);
        await toss(fish, ice.x, FLOOR + 30, FLOOR - 320, 620, 220);
        fish.el.style.opacity = 0;
        const drops = [-60, -20, 30, 70].map((dx) => {
          const d = { el: draw("circle", { class: "ilv-splash", cx: 0, cy: 0, r: 16 }, yard.mid), x: ice.x, y: FLOOR - 10, spin: 0 };
          put(d);
          return toss(d, ice.x + dx * 2.2, FLOOR - 10, FLOOR - 200 - Math.abs(dx), 520).then(() => d.el.remove());
        });
        await Promise.all(drops);
        Object.assign(fish, { x: ice.x, y: FLOOR + 40, spin: 0 });
        put(fish);
        await play(gear.line, [{ transform: "scaleY(0.25)" }, { transform: "scaleY(0)" }], { duration: 200 });
        await play(gear.rod, [{ transform: "none" }, { transform: "scale(0)" }], { duration: 300, easing: "ease-in" });
        await goHome("i");
      },
    },

    // Bowling, with itself as the ball: a look down the lane, a wind-up,
    // and it rolls (pupil spinning round) into the pins. Strike! A dizzy
    // moment, a cheer, and the pins stood back up one by one.
    bowling: {
      ground: true,
      game: true,
      when: () => !!pins,
      run: async () => {
        await hopDown("l");
        await lookTo(REACH, 0, 250);
        await moveTo(pins.start, 230);
        await lookTo(REACH, -10, 400);
        await lean(40, 1400);
        await sleep(300);
        fromMiddle();
        await play(dot, [{ transform: "none" }, { transform: "rotate(-35deg)" }], { duration: 500, easing: "ease-in-out" });
        await sleep(300);
        const to = pins.xs[0] - 30 - 310, turn = ((to - cx) / 155) * (180 / Math.PI);
        const easing = "cubic-bezier(0.45, 0, 0.9, 0.6)";
        await Promise.all([
          play(X, [{ transform: tx(cx) }, { transform: tx(to) }], { duration: 1000, easing }),
          play(dot, [{ transform: "rotate(-35deg)" }, { transform: `rotate(${turn}deg)` }], { duration: 1000, easing }),
        ]);
        cx = to;
        const fall = knockDown();
        const end = Math.round((turn + 40) / 360) * 360;
        await Promise.all([
          play(X, [{ transform: tx(cx) }, { transform: tx(cx + 50) }], { duration: 360, easing: "ease-out" }),
          play(dot, [{ transform: `rotate(${turn}deg)` }, { transform: `rotate(${end}deg)` }], { duration: 600, easing: "ease-out" }),
        ]);
        cx += 50;
        dot.style.transform = "";
        await fall;
        await MOODS.dizzy();
        await cheer(3);
        await sleep(400);
        for (let k = 0; k < pins.els.length; k++) {
          await lookTo(REACH, 20, 200);
          await Promise.all([leap(cx, cy, { rise: 90, ms: 360, crouch: false }), sleep(200).then(() => standUp(k))]);
          await sleep(250);
        }
        await goHome("l");
      },
    },

    // With room to roam only: down to the ground, nearly to one end of its
    // run, all the way across to the other, then home.
    crossing: {
      ground: true,
      when: () => !!roam,
      run: async () => {
        const home = on, side = on === "i" ? -1 : 1, start = OUTSIDE[home], length = 300;
        const near = side < 0 ? walk.left : walk.right, far = side < 0 ? walk.right : walk.left;
        const runTo = (x, ms) => moveTo(x, ms, length);
        await hopDown(home);
        await lookTo(side * REACH, 0, 250);
        await runTo(near, 210);
        await sleep(300);
        await lookTo(-side * REACH, 0, 250);
        await sleep(400);
        await runTo(far, 190);
        await sleep(300);
        await lookTo(side * REACH, 0, 250);
        await sleep(400);
        await runTo(start, 210);
        await goHome(home);
      },
    },
  };
  // Never the same twice running, and never two trips along the ground in
  // a row: they're broken up by something up on the letters (the gap,
  // hopscotch, teetering), a plain leap, or the moods. Each
  // game takes its turn before any comes round again, and games come up
  // more often than plain runs.
  let lastAdventure = "", played = [];
  const adventure = () => {
    const A = ADVENTURES, last = A[lastAdventure];
    if (last?.ground && Math.random() < 0.5) return jump();
    let names = Object.keys(A).filter((n) => n !== lastAdventure && A[n].when() && !(A[n].ground && last?.ground));
    const games = names.filter((n) => A[n].game);
    if (games.length && games.every((n) => played.includes(n))) played = [];
    names = names.filter((n) => !played.includes(n));
    if (!names.length) return jump();
    const weight = (n) => (A[n].game ? 3 : A[n].ground ? 1 : 2);
    let pick = Math.random() * names.reduce((s, n) => s + weight(n), 0);
    lastAdventure = names.find((n) => (pick -= weight(n)) < 0) || names[0];
    if (A[lastAdventure].game) played.push(lastAdventure);
    svg.dataset.adventure = lastAdventure;
    return A[lastAdventure].run().finally(() => delete svg.dataset.adventure);
  };

  // The pupil shows only while the eye has a mood. It pops in with a little
  // overshoot as the eye widens, and shrinks to a point to go.
  const eyeOpen = () => {
    fromBase();
    return Promise.all([
      play(eye, [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1.2)", offset: 0.6 }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" }),
      play(dot, [{ transform: "none" }, { transform: "scale(0.94, 1.08)", offset: 0.5 }, { transform: "none" }], { duration: 380, easing: "ease-out" }),
    ]);
  };
  const eyeClose = () =>
    play(eye, [{ opacity: 1, transform: "none" }, { opacity: 1, transform: "scale(1.12)", offset: 0.3 }, { opacity: 0, transform: "scale(0)" }], { duration: 320, easing: "ease-in" });

  const blink = (ms) => (fromMiddle(), play(dot, [{ transform: "none" }, { transform: "scale(1.08, 0.1)", offset: 0.45 }, { transform: "scale(1.08, 0.1)", offset: 0.55 }, { transform: "none" }], { duration: ms, easing: "ease-in-out" }));

  // Its moods: only the pupil and the eye's own movement, never a face.
  const MOODS = {
    // Looking around: a glance left, a glance right, back.
    lookAround: () => play(pupil, [
      { transform: "none" },
      { transform: look(-REACH, 0), offset: 0.12 }, { transform: look(-REACH, 0), offset: 0.38 },
      { transform: look(REACH, -8), offset: 0.52 }, { transform: look(REACH, -8), offset: 0.8 },
      { transform: "none" },
    ], { duration: 2600, easing: "ease-in-out" }),

    // Curious: peers at the other letter, leaning in, then a slow nod back.
    curious: () => {
      const d = across();
      fromBase();
      return Promise.all([
        play(pupil, [{ transform: "none" }, { transform: look(d * REACH, -30), offset: 0.2 }, { transform: look(d * REACH, -30), offset: 0.75 }, { transform: "none" }], { duration: 2400, easing: "ease-in-out" }),
        play(dot, [{ transform: "none" }, { transform: `translateX(${d * 28}px) scale(0.97, 1.04)`, offset: 0.25 }, { transform: `translateX(${d * 34}px) scale(0.97, 1.04)`, offset: 0.7 }, { transform: "none" }], { duration: 2400, easing: "ease-in-out" }),
      ]);
    },

    // Surprised: pupil shrinks to a pinpoint as the eye jolts up and stays
    // wide for a beat before settling.
    surprised: () => {
      const p = PERCH[on];
      fromBase();
      return Promise.all([
        play(pupil, [{ transform: "none" }, { transform: "scale(0.4)", offset: 0.08 }, { transform: "scale(0.4)", offset: 0.75 }, { transform: "none" }], { duration: 2000, easing: "ease-out" }),
        play(Y, [{ transform: at(p).y }, { transform: `translateY(${p.y - 90}px)`, offset: 0.1, easing: "ease-in" }, { transform: at(p).y, offset: 0.25 }, { transform: at(p).y }], { duration: 2000, easing: "ease-out" }),
        play(dot, [{ transform: "none" }, { transform: "scale(0.88, 1.16)", offset: 0.1 }, { transform: "scale(0.93, 1.09)", offset: 0.3 }, { transform: "scale(0.93, 1.09)", offset: 0.75 }, { transform: "none" }], { duration: 2000, easing: "ease-in-out" }),
      ]);
    },

    // Delighted: pupil swells and lifts, three happy little bounces.
    delighted: async () => {
      const p = PERCH[on];
      const grow = play(pupil, [{ transform: "none" }, { transform: look(0, -14, " scale(1.4)"), offset: 0.15 }, { transform: look(0, -14, " scale(1.4)"), offset: 0.85 }, { transform: "none" }], { duration: 2400, easing: "ease-in-out" });
      await sleep(300);
      for (let n = 0; n < 3; n++) {
        await play(Y, [{ transform: at(p).y, easing: "ease-out" }, { transform: `translateY(${p.y - 70}px)`, offset: 0.5, easing: "ease-in" }, { transform: at(p).y }], { duration: 380 });
        await squash(onto(on));
      }
      await grow;
    },

    // Sleepy: the pupil drifts down as the eye slowly sags, holds, then
    // snaps awake with a start.
    sleepy: async () => {
      fromBase();
      await Promise.all([
        play(pupil, [{ transform: "none" }, { transform: look(0, 50) }], { duration: 1800, easing: "ease-in" }),
        play(dot, [{ transform: "none" }, { transform: "scale(1.07, 0.66)" }], { duration: 1800, easing: "ease-in" }),
      ]);
      await sleep(500);
      await Promise.all([
        play(dot, [{ transform: "scale(1.07, 0.66)" }, { transform: "scale(0.9, 1.14)", offset: 0.35 }, { transform: "none" }], { duration: 500, easing: "ease-out" }),
        play(pupil, [{ transform: look(0, 50) }, { transform: look(0, -20, " scale(0.8)"), offset: 0.35 }, { transform: "none" }], { duration: 600, easing: "ease-out" }),
      ]);
    },

    // Dizzy: the pupil circles twice while the eye wobbles side to side.
    dizzy: () => {
      const r = 46, turns = 2, steps = 24;
      const circle = Array.from({ length: steps + 1 }, (_, k) => {
        const t = (k / steps) * turns * 2 * Math.PI;
        return { transform: look(r * Math.sin(t), -r * Math.cos(t)) };
      });
      fromMiddle();
      return Promise.all([
        play(pupil, [{ transform: "none" }, ...circle, { transform: "none" }], { duration: 2600, easing: "ease-in-out" }),
        play(dot, [
          { transform: "none" }, { transform: "translateX(-18px)", offset: 0.15 }, { transform: "translateX(18px)", offset: 0.35 },
          { transform: "translateX(-14px)", offset: 0.55 }, { transform: "translateX(10px)", offset: 0.75 }, { transform: "none" },
        ], { duration: 2600, easing: "ease-in-out" }),
      ]);
    },

    // Shy: looks down and away, shrinking a little, then peeks back up.
    shy: () => {
      const d = -across();
      fromBase();
      return Promise.all([
        play(pupil, [{ transform: "none" }, { transform: look(d * 45, 42), offset: 0.2 }, { transform: look(d * 45, 42), offset: 0.6 }, { transform: look(d * 20, 10), offset: 0.75 }, { transform: look(d * 45, 42), offset: 0.85 }, { transform: "none" }], { duration: 2600, easing: "ease-in-out" }),
        play(dot, [{ transform: "none" }, { transform: "scale(0.88)", offset: 0.2 }, { transform: "scale(0.88)", offset: 0.85 }, { transform: "none" }], { duration: 2600, easing: "ease-in-out" }),
      ]);
    },

    // A slow double blink.
    blinks: async () => { await blink(420); await sleep(160); await blink(420); },
  };
  const mood = () => {
    const names = Object.keys(MOODS).filter((n) => n !== lastMood);
    lastMood = names[Math.floor(Math.random() * names.length)];
    // Visible in the inspector, which helps when tuning the moods.
    svg.dataset.mood = lastMood;
    return eyeOpen()
      .then(() => MOODS[lastMood]())
      .then(eyeClose)
      .finally(() => delete svg.dataset.mood);
  };

  // Sit a while, show a mood or two, sit a while, jump.
  const life = async () => {
    while (running) {
      await sleep(rand(600, 1600));
      if (!running) return;
      const moods = Math.random() < 0.3 ? 2 : 1;
      for (let n = 0; n < moods && running; n++) {
        await mood();
        if (running) await sleep(rand(400, 1200));
      }
      if (!running) return;
      await sleep(rand(300, 1400));
      if (!running) return;
      // At first, the next chapter of its story. Then usually the plain
      // leap, often something more adventurous instead.
      if (!brave) await story();
      else await (Math.random() < (roam ? 0.6 : 0.45) ? adventure() : jump());
    }
  };

  // Stop mid-move and hold wherever everything is.
  const freeze = () => {
    const now = parts.map((el) => [el, getComputedStyle(el).transform, getComputedStyle(el).opacity]);
    svg.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    now.forEach(([el, t, o]) => { el.style.transform = t === "none" ? "" : t; el.style.opacity = o; });
  };
  const reset = () => {
    parts.forEach((el) => el.removeAttribute("style"));
    svg.classList.remove("ilv-scripted");
  };

  return {
    start() {
      if (!able || running) return;
      reset();
      svg.classList.add("ilv-scripted");
      X.style.transform = at(PERCH.i).x;
      Y.style.transform = at(PERCH.i).y;
      on = "i";
      cx = PERCH.i.x;
      cy = PERCH.i.y;
      if (roam && !yard) setUpYard();
      running = true;
      // Never quite still: a gentle float on its own layer, under every
      // mood, pause and jump. A small tall oval traced at an even pace, so
      // there's no moment of stopping to turn around, and upward only, so it
      // never sinks into its perch.
      const float = Array.from({ length: 25 }, (_, k) => {
        const t = (k / 24) * 2 * Math.PI;
        return { transform: `translate(${(5 * Math.sin(t)).toFixed(2)}px, ${(-12 + 12 * Math.cos(t)).toFixed(2)}px)` };
      });
      hover.animate(float, { duration: 2600, iterations: Infinity, easing: "linear" });
      life();
    },
    stop() {
      running = false;
      if (able) { freeze(); reset(); }
    },
    // Home to its place in the logo, then the pupil pops in for a wink and
    // pops out again.
    async finish() {
      if (!able) return;
      running = false;
      freeze();
      const settle = { duration: 480, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" };
      const home = (el) => play(el, [{ transform: el.style.transform || "none" }, { transform: "none" }], settle);
      await Promise.all([
        home(X), home(Y), home(hover), home(dot), home(stem), home(bar), home(pupil),
        play(eye, [{ opacity: eye.style.opacity || 0, transform: eye.style.transform || "none" }, { opacity: 0, transform: "scale(0)" }], { duration: 200 }),
      ]);
      await eyeOpen();
      await blink(560);
      await eyeClose();
      // A beat to enjoy the wink before moving on.
      await sleep(900);
    },
  };
};

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
  // The sending screen fades in over the page, and out again on failure.
  // The page behind it doesn't scroll while it's up.
  const showScreen = (on) => {
    document.documentElement.classList.toggle("is-sending", on);
    if (on) {
      wait.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => wait.classList.add("is-shown")));
    } else {
      wait.classList.remove("is-shown");
      setTimeout(() => (wait.hidden = true), 260);
    }
  };

  const loader = wait.querySelector(".loader") ? character(wait.querySelector(".loader")) : null;
  const failed = booking.querySelector("[data-book-error]");
  const mailto = booking.querySelector("[data-book-mailto]");
  if (booking.dataset.ajax && window.fetch) {
    booking.addEventListener("submit", async (e) => {
      e.preventDefault();
      failed.hidden = true;
      // Disabled while sending, so an impatient second tap can't book twice.
      send.disabled = true;
      send.textContent = "Sending…";
      // A sending screen over the page: the eye in the middle, the
      // please-wait message under it. FormSubmit sends the email before it
      // answers, which can take a while.
      status.textContent = "Sending your request…";
      slowNote.hidden = false;
      showScreen(true);
      loader?.start();
      const data = new FormData(booking);
      let ok = false;
      try {
        const res = await fetch(booking.dataset.ajax, { method: "POST", body: data, headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        ok = res.ok && String(body.success) === "true";
      } catch {
        ok = false;
      }
      if (ok) {
        // Coming back with the Back button restores this page as it was
        // left, mid-wink; reset it to a fresh form.
        addEventListener("pageshow", (ev) => ev.persisted && location.reload(), { once: true });
        slowNote.hidden = true;
        status.textContent = "Sent!";
        await loader?.finish().catch(() => {});
        // The eye and message fade out, then the thanks page fades in.
        wait.classList.add("is-leaving");
        await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450));
        location.href = booking.querySelector("[data-next]").value || "thanks.html";
        return;
      }
      // Everything the visitor filled in, as a ready-to-send email. Fields
      // starting with _ are the form service's settings, not answers.
      const lines = [...data.entries()].filter(([k, v]) => !k.startsWith("_") && String(v).trim()).map(([k, v]) => `${k}: ${v}`);
      mailto.href = `mailto:${booking.dataset.mailto}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(lines.join("\n"))}`;
      loader?.stop();
      showScreen(false);
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
  let revealed = "";

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
    if (!rec) { revealed = ""; return; }
    // Each time a package is first suggested, the card comes in: over from
    // the side beside the questions, unfolding beneath them on phones, the
    // lines of the breakdown following one by one.
    if (rec.pkg !== revealed) {
      revealed = rec.pkg;
      result.classList.remove("is-revealing");
      void result.offsetWidth;
      // With the header's eye about, it does the showing (see below).
      if (result.dataset.guided) result.dispatchEvent(new CustomEvent("suggest"));
      else result.classList.add("is-revealing");
    }

    result.querySelector("[data-builder-name]").textContent = rec.pkg;
    result.querySelector("[data-builder-why]").textContent = rec.why;
    const q = quote({ ...rec, sqft });
    const cell = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text, className: cls || "" });
    const rows = q.lines.map((l, i) => {
      const tr = document.createElement("tr");
      tr.style.setProperty("--i", i);
      const what = cell("th", l.label);
      what.scope = "row";
      if (l.detail) what.append(cell("span", l.detail, "breakdown-detail"));
      tr.append(what, cell("td", money(l.amount)));
      return tr;
    });
    const total = document.createElement("tr");
    total.className = "breakdown-total";
    total.style.setProperty("--i", q.lines.length);
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

// ---------- the eye beside the name, and its help with Build your job ----------
// The header's eye floats and blinks by itself (css/style.css). Here it also
// takes notice: now and then its pupil follows the cursor, always when the
// cursor comes near, and when something is pressed it hops and looks at it.
// And when Build your job comes into view, it flies down to help: it sits
// beside each question in turn and hops as each is answered. When a
// suggestion comes, it pulls the card on from the edge of the screen, then
// waits by the Book button for half a minute before flying home to the
// header, as it does when the builder is scrolled away. The header's eye is never
// shown while the floor plan's or the footer's is on screen: it's the same
// eye.
const brandEye = document.querySelector(".site-header .brand-eye");
if (brandEye && brandEye.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const REACH = 2.6; // how far the pupil moves in the 20-unit eye
  const fine = matchMedia("(pointer: fine)").matches;
  let pointer = null, curious = false;
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  // Aim an eye's pupil at a point on screen, or back to the middle.
  const aim = (svg, at) => {
    const pupil = svg.querySelector(".brand-pupil");
    if (!at) { pupil.style.transform = ""; return; }
    const [x, y] = centre(svg), dx = at[0] - x, dy = at[1] - y, d = Math.hypot(dx, dy) || 1, k = Math.min(REACH, d / 12) / d;
    pupil.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
  };
  const hop = (el, h = 5) => el.animate([{ transform: "none" }, { transform: `translateY(${-h}px) scale(0.92, 1.08)`, offset: 0.4 }, { transform: "scale(1.06, 0.94)", offset: 0.75 }, { transform: "none" }], { duration: 420, easing: "ease-out", composite: "add" });

  // ---- The guide: the same eye, out of the header and over the page ----
  const guide = brandEye.cloneNode(true);
  guide.classList.add("guide-eye");
  document.body.append(guide);
  let out = false, target = null, flight = null, arrived = null, x = 0, y = 0, glance = null;

  const builder = document.querySelector("[data-builder]");
  const form = builder?.querySelector("[data-builder-form]");
  const result = builder?.querySelector("[data-builder-result]");
  // Where to sit: just after a question's own words (not its hint). A
  // target can also be a function, for a place that moves.
  const spotFor = (el) => {
    if (typeof el === "function") return el();
    const legend = el.querySelector("legend");
    const words = legend.querySelector("label") || legend.firstChild;
    const range = document.createRange();
    range.selectNodeContents(words);
    const rects = range.getClientRects(), line = rects[rects.length - 1] || legend.getBoundingClientRect();
    return [Math.min(line.right + 22, innerWidth - 16), line.top + line.height / 2];
  };
  const shown = () => [...form.querySelectorAll(".q:not([hidden])")];
  const answered = (q) =>
    q.querySelector("input:checked") ||
    [...q.querySelectorAll('input[type="number"]')].some((i) => i.value) ||
    // Extras are optional: done once anything after them is answered.
    (q.querySelector('input[type="checkbox"]') && shown().slice(shown().indexOf(q) + 1).some(answered));
  const current = () => shown().find((q) => !answered(q)) || null;

  // Off to a new place: a flight with a little arc, looking where it's
  // headed; then it stays with that place, through scrolling, until the
  // next. Resolves on arrival. Home is beside the name, back in the header.
  const flyTo = (spot) => new Promise((done) => {
    arrived?.();
    target = spot;
    flight = { from: [x, y], t0: performance.now(), ms: 0 };
    arrived = done;
    loop();
  });
  const home = () => centre(brandEye);
  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    const frame = (now) => {
      const [tx, ty] = target ? spotFor(target) : home();
      if (flight) {
        const [fx, fy] = flight.from, d = Math.hypot(tx - fx, ty - fy);
        flight.ms ||= Math.max(450, Math.min(1100, d * 1.1));
        const t = Math.min(1, (now - flight.t0) / flight.ms), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        x = fx + (tx - fx) * e;
        y = fy + (ty - fy) * e - Math.min(90, d * 0.3) * Math.sin(Math.PI * t);
        aim(guide, [tx, ty]);
        if (t >= 1) {
          flight = null;
          aim(guide, glance);
          if (!target) { out = false; guide.classList.remove("is-out"); brandEye.style.visibility = ""; hop(brandEye, 3); }
          else hop(guide, 4);
          arrived?.();
          arrived = null;
        }
      } else { x = tx; y = ty; }
      // Placed with `translate`, leaving `transform` to its float and hops.
      const half = parseFloat(getComputedStyle(guide).width) / 2;
      guide.style.translate = `${(x - half).toFixed(1)}px ${(y - half).toFixed(1)}px`;
      if (out || flight) requestAnimationFrame(frame);
      else running = false;
    };
    requestAnimationFrame(frame);
  };
  const leave = () => {
    if (out) return;
    out = true;
    [x, y] = home();
    brandEye.style.visibility = "hidden";
    guide.classList.add("is-out");
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tween = (ms, fn) => new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      t < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });

  // The suggestion, shown by the eye: held just off the edge of the screen
  // until the eye arrives, pulled on whole, and then the eye hops over to
  // the Book button and watches it, waiting half a minute for a press
  // before flying home. Anything changed meanwhile starts it over.
  let turn = 0, lastInput = 0, inspected = false, inView = false;
  const unhold = () => (result.style.translate = "");
  const present = async () => {
    const me = ++turn, stale = () => me !== turn;
    inspected = false;
    // Off screen (say, answers restored on reload), or while the eye is
    // busy in the floor plan or the footer, it waits.
    if (!inView || elsewhere) return;
    // Held just past the screen's right-hand edge, whole and ready.
    let off = 0;
    const held = () => {
      const r = result.getBoundingClientRect();
      off = innerWidth - (r.left - parseFloat(result.style.translate || 0)) + 24;
      result.style.translate = `${off.toFixed(1)}px 0`;
    };
    held();
    // Wait for typing to stop (this runs before the keystroke that set it
    // off is counted, so count it here).
    lastInput = performance.now();
    while (performance.now() - lastInput < 700) { await wait(100); if (stale()) return; }
    held();
    leave();
    // Bring the card's place into view if it's below the fold (phones,
    // mostly), fly to the screen's edge beside it, and pull it on.
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    let shift = off;
    const grip = () => { const r = result.getBoundingClientRect(); return [Math.min(r.left - 4, innerWidth - 14), r.top + 30]; };
    await flyTo(grip);
    if (stale()) return;
    await tween(750, (e) => { shift = off * (1 - e); result.style.translate = `${shift.toFixed(1)}px 0`; });
    result.style.translate = "";
    if (stale()) return;
    hop(guide, 4);
    await wait(300);
    // Over to the Book button, to watch it and wait, a while, for a press.
    const book = result.querySelector("[data-builder-book]");
    await flyTo(() => { const r = book.getBoundingClientRect(); return [Math.min(r.right + 18, innerWidth - 14), r.top + r.height / 2]; });
    if (stale()) return;
    glance = centre(book);
    aim(guide, glance);
    hop(guide, 6);
    for (let t = 0; t < 30000; t += 250) {
      await wait(250);
      if (stale()) return;
      glance = centre(book);
      aim(guide, glance);
      if (t % 6000 === 5750) hop(guide, 3);
    }
    glance = null;
    inspected = true;
    await flyTo(null);
  };

  // Out to the question in hand, or to show a suggestion not yet shown.
  const goOut = () => {
    if (elsewhere) return;
    if (!result.hidden && !inspected) { present(); return; }
    const q = current();
    if (!q) return;
    leave();
    flyTo(q);
  };
  const goHome = () => { if (out && target !== null) { turn++; unhold(); flyTo(null); } };
  // A beat after each answer, on to whatever comes next.
  let next = 0;
  const onward = (picked) => {
    if (!inView || elsewhere) return;
    if (!out) leave();
    glance = picked ? centre(picked) : null;
    aim(guide, glance);
    hop(guide, 5);
    clearTimeout(next);
    next = setTimeout(() => {
      glance = null;
      // A fresh suggestion takes it from here.
      if (!result.hidden && result.style.translate) return;
      const to = current();
      if (to) { if (to !== target) flyTo(to); }
      else if (result.hidden || inspected) flyTo(null);
    }, 650);
  };
  // One eye at a time: while the floor plan's or the footer's eye is on
  // screen, the header's is away, and the guide, if it's out, pops away
  // where it is.
  let elsewhere = false;
  const vanish = () => {
    turn++;
    clearTimeout(next);
    if (result) unhold();
    arrived?.();
    arrived = null;
    target = flight = null;
    out = false;
    guide.animate([{ scale: 1, opacity: 1 }, { scale: 0, opacity: 0 }], { duration: 250, easing: "ease-in" })
      .finished.then(() => { if (!out) { guide.classList.remove("is-out"); brandEye.style.visibility = ""; } });
  };
  const others = [document.querySelector("[data-plan]"), document.querySelector(".mascot")].filter(Boolean);
  if (others.length && "IntersectionObserver" in window) {
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.intersectionRatio > 0.3));
      const now = [...seen.values()].some(Boolean);
      if (now === elsewhere) return;
      elsewhere = now;
      brandEye.classList.toggle("is-away", elsewhere);
      if (elsewhere && out) vanish();
      else if (!elsewhere && inView) goOut();
    }, { threshold: [0, 0.3] });
    others.forEach((el) => io.observe(el));
  }
  if (form && "IntersectionObserver" in window) {
    result.dataset.guided = "1";
    result.addEventListener("suggest", present);
    new IntersectionObserver(([e]) => {
      inView = e.intersectionRatio > 0.25;
      inView ? goOut() : goHome();
    }, { threshold: [0, 0.25] }).observe(builder);
    form.addEventListener("change", (e) => onward(e.target.closest("label") || e.target));
    // Typing a size: it watches, and moves on once the typing stops.
    form.addEventListener("input", (e) => {
      if (e.target.type !== "number") return;
      lastInput = performance.now();
      clearTimeout(next);
      next = setTimeout(() => onward(e.target), 500);
    });
  }

  // ---- Paying attention ----
  // Close by, it always watches the cursor; further off, only during a
  // curious spell now and then.
  const watch = () => {
    if (!pointer) return;
    for (const svg of [brandEye, guide]) {
      if (svg === guide ? !out || flight || glance : out) continue;
      const [cx, cy] = centre(svg), near = Math.hypot(pointer[0] - cx, pointer[1] - cy) < 320;
      svg.classList.toggle("is-watching", near || curious);
      aim(svg, near || curious ? pointer : null);
    }
  };
  if (fine) {
    addEventListener("pointermove", (e) => { pointer = [e.clientX, e.clientY]; watch(); }, { passive: true });
    const spell = () => setTimeout(() => {
      curious = true;
      watch();
      setTimeout(() => { curious = false; watch(); spell(); }, 2500 + Math.random() * 2500);
    }, 7000 + Math.random() * 9000);
    spell();
  }
  // Something pressed: a hop and a look at it.
  addEventListener("click", (e) => {
    const hit = e.target.closest("a, button, label, input");
    if (!hit || builder?.contains(hit)) return;
    const svg = out ? guide : brandEye, at = centre(hit);
    svg.classList.add("is-watching");
    aim(svg, at);
    hop(svg, 5);
    setTimeout(() => { svg.classList.remove("is-watching"); aim(svg, null); watch(); }, 1200);
  });
}

// ---------- hero: the eye scans, builds, then lives in the floor plan ----------
// The plan starts empty. The eye comes in through the front door and goes
// room to room, only ever through doorways. In each room it glances along
// dotted lines of sight to the corners and walls, and the room's walls build
// in, spreading out from the eye. Then it measures up a wall in each room,
// furnishes the place, and, the measurements fading, welcomes its family in
// at the front door: a partner and two kids. Together they watch TV, cook
// (the kids play chase meanwhile), eat dinner round the table and have a
// dance party. Then the kids get ready for bed: a bath, teeth brushed, tucked
// in and read a story till they nod off, and the parents go to bed too.
// Asleep, an eye stays round and its pupil closes, and that's where it
// ends: the house asleep, a z drifting up now and then. A little under
// three minutes, never repeated.
// On phones it sits below the buttons and starts when scrolled to. With
// reduced motion (or without JavaScript) the plan is shown finished and
// furnished.
const plan = document.querySelector("[data-plan]");
if (plan && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const NS = "http://www.w3.org/2000/svg";
  const rooms = JSON.parse(plan.dataset.rooms).map((r) => ({
    ...r,
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
    // Corners and the middle of each wall: where it looks.
    sights: [
      [r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h / 2],
      [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2],
    ],
    // Big enough to reach the room's far corners, walls included.
    reach: Math.hypot(r.w, r.h) / 2 + 8,
  }));
  const doors = JSON.parse(plan.dataset.doors);
  const walls = plan.querySelector(".plan-walls");
  const rays = plan.querySelector(".plan-rays");
  const marks = plan.querySelector(".plan-marks");
  const fx = plan.querySelector(".plan-fx");
  const reveals = [...plan.querySelectorAll(".plan-reveal")];
  const item = (name) => plan.querySelector(`[data-item="${name}"]`);

  const smooth = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const linear = (t) => t;
  const tween = (ms, fn, ease = smooth) =>
    new Promise((done) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        fn(ease(t), t);
        t < 1 ? requestAnimationFrame(frame) : done();
      };
      requestAnimationFrame(frame);
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = (...jobs) => Promise.all(jobs);
  const shape = (tag, attrs, parent = fx, text = "") => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  };

  // Which room a point is in, and the doorways from one room to another.
  const roomAt = (x, y) => rooms.findIndex((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  const route = (from, to) => {
    if (from === to || from < 0 || to < 0) return [];
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const r = queue.shift();
      if (r === to) break;
      for (const [a, b, x, y] of doors) {
        const next = a === r ? b : b === r ? a : null;
        if (next !== null && !(next in prev)) { prev[next] = { r, x, y }; queue.push(next); }
      }
    }
    const points = [];
    for (let r = to; prev[r]; r = prev[r].r) points.unshift([prev[r].x, prev[r].y]);
    return points;
  };

  // Someone in the house: an eye with a pupil, at a place, of a size. The
  // logo's eye is already drawn; the family are added as they arrive.
  const FRONT = [243, 340]; // the front door, in the living room's outside wall right of the sofa
  class Eye {
    constructor({ el = null, r = 10, x = FRONT[0], y = FRONT[1] + 28 } = {}) {
      if (!el) {
        el = shape("g", { class: "plan-eye" }, plan);
        plan.insertBefore(el, plan.querySelector(".plan-eye"));
        shape("circle", { class: "plan-eye-ball", r }, el);
        shape("circle", { class: "plan-eye-pupil", r: (r * 0.36).toFixed(2) }, el);
      }
      this.el = el;
      this.pupil = el.querySelector(".plan-eye-pupil");
      this.r = r;
      Object.assign(this, { x, y, squint: 1, bobX: 0, bobY: 0, here: -1 });
      this.place();
    }
    place() {
      this.el.setAttribute("transform", `translate(${(this.x + this.bobX).toFixed(2)} ${(this.y + this.bobY).toFixed(2)}) scale(1 ${this.squint.toFixed(3)})`);
    }
    // The pupil leans towards what it's looking at, never past the rim.
    lookAt(x, y) {
      const dx = x - this.x, dy = y - this.y, d = Math.hypot(dx, dy) || 1, k = Math.min(this.r * 0.52, d) / d;
      this.pupil.setAttribute("cx", (dx * k).toFixed(2));
      this.pupil.setAttribute("cy", (dy * k).toFixed(2));
    }
    lookAhead() { this.pupil.setAttribute("cx", 0); this.pupil.setAttribute("cy", 0); }
    // In a straight line, looking where it's going. Kids are quicker.
    async glide(x, y, pace = this.r < 10 ? 6 : 8) {
      const x0 = this.x, y0 = this.y;
      this.lookAt(x, y);
      await tween(Math.max(300, Math.hypot(x - x0, y - y0) * pace), (t) => {
        this.x = x0 + (x - x0) * t;
        this.y = y0 + (y - y0) * t;
        this.place();
      });
    }
    // Anywhere in the house: through each doorway on the way, never a wall.
    async walkTo(x, y) {
      const to = roomAt(x, y);
      for (const [dx, dy] of route(this.here, to)) await this.glide(dx, dy);
      await this.glide(x, y);
      this.here = to;
      this.lookAhead();
    }
    blink(ms = 320) { return tween(ms, (t) => { this.squint = 1 - 0.85 * Math.sin(Math.PI * t); this.place(); }, linear); }
    // A happy hop on the spot.
    hop(height = 8, ms = 380) { return tween(ms, (t) => { this.bobY = -height * Math.sin(Math.PI * t); this.place(); }, linear); }
    // Asleep: the eye stays round and the pupil closes, shrinking to
    // nothing.
    doze(ms = 1400) {
      this.lookAhead();
      const r = this.r * 0.36;
      return tween(ms, (t) => this.pupil.setAttribute("r", (r * (1 - t)).toFixed(2)));
    }
  }

  const me = new Eye({ el: plan.querySelector(".plan-eye") });
  me.lookAt(FRONT[0], 300);

  const scan = async (room, i) => {
    for (const [x, y] of room.sights) {
      const line = shape("line", { class: "plan-ray", x1: me.x, y1: me.y, x2: me.x, y2: me.y }, rays);
      me.lookAt(x, y);
      await tween(170, (t) => {
        line.setAttribute("x2", me.x + (x - me.x) * t);
        line.setAttribute("y2", me.y + (y - me.y) * t);
      });
    }
    me.lookAhead();
    await tween(900, (t) => reveals[i].setAttribute("r", (room.reach * t).toFixed(1)));
    await tween(350, (t) => (rays.style.opacity = 1 - t));
    rays.replaceChildren();
    rays.style.opacity = 1;
  };

  // Setting a piece of furniture down: a little squash as it pops in.
  const setDown = async (name) => {
    const el = item(name), box = el.getBBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    me.lookAt(cx, cy);
    await tween(160, (t) => { me.squint = 1 - 0.25 * t; me.place(); });
    el.style.opacity = 1;
    const pop = (t) => 1 + 0.25 * Math.sin(Math.PI * t) * (1 - t);
    await all(
      tween(420, (t) => el.setAttribute("transform", `translate(${cx} ${cy}) scale(${(t * pop(t)).toFixed(3)}) translate(${-cx} ${-cy})`), linear),
      tween(240, (t) => { me.squint = 0.75 + 0.25 * t; me.place(); })
    );
    el.removeAttribute("transform");
    me.lookAhead();
  };

  // A dimension line drawn along a wall as the eye walks it.
  const measure = async ([x1, y1], [x2, y2], label, [lx, ly]) => {
    await me.walkTo(x1, y1);
    const vertical = x1 === x2;
    const tick = (x, y) => shape("path", { class: "plan-mark", d: vertical ? `M${x - 5} ${y} H${x + 5}` : `M${x} ${y - 5} V${y + 5}` }, marks);
    tick(x1, y1);
    const line = shape("line", { class: "plan-mark", x1, y1, x2: x1, y2: y1 }, marks);
    me.lookAt(x2, y2);
    const x0 = me.x, y0 = me.y;
    await tween(Math.hypot(x2 - x1, y2 - y1) * 11, (t) => {
      me.x = x0 + (x2 - x0) * t;
      me.y = y0 + (y2 - y0) * t;
      line.setAttribute("x2", x1 + (x2 - x1) * t);
      line.setAttribute("y2", y1 + (y2 - y1) * t);
      me.place();
    }, linear);
    tick(x2, y2);
    const text = shape("text", { class: "plan-label", x: lx, y: ly, "text-anchor": "middle", opacity: 0 }, marks, label);
    await tween(300, (t) => text.setAttribute("opacity", t));
    me.lookAhead();
  };

  // Things that float up and fade: music notes, steam, z's.
  const drift = (el, dy, ms, sway = 0) =>
    tween(ms, (t, raw) => {
      el.setAttribute("transform", `translate(${(sway * Math.sin(raw * Math.PI * 2)).toFixed(2)} ${(-dy * raw).toFixed(2)})`);
      el.setAttribute("opacity", (raw < 0.2 ? raw / 0.2 : 1 - (raw - 0.2) / 0.8).toFixed(2));
    }, linear).then(() => el.remove());

  // ---- The family ----
  let partner, kidA, kidB, family = [];

  // At the front door: one by one they come in, each greeted with a hop.
  const welcome = async () => {
    await me.walkTo(215, 276);
    await me.walkTo(FRONT[0], 312);
    me.lookAt(FRONT[0], 360);
    await sleep(500);
    await me.hop(6);
    partner = new Eye();
    kidA = new Eye({ r: 6.5 });
    kidB = new Eye({ r: 6.5 });
    family = [partner, kidA, kidB];
    // Step aside to let them in, as the measurements fade: the house is a
    // home now.
    await all(me.glide(276, 300), tween(1200, (t) => (marks.style.opacity = (1 - t).toFixed(3))));
    marks.replaceChildren();
    marks.style.opacity = "";
    me.lookAt(...FRONT);
    const spots = [[232, 282], [206, 266], [258, 260]];
    for (let k = 0; k < family.length; k++) {
      const f = family[k];
      f.lookAt(FRONT[0], 300);
      await f.glide(FRONT[0], FRONT[1] - 4);
      f.here = 0;
      await all(f.glide(...spots[k]), me.hop(6));
      await all(f.hop(f.r < 10 ? 10 : 6), me.blink());
      me.lookAt(...spots[k]);
      await sleep(250);
    }
    for (const f of family) f.lookAt(me.x, me.y);
    await sleep(600);
    await all(...family.map((f) => f.hop(f.r < 10 ? 9 : 5)));
  };

  // Everyone off somewhere at once, each by their own way through the
  // doorways, setting off a beat apart; by way of a point first, if given,
  // to keep round the furniture.
  const go = (moves) => all(...moves.map(([who, x, y, via], k) => sleep(k * 260).then(async () => {
    if (via) await who.walkTo(...via);
    await who.walkTo(x, y);
  })));

  const watchTV = async () => {
    await go([[me, 112, 306], [partner, 152, 306], [kidA, 112, 272], [kidB, 156, 272]]);
    const screen = item("tv").querySelector(".plan-screen");
    const everyone = [me, partner, kidA, kidB];
    const colours = ["#cfe3e5", "#1d5c63", "#e8d9a8", "#9fc3c7", "#f0c9bd"];
    await tween(11000, (t, raw) => {
      screen.style.fill = colours[Math.floor(raw * 30) % colours.length];
      everyone.forEach((e) => e.lookAt(190, 213));
      // The kids can't sit still; halfway through, the parents share a look.
      kidA.bobY = -2 * Math.abs(Math.sin(raw * Math.PI * 14));
      kidB.bobX = 1.5 * Math.sin(raw * Math.PI * 10);
      if (raw > 0.5 && raw < 0.58) { me.lookAt(partner.x, partner.y); partner.lookAt(me.x, me.y); }
      everyone.forEach((e) => e.place());
    }, linear);
    screen.style.fill = "";
    kidA.bobY = kidB.bobX = 0;
    await all(me.blink(), partner.blink());
  };

  // The parents cook; the kids chase each other round the living room.
  const cook = async () => {
    await go([[me, 405, 101], [partner, 405, 150], [kidA, 80, 262], [kidB, 230, 262]]);
    me.lookAt(437, 100);
    partner.lookAt(437, 150);
    const stir = tween(9000, (t, raw) => {
      me.bobX = 3 * Math.sin(raw * Math.PI * 16);
      me.bobY = 2 * Math.cos(raw * Math.PI * 16);
      partner.bobY = -2 * Math.abs(Math.sin(raw * Math.PI * 9));
      me.place();
      partner.place();
    }, linear);
    const steam = (async () => {
      for (let n = 0; n < 10; n++) {
        drift(shape("path", { class: "plan-steam", d: `M${430 + (n % 3) * 6} 96 q 4 -6 0 -12 q -4 -6 0 -12` }), 26, 1600, 3);
        await sleep(850);
      }
    })();
    // Round and round the living room, one just behind the other.
    const chase = tween(9000, (t, raw) => {
      const a = raw * Math.PI * 2 * 3;
      [[kidA, 0], [kidB, 0.9]].forEach(([k, lag]) => {
        k.x = 155 + 75 * Math.cos(a - lag);
        k.y = 268 + 22 * Math.sin(a - lag);
        k.lookAt(155 + 75 * Math.cos(a - lag + 0.4), 268 + 22 * Math.sin(a - lag + 0.4));
        k.place();
      });
    }, linear);
    await all(stir, steam, chase);
    me.bobX = me.bobY = partner.bobY = 0;
    me.place();
    partner.place();
  };

  // Dinner round the table, a plate each, eaten bite by bite.
  const eat = async () => {
    const seats = [[me, 350, 285, 376, 285], [partner, 430, 285, 404, 285], [kidA, 390, 238, 390, 268], [kidB, 390, 327, 390, 302]];
    await go(seats.map(([who, x, y]) => [who, x, y, who === partner ? [430, 236] : null]));
    const plates = seats.map(([who, , , px, py]) => {
      const plate = shape("circle", { class: "plan-mark", cx: px, cy: py, r: 7 });
      const food = [[-2.5, -1.5], [2.5, -1.5], [0, 2.5]].map(([dx, dy]) => shape("circle", { class: "plan-food", cx: px + dx, cy: py + dy, r: 2 }));
      who.lookAt(px, py);
      return { who, plate, food, px, py };
    });
    await sleep(600);
    for (let bite = 0; bite < 3; bite++) {
      await all(...plates.map(({ who, food, px, py }, k) => sleep(k * 220 + Math.random() * 300).then(async () => {
        const dx = px - who.x, dy = py - who.y, d = Math.hypot(dx, dy);
        await tween(420, (t) => { const s = 5 * Math.sin(Math.PI * t); who.bobX = (dx / d) * s; who.bobY = (dy / d) * s; who.place(); });
        food[bite].remove();
      })));
      await sleep(700);
      // Between bites, a glance around the table.
      plates.forEach(({ who }, k) => { const other = plates[(k + 1 + bite) % plates.length].who; who.lookAt(other.x, other.y); });
      await sleep(500);
      plates.forEach(({ who, px, py }) => who.lookAt(px, py));
    }
    await sleep(500);
    await tween(350, (t) => plates.forEach(({ plate }) => plate.setAttribute("opacity", 1 - t)));
    plates.forEach(({ plate }) => plate.remove());
    await all(...plates.map(({ who }) => who.blink()));
  };

  const danceParty = async () => {
    await go([[me, 120, 262], [partner, 175, 262], [kidA, 95, 290], [kidB, 210, 290]]);
    const everyone = [me, partner, kidA, kidB];
    const notes = (async () => {
      for (let n = 0; n < 16; n++) {
        drift(shape("text", { class: "plan-note", x: 48 + (n % 2) * 8, y: 214 }, fx, n % 3 ? "♪" : "♫"), 34, 1800, 5);
        await sleep(650);
      }
    })();
    await tween(11000, (t, raw) => {
      everyone.forEach((e, k) => {
        const beat = raw * Math.PI * 2 * 14 + k * 0.8;
        e.bobY = -Math.abs((e.r < 10 ? 7 : 9) * Math.sin(beat));
        e.bobX = (e.r < 10 ? 6 : 10) * Math.sin(beat / 2);
        e.squint = 1 - 0.12 * Math.abs(Math.cos(beat));
        e.pupil.setAttribute("cx", (e.r * 0.35 * Math.sin(beat / 2)).toFixed(2));
        e.place();
      });
    }, linear);
    await notes;
    everyone.forEach((e) => { e.bobX = e.bobY = 0; e.squint = 1; e.lookAhead(); e.place(); });
  };

  // Getting the kids ready for bed: a bath (with bubbles) while a parent
  // keeps an eye on them and the other turns down their beds.
  const BEDS = [[225, 126], [305, 126]];
  const bathTime = async () => {
    partner.lookAt(kidA.x, kidA.y);
    await partner.hop(5);
    // The kids share a look first: do they have to?
    kidA.lookAt(kidB.x, kidB.y);
    kidB.lookAt(kidA.x, kidA.y);
    await sleep(900);
    await go([[kidA, 305, 44], [kidB, 305, 63], [partner, 258, 64], [me, 265, 150]]);
    partner.lookAt(305, 54);
    me.lookAt(225, 130);
    // The beds turned down while the kids splash.
    const blankets = BEDS.map(([x]) => shape("rect", { class: "plan-blanket", x: x - 15, y: 134, width: 30, height: 22, rx: 3, opacity: 0 }));
    const turnDown = (async () => {
      for (const [k, b] of blankets.entries()) {
        me.lookAt(BEDS[k][0], 145);
        await tween(500, (t) => b.setAttribute("opacity", t));
        await sleep(500);
      }
      me.lookAt(265, 90);
    })();
    const bubbles = (async () => {
      for (let n = 0; n < 14; n++) {
        drift(shape("circle", { class: "plan-bubble", cx: 296 + (n * 7) % 18, cy: 50 + (n % 3) * 9, r: 1.6 + (n % 3) * 0.8 }), 22, 1500, 3);
        await sleep(400);
      }
    })();
    await all(turnDown, bubbles, tween(6000, (t, raw) => {
      kidA.bobX = 3 * Math.sin(raw * Math.PI * 18);
      kidB.bobY = -2 * Math.abs(Math.sin(raw * Math.PI * 11));
      kidA.lookAt(kidB.x, kidB.y);
      kidB.lookAt(kidA.x + kidA.bobX, kidA.y);
      kidA.place();
      kidB.place();
    }, linear));
    kidA.bobX = kidB.bobY = 0;
  };

  // Out of the bath and teeth brushed at the double sink, brushes going.
  const brushTeeth = async () => {
    await all(kidA.glide(250, 58), kidB.glide(226, 58));
    partner.lookAt(238, 50);
    const brushes = [kidA, kidB].map((k) => shape("line", { class: "plan-brush", x1: k.x - 5, y1: k.y - 9, x2: k.x + 5, y2: k.y - 9 }));
    const foam = (async () => {
      for (let n = 0; n < 8; n++) {
        const k = n % 2 ? kidA : kidB;
        drift(shape("circle", { class: "plan-bubble", cx: k.x + (n % 3) - 1, cy: k.y - 12, r: 1.4 }), 10, 900, 2);
        await sleep(450);
      }
    })();
    await all(foam, tween(4000, (t, raw) => {
      [kidA, kidB].forEach((k, i) => {
        k.lookAt(k.x, 30);
        const s = 4 * Math.sin(raw * Math.PI * 24 + i);
        brushes[i].setAttribute("transform", `translate(${s.toFixed(2)} 0)`);
        k.bobX = s * 0.3;
        k.place();
      });
    }, linear));
    brushes.forEach((b) => b.remove());
    kidA.bobX = kidB.bobX = 0;
    // A little hop each: done!
    await all(kidA.hop(7), sleep(200).then(() => kidB.hop(7)));
    await all(kidA.blink(), kidB.blink(), partner.blink());
  };

  // Into bed, tucked in, a story, and lights out for the kids.
  const storyTime = async () => {
    await go([[kidA, ...BEDS[0]], [kidB, ...BEDS[1]], [partner, 265, 116]]);
    [kidA, kidB].forEach((k) => k.lookAt(265, 150));
    partner.lookAt(265, 150);
    const book = shape("g", { class: "plan-book", opacity: 0 });
    shape("path", { d: "M257 133 L265 136 L273 133 V143 L265 146 L257 143 Z M265 136 V146" }, book);
    const page = shape("path", { d: "M265 136 L271 134 V143 L265 145.5 Z" }, book);
    me.lookAt(265, 138);
    await tween(400, (t) => book.setAttribute("opacity", t));
    // Pages turning, the kids slowly getting heavy-eyed.
    for (let n = 0; n < 4; n++) {
      await sleep(900);
      await tween(450, (t) => page.setAttribute("transform", `translate(265 0) scale(${(1 - 2 * t).toFixed(3)} 1) translate(-265 0)`));
      page.removeAttribute("transform");
      if (n === 1) await kidB.blink(600);
      if (n === 2) await kidA.blink(700);
    }
    await all(kidA.doze(1800), sleep(500).then(() => kidB.doze(1800)));
    await tween(400, (t) => book.setAttribute("opacity", 1 - t));
    book.remove();
    me.lookAt(partner.x, partner.y);
    partner.lookAt(me.x, me.y);
    await sleep(900);
  };

  // The parents tiptoe off to bed, through the bathroom, and the house
  // sleeps, which is where it ends: everyone asleep, a z now and then from
  // each bedroom so it's plain they're sleeping.
  const night = async () => {
    await go([[me, 62, 100], [partner, 98, 100]]);
    await sleep(400);
    me.lookAt(partner.x, partner.y);
    partner.lookAt(me.x, me.y);
    await sleep(700);
    await all(me.doze(1600), partner.doze(1800));
    for (let n = 0; ; n++) {
      drift(shape("text", { class: "plan-z", x: 82 + (n % 3) * 2, y: 90 }, fx, "z"), 30, 2200, 3);
      if (n % 2) drift(shape("text", { class: "plan-z", x: 262, y: 118 }, fx, "z"), 22, 1800, 2);
      await sleep(n < 6 ? 1300 : 2600);
    }
  };

  // Empty from the start, so a phone scrolling down to it never sees the
  // finished plan vanish.
  plan.querySelectorAll(".plan-item").forEach((el) => (el.style.opacity = 0));
  walls.setAttribute("mask", "url(#plan-built)");

  const run = async () => {
    // In through the front door, then each room in turn.
    await sleep(400);
    await me.glide(FRONT[0], FRONT[1] - 2);
    for (let i = 0; i < rooms.length; i++) {
      await me.walkTo(rooms[i].cx, rooms[i].cy);
      await sleep(200);
      await scan(rooms[i], i);
      await sleep(250);
    }
    await sleep(900);
    await me.blink();
    await sleep(700);

    // Measuring up, a wall in each room big enough to take a dimension,
    // from the bedroom, where the scan ends, round to the living room.
    await measure([182, 30], [182, 190], "15′", [168, 114]);
    await sleep(400);
    await measure([212, 182], [318, 182], "10′", [265, 175]);
    await sleep(400);
    await measure([345, 32], [345, 188], "15′", [359, 114]);
    await sleep(400);
    await measure([450, 322], [310, 322], "13′", [340, 315]);
    await sleep(400);
    await measure([290, 266], [30, 266], "23′", [160, 260]);
    await sleep(700);

    // Moving in: furniture, room by room, in the order it scanned them.
    // From the speaker, round under the TV to the dining room.
    const furnish = [
      ["tv", 190, 240], ["sofa", 130, 280], ["speaker", 70, 228], ["table", 348, 285, [200, 262]],
      ["counter", 400, 150], ["stove", 405, 101], ["kidbeds", 265, 150], ["sink", 238, 62],
      ["tub", 272, 58], ["bed", 150, 90],
    ];
    for (const [name, x, y, via] of furnish) {
      if (via) await me.walkTo(...via);
      await me.walkTo(x, y);
      await setDown(name);
      await sleep(350);
    }

    // The family arrives, and the house fills up.
    await welcome();
    await sleep(600);
    await watchTV();
    await sleep(600);
    await cook();
    await sleep(600);
    await eat();
    await sleep(600);
    await danceParty();
    await sleep(700);
    await bathTime();
    await sleep(500);
    await brushTeeth();
    await sleep(500);
    await storyTime();
    await night();
  };

  // Only once the drawing is actually on screen: straight away on desktop,
  // where it sits beside the headline, and when scrolled to on phones,
  // where it sits below the buttons.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries, seen) => {
      if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); run(); }
    }, { threshold: 0.5 }).observe(plan);
  } else run();
}

// ---------- the mascot at the foot of the home page ----------
// The logo again, in a strip above the footer, with the eye living its life
// there. It starts out too scared to leave the letters, works up the
// courage to climb down, and from then on plays in the yard (basketball,
// football, bowling, ice fishing) between moods, leaps and runs along the
// ground, in a yard a few logos wide. It starts when scrolled into view.
const mascot = document.querySelector(".mascot .loader");
if (mascot && "IntersectionObserver" in window) {
  // The yard, in the drawing's units, the same whatever the screen: the
  // logo is drawn so its dot is the size the eye is everywhere else, and
  // the yard spans about ten logos across, so on a phone held upright its
  // far ends (the ice, the bowling pins) are just off the screen's edges
  // and come into view turned sideways. Runs keep nearer in. The eye's
  // offsets run from 0 (its left edge at x 0) to these, 310 across.
  const YARD = { left: -4900, right: 5480, runs: { left: -2400, right: 2700 } };
  const roam = () => YARD;
  const life = character(mascot, { roam });
  new IntersectionObserver((entries, seen) => {
    if (entries.some((e) => e.isIntersecting)) {
      life.start();
      seen.disconnect();
    }
  }, { threshold: 0.4 }).observe(mascot);
}

