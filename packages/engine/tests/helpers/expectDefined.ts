import { expect } from '@jest/globals';

/**
 * Assert a value is present, and narrow away the `undefined`/`null` for every
 * line that follows.
 *
 * `assert.ok(value)` was a type-assertion function, so a lookup like
 * `prompts.find(...)` was narrowed for the rest of the test.
 * `expect(value).toBeTruthy()` narrows nothing, and the obvious repair —
 * optional chaining at each use — is **weaker than what it replaces**:
 * `expect(maybe?.prompt.includes('x')).toBeFalsy()` passes when `maybe` is
 * undefined, because `undefined?.…` short-circuits to `undefined`, which is
 * falsy. Every negative assertion downstream of a missing value would silently
 * pass. This keeps the presence check where it belongs — before the
 * dereferences — and restores the narrowing that made them legal.
 *
 * Positional parameter rather than the codebase's usual options object: an
 * assertion signature can only narrow a named parameter, and the explicit type
 * annotation on the const is required for TypeScript to accept assertion calls.
 */
export const expectDefined: <Value>(value: Value) => asserts value is NonNullable<Value> = (value) => {
	expect(value).toBeTruthy();
};
