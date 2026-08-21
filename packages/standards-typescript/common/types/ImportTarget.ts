import type { ImportTargetKind } from '../constants/ImportTargetKind.ts';
/**
 * What one module specifier points at, once the run's file list and the
 * importing package's path aliases have both been consulted.
 *
 * Three answers rather than "a path or nothing", because the two ways of
 * naming no file in scope are different facts and the rules that ask need to
 * tell them apart. `external` is a published package or a builtin: there is no
 * local file and there never was. `unknown` is a specifier that could name a
 * local file, where the mapping needed to say which one was not available —
 * an alias whose tsconfig the run never listed, or one inherited through an
 * `extends` chain this package does not follow.
 *
 * Collapsing those two into `undefined` is what let a rule read "I could not
 * resolve this barrel" as "this barrel exports nothing" and report every test
 * in a package as testing a private internal.
 */
export type ImportTarget =
	| { kind: typeof ImportTargetKind.File; path: string }
	| { kind: typeof ImportTargetKind.External }
	| { kind: typeof ImportTargetKind.Unknown };
