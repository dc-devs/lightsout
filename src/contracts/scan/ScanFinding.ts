import { z } from 'zod';
import { ScanDetector } from '@/contracts/scan/ScanDetector';
import { ScanSeverity } from '@/contracts/scan/ScanSeverity';

/**
 * One structural defect found by `lightsout scan`. Typed because this is
 * v2's remediation work-list: a refactor agent gets handed a cluster of
 * findings, never "go find problems".
 */
export const ScanFinding = z.object({
	detector: z.enum(ScanDetector),
	severity: z.enum(ScanSeverity),
	/** Grouping key — findings sharing a cluster are one remediation unit. */
	cluster: z.string(),
	files: z.array(
		z.object({
			path: z.string(),
			startLine: z.number().optional(),
			endLine: z.number().optional(),
		}),
	),
	/** What is true of this one site — the measurement, the names, the span. */
	detail: z.string(),
	/**
	 * What to do about findings of this kind, and any judgment the detector
	 * cannot make for itself. Constant across every finding a detector emits for
	 * the same reason, so a reader is told once rather than once per site.
	 */
	guidance: z.string().optional(),
});

export type ScanFinding = z.infer<typeof ScanFinding>;
