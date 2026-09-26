/**
 * The unit box a sprawl lane is laid out in.
 *
 * `scripts/renderSprawlSvg.mjs` scales it up to the README image's lane band
 * and hands the same numbers to `buildSprawlLayout`, so the layout and the
 * renderer read one constant rather than two copies kept in step by hand.
 */
export const sprawlUnitBox = { width: 100, height: 20 };
