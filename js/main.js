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
  const OUTSIDE = { i: -268, l: 845 };

  // ---- The yard: props on the ground, when there's room to roam ----
  // A crate on the left, a bench on the right, and a ball, in the drawing's
  // units, placed once the eye first starts and the screen's width is known.
  // Positions are the x range of each footprint; the eye's x offset is also
  // its left edge, so it overlaps something when x + 310 > x0 and x < x1.
  const FLOOR = 1752, BALL_R = 110;
  let props = [], ball = null;
  const SVGNS = "http://www.w3.org/2000/svg";
  const draw = (tag, attrs, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    parent.append(el);
    return el;
  };
  const setUpYard = () => {
    const { left, right } = roam();
    const layer = draw("g", { class: "ilv-yard" }, svg);
    svg.insertBefore(layer, svg.querySelector("g"));
    // Each side's stretch of ground, kept clear of where the eye lands when
    // it hops down off a letter.
    const zones = {
      [-1]: [left, OUTSIDE.i - 120],
      [1]: [OUTSIDE.l + 310 + 120, right + 310],
    };
    const along = ([a, b], f) => a + (b - a) * f;
    const room = (side) => zones[side][1] - zones[side][0];
    if (room(-1) > 1500) {
      const x0 = along(zones[-1], 0.4), top = FLOOR - 300;
      props.push({ x0, x1: x0 + 300, top });
      const g = draw("g", { class: "ilv-prop" }, layer);
      draw("rect", { x: x0, y: top, width: 300, height: 300, rx: 14 }, g);
      draw("path", { d: `M${x0 + 30} ${top + 30} L${x0 + 270} ${FLOOR - 30} M${x0 + 270} ${top + 30} L${x0 + 30} ${FLOOR - 30}` }, g);
    }
    if (room(1) > 1800) {
      const x0 = along(zones[1], 0.5), top = FLOOR - 190;
      props.push({ x0, x1: x0 + 620, top });
      const g = draw("g", { class: "ilv-prop" }, layer);
      draw("rect", { x: x0, y: top, width: 620, height: 56, rx: 18 }, g);
      draw("path", { d: `M${x0 + 70} ${top + 56} V${FLOOR} M${x0 + 550} ${top + 56} V${FLOOR}` }, g);
    }
    // The ball goes on the roomier side, between the letters and its prop.
    const side = room(1) >= room(-1) ? 1 : -1;
    if (room(side) > 1100) {
      const [a, b] = zones[side];
      const bx = side > 0 ? a + Math.min(700, (b - a) * 0.25) : b - Math.min(700, (b - a) * 0.25);
      const g = draw("g", { class: "ilv-ball" }, layer);
      draw("circle", { cx: bx, cy: FLOOR - BALL_R, r: BALL_R }, g);
      draw("path", { d: `M${bx - BALL_R} ${FLOOR - BALL_R} Q${bx} ${FLOOR - BALL_R - 70} ${bx + BALL_R} ${FLOOR - BALL_R} M${bx} ${FLOOR - 2 * BALL_R} Q${bx + 60} ${FLOOR - BALL_R} ${bx} ${FLOOR}` }, g);
      ball = { el: g, x: bx, x0: bx, spin: 0, side, zone: zones[side] };
    }
  };

  const propAt = (x) => props.find((p) => x + 310 > p.x0 && x < p.x1);
  const onTopOf = (p) => p.top - 155 - 158;
  const onGround = () => cy >= GROUND - 5;
  const hitsBall = (x) => ball && x + 310 > ball.x - BALL_R && x < ball.x + BALL_R;

  // Rolling the ball: away it goes, spinning, until it nears the edge of
  // its stretch of ground or meets a prop.
  const roll = async (dir, distance) => {
    const [a, b] = ball.zone;
    let to = ball.x + dir * distance;
    to = Math.max(a + BALL_R + 450, Math.min(b - BALL_R - 450, to));
    for (const p of props) {
      if (dir > 0 && p.x0 >= ball.x + BALL_R) to = Math.min(to, p.x0 - BALL_R);
      if (dir < 0 && p.x1 <= ball.x - BALL_R) to = Math.max(to, p.x1 + BALL_R);
    }
    const moved = to - ball.x;
    if (Math.abs(moved) < 40) return false;
    const spin = ball.spin + (moved / BALL_R) * (180 / Math.PI);
    await play(ball.el, [
      { transform: `translateX(${ball.x - ball.x0}px) rotate(${ball.spin}deg)` },
      { transform: `translateX(${to - ball.x0}px) rotate(${spin}deg)` },
    ], { duration: 450 + Math.abs(moved) * 0.6, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)" });
    ball.x = to;
    ball.spin = spin;
    return true;
  };
  // A kick: a lunge at the ball as it rolls off.
  const kick = (dir, distance = rand(700, 1300)) => {
    fromBase();
    return Promise.all([
      play(dot, [{ transform: "none" }, { transform: `translateX(${dir * 50}px) scale(1.16, 0.86)`, offset: 0.35 }, { transform: "none" }], { duration: 360, easing: "ease-out" }),
      sleep(110).then(() => roll(dir, distance)),
    ]);
  };
  // Over the ball, landing on the ground or a prop beyond it.
  const hopOver = async (dir) => {
    const x = dir > 0 ? ball.x + BALL_R + 20 : ball.x - BALL_R - 310 - 20;
    const p = propAt(x);
    await leap(x, p ? onTopOf(p) : GROUND, { rise: 230, ms: 620, crouch: true });
  };

  // Moving along the ground to x: up onto a prop in the way, along its top,
  // down off the far end, and the ball knocked ahead or hopped over. Steps
  // never overshoot x.
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
      if (onGround() && hitsBall(next)) {
        if (!(await kick(dir, rand(500, 900)))[1]) await hopOver(dir);
        continue;
      }
      await stride(next, ms);
    }
  };

  const ADVENTURES = {
    // Over the edge of the l: a peek, a climb down the far side, a fright,
    // and a scramble back up.
    farSide: {
      when: () => on === "l",
      run: async () => {
        await eyeOpen();
        await lookTo(REACH, 40, 600);
        await sleep(500);
        await leap(FAR_WALL, -58, { rise: 120, ms: 620, across: "early", arrive: { wall: -1 } });
        await lookTo(0, 50, 300);
        for (const y of [142, 342, 542]) {
          await step(FAR_WALL, y, 520);
          await sleep(rand(180, 380));
        }
        await lookTo(0, 55, 500);
        await sleep(400);
        // Too far: a fright, then up and out as fast as it can go.
        await Promise.all([play(pupil, [{ transform: look(0, 55) }, { transform: look(0, -20, " scale(0.35)") }], { duration: 160, easing: "ease-out" }), tremble(900)]);
        for (const y of [342, 142, -58]) await step(FAR_WALL, y, 220);
        await leap(PERCH.l.x, PERCH.l.y, { rise: 160, ms: 560, across: "late", arrive: onto("l") });
        await lookTo(0, 0, 500);
        await sleep(300);
        await eyeClose();
      },
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

    // Down to the ground outside a letter, a run off to the side, a look
    // back, a run home and a big leap up.
    groundRun: {
      when: () => true,
      run: async () => {
        const home = on, side = on === "i" ? -1 : 1;
        await eyeOpen();
        await lookTo(side * REACH, 45, 500);
        await sleep(300);
        await leap(OUTSIDE[home], GROUND, { rise: 120, ms: 820, across: "early" });
        await lookTo(side * REACH, 0, 300);
        // How far: a short dash, or with room to roam, anywhere from a third
        // of the way to nearly the edge of the screen, at a longer stride.
        const start = OUTSIDE[home];
        const edge = roam ? (side < 0 ? roam().left : roam().right) : start + side * 650;
        const span = Math.max(0, Math.abs(edge - start)) * (roam ? rand(0.6, 0.95) : 1);
        const length = roam ? 260 : 130;
        await moveTo(start + side * span, 230, length);
        await sleep(300);
        await lookTo(-side * REACH, 0, 250);
        await sleep(500);
        await moveTo(start, 230, length);
        await lookTo(0, -REACH, 400);
        await sleep(300);
        await leap(PERCH[home].x, PERCH[home].y, { rise: 180, ms: 950, across: "late", arrive: onto(home) });
        await lookTo(0, 0, 400);
        await sleep(250);
        await eyeClose();
      },
    },
    // With a ball in the yard: down to it, a couple of kicks and a chase, a
    // hop over it, a kick back, a little celebration, and home.
    kickball: {
      when: () => !!ball,
      run: async () => {
        const side = ball.side, perch = side < 0 ? "i" : "l";
        if (on !== perch) await jump();
        await eyeOpen();
        await lookTo(side * REACH, 45, 400);
        await leap(OUTSIDE[perch], GROUND, { rise: 120, ms: 820, across: "early" });
        // Standing just short of the ball, on the side away from `dir`.
        const behind = (dir) => (dir > 0 ? ball.x - BALL_R - 310 - 6 : ball.x + BALL_R + 6);
        for (let k = 0; k < 2; k++) {
          await lookTo(side * REACH, 10, 250);
          await moveTo(behind(side), 230);
          await sleep(rand(200, 500));
          await kick(side);
          await sleep(200);
        }
        await moveTo(behind(side), 230);
        await lookTo(side * REACH, -REACH, 300);
        await hopOver(side);
        await lookTo(-side * REACH, 10, 300);
        await sleep(400);
        await kick(-side, rand(500, 900));
        await sleep(300);
        // Goal!
        await play(pupil, [{ transform: pupil.style.transform || "none" }, { transform: look(0, -14, " scale(1.4)") }], { duration: 250 });
        for (let n = 0; n < 2; n++) await leap(cx, cy, { rise: 160, ms: 420, crouch: n === 0 });
        await play(pupil, [{ transform: look(0, -14, " scale(1.4)") }, { transform: "none" }], { duration: 250 });
        await moveTo(OUTSIDE[perch], 230);
        await lookTo(0, -REACH, 400);
        await leap(PERCH[perch].x, PERCH[perch].y, { rise: 180, ms: 950, across: "late", arrive: onto(perch) });
        on = perch;
        await lookTo(0, 0, 400);
        await sleep(250);
        await eyeClose();
      },
    },

    // With room to roam only: down to the ground, nearly to one edge of the
    // screen, all the way across to the other, then home.
    crossing: {
      when: () => !!roam,
      run: async () => {
        const home = on, side = on === "i" ? -1 : 1, start = OUTSIDE[home], length = 300;
        const { left, right } = roam();
        const near = side < 0 ? left : right, far = side < 0 ? right : left;
        const runTo = (x, ms) => moveTo(x, ms, length);
        await eyeOpen();
        await lookTo(side * REACH, 45, 400);
        await leap(start, GROUND, { rise: 120, ms: 820, across: "early" });
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
        await lookTo(0, -REACH, 400);
        await sleep(250);
        await leap(PERCH[home].x, PERCH[home].y, { rise: 180, ms: 950, across: "late", arrive: onto(home) });
        await lookTo(0, 0, 400);
        await sleep(250);
        await eyeClose();
      },
    },
  };
  let lastAdventure = "";
  const adventure = () => {
    // With room to roam, the ground adventures come up twice as often.
    const pool = [...Object.keys(ADVENTURES), ...(roam ? ["groundRun", "crossing", "kickball"] : [])];
    const names = pool.filter((n) => n !== lastAdventure && ADVENTURES[n].when());
    if (!names.length) return jump();
    lastAdventure = names[Math.floor(Math.random() * names.length)];
    svg.dataset.adventure = lastAdventure;
    return ADVENTURES[lastAdventure].run().finally(() => delete svg.dataset.adventure);
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
      // Usually the plain leap; often something more adventurous instead,
      // more often still when there's room to roam.
      await (Math.random() < (roam ? 0.6 : 0.45) ? adventure() : jump());
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
      if (roam && !props.length && !ball) setUpYard();
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
      await sleep(100);
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

// ---------- hero: the eye scans, builds, then lives in the floor plan ----------
// The plan starts empty. The eye comes in through the front opening and goes
// room to room, only ever through doorways. In each room it glances along
// dotted lines of sight to the corners and walls, and the room's walls build
// in, spreading out from the eye. Then it moves in: furnishes the place,
// measures two walls, watches TV, makes dinner, eats it, dances, and goes to
// bed, where it stays asleep. Once through, about two minutes, never
// repeated. Desktop only: phones don't show the drawing. With reduced motion
// (or without JavaScript) the plan is shown finished, furnished, eye asleep.
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
  const eye = plan.querySelector(".plan-eye");
  const pupil = plan.querySelector(".plan-eye-pupil");
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
  const shape = (tag, attrs, parent = fx, text = "") => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  };

  // The eye: where it is, how squinted, and a bob layered on top for
  // dancing and nodding along.
  let ex = 315, ey = -24, squint = 1, bobX = 0, bobY = 0;
  const place = () => eye.setAttribute("transform", `translate(${(ex + bobX).toFixed(2)} ${(ey + bobY).toFixed(2)}) scale(1 ${squint.toFixed(3)})`);
  // The pupil leans towards what it's looking at, never past the eye's rim.
  const lookAt = (x, y) => {
    const dx = x - ex, dy = y - ey, d = Math.hypot(dx, dy) || 1, k = Math.min(5.2, d) / d;
    pupil.setAttribute("cx", (dx * k).toFixed(2));
    pupil.setAttribute("cy", (dy * k).toFixed(2));
  };
  const lookAhead = () => { pupil.setAttribute("cx", 0); pupil.setAttribute("cy", 0); };

  // Which room a point is in, and the doors from one room to another.
  let here = -1; // outside
  const roomAt = (x, y) => rooms.findIndex((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  const route = (from, to) => {
    if (from === to || from < 0) return [];
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

  // Gliding in a straight line, looking where it's going.
  const glide = async (x, y) => {
    const fx0 = ex, fy0 = ey;
    lookAt(x, y);
    await tween(Math.max(300, Math.hypot(x - fx0, y - fy0) * 8), (t) => {
      ex = fx0 + (x - fx0) * t;
      ey = fy0 + (y - fy0) * t;
      place();
    });
  };
  // Walking anywhere: through each doorway on the way, never a wall.
  const walkTo = async (x, y) => {
    const to = roomAt(x, y);
    for (const [dx, dy] of route(here, to)) await glide(dx, dy);
    await glide(x, y);
    here = to;
    lookAhead();
  };

  const scan = async (room, i) => {
    for (const [x, y] of room.sights) {
      const line = shape("line", { class: "plan-ray", x1: ex, y1: ey, x2: ex, y2: ey }, rays);
      lookAt(x, y);
      await tween(170, (t) => {
        line.setAttribute("x2", ex + (x - ex) * t);
        line.setAttribute("y2", ey + (y - ey) * t);
      });
    }
    lookAhead();
    await tween(900, (t) => reveals[i].setAttribute("r", (room.reach * t).toFixed(1)));
    await tween(350, (t) => (rays.style.opacity = 1 - t));
    rays.replaceChildren();
    rays.style.opacity = 1;
  };

  const blink = (ms = 320) => tween(ms, (t) => { squint = 1 - 0.85 * Math.sin(Math.PI * t); place(); }, linear);
  // Setting something down: a little squash as it pops into place.
  const setDown = async (name) => {
    const el = item(name), box = el.getBBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    lookAt(cx, cy);
    await tween(160, (t) => { squint = 1 - 0.25 * t; place(); });
    el.style.opacity = 1;
    const pop = (t) => 1 + 0.25 * Math.sin(Math.PI * t) * (1 - t);
    await Promise.all([
      tween(420, (t) => el.setAttribute("transform", `translate(${cx} ${cy}) scale(${(t * pop(t)).toFixed(3)}) translate(${-cx} ${-cy})`), linear),
      tween(240, (t) => { squint = 0.75 + 0.25 * t; place(); }),
    ]);
    el.removeAttribute("transform");
    lookAhead();
  };

  // A dimension line drawn along a wall as the eye walks it.
  const measure = async ([x1, y1], [x2, y2], label, [lx, ly]) => {
    await walkTo(x1, y1);
    const vertical = x1 === x2;
    const tick = (x, y) => shape("path", { class: "plan-mark", d: vertical ? `M${x - 5} ${y} H${x + 5}` : `M${x} ${y - 5} V${y + 5}` }, marks);
    tick(x1, y1);
    const line = shape("line", { class: "plan-mark", x1, y1, x2: x1, y2: y1 }, marks);
    lookAt(x2, y2);
    const fx0 = ex, fy0 = ey;
    await tween(Math.hypot(x2 - x1, y2 - y1) * 11, (t) => {
      ex = fx0 + (x2 - fx0) * t;
      ey = fy0 + (y2 - fy0) * t;
      line.setAttribute("x2", x1 + (x2 - x1) * t);
      line.setAttribute("y2", y1 + (y2 - y1) * t);
      place();
    }, linear);
    tick(x2, y2);
    const text = shape("text", { class: "plan-label", x: lx, y: ly, "text-anchor": "middle", opacity: 0 }, marks, label);
    await tween(300, (t) => text.setAttribute("opacity", t));
    lookAhead();
  };

  // Things that float up and fade: music notes, steam, z's.
  const drift = (el, dy, ms, sway = 0) => {
    const x0 = +el.getAttribute("x") || 0;
    return tween(ms, (t, raw) => {
      el.setAttribute("transform", `translate(${(sway * Math.sin(raw * Math.PI * 2)).toFixed(2)} ${(-dy * raw).toFixed(2)})`);
      el.setAttribute("opacity", (raw < 0.2 ? raw / 0.2 : 1 - (raw - 0.2) / 0.8).toFixed(2));
    }, linear).then(() => el.remove());
  };

  const watchTV = async () => {
    await walkTo(130, 306);
    const screen = item("tv").querySelector(".plan-screen");
    lookAt(190, 213);
    const colours = ["#cfe3e5", "#1d5c63", "#e8d9a8", "#9fc3c7", "#f0c9bd"];
    const flicker = tween(10000, (t, raw) => {
      screen.style.fill = colours[Math.floor(raw * 28) % colours.length];
      // Every so often, a glance away and back.
      raw > 0.45 && raw < 0.52 ? lookAt(60, 330) : lookAt(190, 213);
    }, linear);
    await flicker;
    screen.style.fill = "";
    await blink();
  };

  const makeDinner = async () => {
    await walkTo(405, 101);
    lookAt(437, 100);
    const stir = tween(8500, (t, raw) => { bobX = 3 * Math.sin(raw * Math.PI * 16); bobY = 2 * Math.cos(raw * Math.PI * 16); place(); }, linear);
    for (let n = 0; n < 9; n++) {
      const puff = shape("path", { class: "plan-steam", d: `M${430 + (n % 3) * 6} 96 q 4 -6 0 -12 q -4 -6 0 -12` });
      drift(puff, 26, 1600, 3);
      await sleep(850);
    }
    await stir;
    bobX = bobY = 0;
    place();
  };

  const eatDinner = async () => {
    await walkTo(348, 285);
    const plate = shape("circle", { class: "plan-mark", cx: 376, cy: 285, r: 9 });
    const food = [[373, 283], [379, 283], [376, 289]].map(([x, y]) => shape("circle", { class: "plan-food", cx: x, cy: y, r: 2.4 }));
    lookAt(376, 285);
    await sleep(500);
    for (const bite of food) {
      await tween(420, (t) => { bobX = 6 * Math.sin(Math.PI * t); place(); });
      bite.remove();
      await sleep(900);
    }
    await sleep(500);
    await tween(300, (t) => plate.setAttribute("opacity", 1 - t));
    plate.remove();
    await blink();
  };

  const dance = async () => {
    await walkTo(150, 262);
    const notes = (async () => {
      for (let n = 0; n < 12; n++) {
        const note = shape("text", { class: "plan-note", x: 48 + (n % 2) * 8, y: 214 }, fx, n % 3 ? "♪" : "♫");
        drift(note, 34, 1800, 5);
        await sleep(700);
      }
    })();
    await tween(9600, (t, raw) => {
      const beat = raw * Math.PI * 2 * 12;
      bobY = -Math.abs(9 * Math.sin(beat));
      bobX = 10 * Math.sin(beat / 2);
      squint = 1 - 0.12 * Math.abs(Math.cos(beat));
      pupil.setAttribute("cx", (3.5 * Math.sin(beat / 2)).toFixed(2));
      place();
    }, linear);
    await notes;
    bobX = bobY = 0;
    squint = 1;
    lookAhead();
    place();
  };

  // Last: bed. Its eye closes, a few z's, and there it stays.
  const goToBed = async () => {
    await walkTo(78, 100);
    await sleep(400);
    await tween(1400, (t) => { squint = 1 - 0.85 * t; place(); });
    for (let n = 0; n < 4; n++) {
      drift(shape("text", { class: "plan-z", x: 92 + n * 2, y: 92 }, fx, "z"), 30, 2200, 3);
      await sleep(1300);
    }
  };

  const run = async () => {
    plan.querySelectorAll(".plan-item").forEach((el) => (el.style.opacity = 0));
    walls.setAttribute("mask", "url(#plan-built)");
    place();
    lookAt(315, 60);
    // In through the front opening, then each room in turn.
    await sleep(400);
    await glide(315, 22);
    for (let i = 0; i < rooms.length; i++) {
      await walkTo(rooms[i].cx, rooms[i].cy);
      await sleep(200);
      await scan(rooms[i], i);
      await sleep(250);
    }
    await sleep(900);
    await blink();
    await sleep(700);

    // Moving in: furniture, room by room, from the kitchen round to the bath.
    const furnish = [
      ["counter", 400, 150], ["stove", 405, 101], ["table", 348, 285], ["tv", 190, 240],
      ["sofa", 130, 280], ["speaker", 70, 228], ["bed", 150, 90], ["tub", 230, 160],
    ];
    for (const [name, x, y] of furnish) {
      await walkTo(x, y);
      await setDown(name);
      await sleep(350);
    }
    // Measuring up.
    await measure([182, 30], [182, 190], "15′", [168, 114]);
    await sleep(400);
    // Right to left, below the speaker, so the walk there stays clear of it.
    await measure([290, 266], [30, 266], "23′", [160, 260]);
    await sleep(600);
    // Settling in.
    await watchTV();
    await sleep(500);
    await makeDinner();
    await sleep(500);
    await eatDinner();
    await sleep(500);
    await dance();
    await sleep(600);
    await goToBed();
  };

  // Only once the drawing is actually on screen (desktop widths).
  const wide = matchMedia("(min-width: 821px)");
  let started = false;
  const go = () => { if (!started && wide.matches) { started = true; run(); } };
  go();
  wide.addEventListener("change", go);
}

// ---------- the mascot at the foot of the home page ----------
// The logo again, in a full-width strip above the footer, with the eye
// living its life there: moods, leaps, adventures, and runs that can reach
// most of the way to either edge of the screen. It starts when scrolled
// into view.
const mascot = document.querySelector(".mascot .loader");
if (mascot && "IntersectionObserver" in window) {
  const VIEW = mascot.viewBox.baseVal;
  // An offset of 0 puts the dot's left edge at x 0 and its right edge at
  // 310 (it's 310 across). Between these it stays 160 units clear of either
  // screen edge, room for its squash and float.
  const roam = () => {
    const box = mascot.getBoundingClientRect();
    const perPx = VIEW.width / box.width;
    const leftEdge = VIEW.x - box.left * perPx;
    const rightEdge = VIEW.x + (innerWidth - box.left) * perPx;
    return { left: leftEdge + 160, right: rightEdge - 310 - 160 };
  };
  const life = character(mascot, { roam });
  new IntersectionObserver((entries, seen) => {
    if (entries.some((e) => e.isIntersecting)) {
      life.start();
      seen.disconnect();
    }
  }, { threshold: 0.4 }).observe(mascot);
}

