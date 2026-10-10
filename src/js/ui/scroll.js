// Scroll position -> (active step, progress through its transition).
//
// A step becomes active when its top crosses the enter line; its
// transition runs until its top reaches the settle line.

const LINES = { wide: { enter: 0.82, settle: 0.42 }, narrow: { enter: 0.92, settle: 0.66 } };
const lines = () => {
  const l = window.innerWidth <= 900 ? LINES.narrow : LINES.wide;
  return { enterY: window.innerHeight * l.enter, settleY: window.innerHeight * l.settle };
};

export function scrollState(stepEls, reduceMotion) {
  const { enterY, settleY } = lines();
  let i = 0;
  for (let j = 0; j < stepEls.length; j++) {
    if (stepEls[j].getBoundingClientRect().top <= enterY) i = j; else break;
  }
  const top = stepEls[i].getBoundingClientRect().top;
  const p = i === 0 ? 1 : Math.max(0, Math.min(1, (enterY - top) / (enterY - settleY)));
  return { i, p: reduceMotion ? 1 : p };
}

// The window.scrollY at which `stepEl` is at progress p of its transition.
export function scrollYFor(stepEl, p) {
  const { enterY, settleY } = lines();
  return stepEl.getBoundingClientRect().top + window.scrollY - (enterY - p * (enterY - settleY));
}
