import { z } from 'zod';
import { GateResult } from '../gates/GateResult';
import { ScanFinding } from '../scan/ScanFinding';
import { VerifyBasis } from './VerifyBasis';
import { VerifyVerdict } from './VerifyVerdict';

/**
 * The sectioned report `lightsout verify` writes to `.lightsout/verify.json`
 * on every run. The consumer is an agent loop that reads the file after each
 * `lightsout verify` and fixes the reported reds before re-running — native
 * sections, no lossy flattening.
 */
export const VerifyReport = z.object({
	at: z.string(),
	basis: z.enum(VerifyBasis),
	/** Present iff basis is 'base-ref'. */
	baseRef: z.string().optional(),
	/** The verified basis: generated prefixes and .lightsout/ already filtered. */
	changedFiles: z.array(z.string()),
	/** Package directory names derived from changedFiles via packageOf. */
	packages: z.array(z.string()),
	/** True when any changed file sits outside packagesDir. */
	includeRoot: z.boolean(),
	gates: z.array(GateResult),
	/** runGates' aggregated failure text — present iff any group ended red. */
	gatesError: z.string().optional(),
	/** Scan results (findings AND advisories) touching a changed file; baseline honored. */
	findings: z.array(ScanFinding),
	/** NEW changed runtime source files with no co-located test sibling — each flips the verdict red (decision 23). */
	missingTests: z.array(z.string()),
	/** MODIFIED pre-existing runtime source files with no co-located test sibling — advisory, reported but never flips the verdict (decision 23). */
	untestedChanges: z.array(z.string()),
	notes: z.array(z.string()),
	verdict: z.enum(VerifyVerdict),
});

export type VerifyReport = z.infer<typeof VerifyReport>;
