import { expect } from '@jest/globals';

/**
 * Assert which member of a `status`-discriminated union a result is, and narrow
 * it for every line that follows.
 *
 * This restores what `node:assert` gave for free. `assert.ok(result.status === 'complete')`
 * was a type-assertion function, so TypeScript narrowed the union and
 * `result.planPaths` existed afterwards. `expect(...).toBeTruthy()` asserts
 * nothing to the type system, so the property is not on the union at all and the
 * error is `Property 'planPaths' does not exist` — which optional chaining cannot
 * fix, because there is nothing to chain off yet.
 *
 * Positional parameters rather than the codebase's usual options object: an
 * assertion signature can only narrow a named parameter, so `asserts value is …`
 * has no way to refer to a destructured field. The explicit type annotation on
 * the const is also required — TypeScript rejects assertion calls whose target
 * lacks one.
 */
export const expectStatus: <Value extends { status: string }, Tag extends Value['status']>(
	value: Value,
	status: Tag,
) => asserts value is Extract<Value, { status: Tag }> = (value, status) => {
	expect(value.status).toBe(status);
};
