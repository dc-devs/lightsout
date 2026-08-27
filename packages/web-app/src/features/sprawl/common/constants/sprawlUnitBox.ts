/**
 * The unit box every renderer of a sprawl lane draws in.
 *
 * `SprawlChart` sets it as its `viewBox` and sizes the SVG with CSS;
 * `scripts/renderSprawlSvg.mjs` scales it up to the README image's lane band.
 * Both hand these numbers to `buildSprawlLayout`, so it is one constant rather
 * than a number copied into each renderer with a comment asking the next reader
 * to keep the two in step.
 */
export const sprawlUnitBox = { width: 100, height: 20 };
