import { z } from 'zod';

/**
 * One per-test results file as the engine's jest reporter wrote it, parsed at
 * the boundary.
 *
 * `status` is a plain string rather than the `TestCaseStatus` union on purpose:
 * a status the engine has never heard of must read as "not passing", never as a
 * whole results file the reader silently drops — a dropped file is
 * indistinguishable from a test that never ran.
 *
 * A results entry naming no test file is refused rather than carried: there is
 * nothing an acceptance row could be matched against.
 */
export const TestResultsFile = z.object({
	testResults: z
		.array(
			z.object({
				/** Absolute path as the runner reported it. */
				testFilePath: z.string().min(1),
				assertionResults: z
					.array(
						z.object({
							title: z.string(),
							ancestorTitles: z.array(z.string()).default([]),
							fullName: z.string(),
							status: z.string().min(1),
							durationMs: z.number().optional(),
						}),
					)
					.default([]),
			}),
		)
		.default([]),
});

export type TestResultsFile = z.infer<typeof TestResultsFile>;
