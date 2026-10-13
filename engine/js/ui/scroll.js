// Scroll position -> (active step, progress through its transition).
//
// A step becomes active when its top crosses the enter line; its
// transition runs until its top reaches the settle line. `u` is the
// progress through the whole time it's active, until the next step
// enters, for things that play out over a step's full length.
//
// A step with the class `step-scrub` has a transition as long as the
// step itself: its p runs over its whole length (reaching 1 a little
// before the next step enters, so it still settles), for a step with a
// lot to play. (An explainer makes it as tall as that needs.)

const LINES = { wide: { enter: 0.82, settle: 0.42 }, narrow: { enter: 0.92, settle: 0.66 } };
const lines = () => {
  const l = window.innerWidth <= 900 ? LINES.narrow : LINES.wide;
  return { enterY: window.innerHeight * l.enter, settleY: window.innerHeight * l.settle };
};
// (a scrubbing step settles this far through its length)
const SCRUB_END = 0.9;

const isScrub = (el) => el.classList.contains('step-scrub');
// The distance from a step's top to the next step's, or its height.
function spanOf(el) {
  let next = el.nextElementSibling;
  while (next && !next.classList.contains('step')) next = next.nextElementSibling;
  return next ? next.getBoundingClientRect().top - el.getBoundingClientRect().top : el.getBoundingClientRect().height;
}

export function scrollState(stepEls, reduceMotion) {
  const { enterY, settleY } = lines();
  let i = 0;
  for (let j = 0; j < stepEls.length; j++) {
    if (stepEls[j].getBoundingClientRect().top <= enterY) i = j; else break;
  }
  const top = stepEls[i].getBoundingClientRect().top;
  const next = stepEls[i + 1];
  const span = next ? next.getBoundingClientRect().top - top : stepEls[i].getBoundingClientRect().height;
  const u = Math.max(0, Math.min(1, (enterY - top) / Math.max(1, span)));
  // (the first step too: before it's scrolled in, under the title,
  // it's at 0, and nothing it points at shows yet)
  const p = isScrub(stepEls[i]) ? Math.min(1, u / SCRUB_END)
    : Math.max(0, Math.min(1, (enterY - top) / (enterY - settleY)));
  return { i, p: reduceMotion ? 1 : p, u: reduceMotion ? 1 : u };
}

// The window.scrollY at which `stepEl` is at progress p of its
// transition; p > 1 is further into the step (for a scrubbing step,
// into what's left of it, short of the next).
export function scrollYFor(stepEl, p) {
  const { enterY, settleY } = lines();
  const top = stepEl.getBoundingClientRect().top + window.scrollY;
  if (isScrub(stepEl)) {
    const u = p <= 1 ? SCRUB_END * p : SCRUB_END + Math.min(1, p - 1) * (1 - SCRUB_END) * 0.9;
    return top - enterY + u * spanOf(stepEl);
  }
  return top - (enterY - p * (enterY - settleY));
}
