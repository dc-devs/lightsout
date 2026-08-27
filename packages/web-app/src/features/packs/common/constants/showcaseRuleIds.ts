/**
 * The rules the pack page leads with, in this order.
 *
 * A constant rather than something inferred from the pack: six rules chosen
 * because each one reads in a five-line example, and together they cover types,
 * function shape, constants, files and tests. A pack free to drop or rename a
 * rule is why the strip skips an id it cannot find rather than breaking.
 */
export const showcaseRuleIds = ['type-assertion', 'object-args', 'bare-string-union', 'explicit-return-type', 'multi-export', 'test-shared-let'] as const;
