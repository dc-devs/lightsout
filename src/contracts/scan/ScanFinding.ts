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
	detail: z.string(),
});

export type ScanFinding = z.infer<typeof ScanFinding>;
