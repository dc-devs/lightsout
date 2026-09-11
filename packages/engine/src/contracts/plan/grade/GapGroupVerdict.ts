import { z } from 'zod';
import { GapVerdict } from '#src/contracts/plan/grade/GapVerdict.ts';

/**
 * One ruling inside a batch judge's answer: who settles the observations it
 * names, the evidence that outcome demands, and — when it names two or more —
 * the one defect it claims they all are.
 *
 * The ruling half is spread in from `GapVerdict` rather than retyped, so a batch
 * ruling and a single re-verification ruling stay related by construction.
 * `answerAt` is replaced by `answers` rather than kept beside it: a single
 * citation and a per-file citation list are two spellings of one claim, and a
 * ruling over one observation in one plan file is simply the one-entry case.
 *
 * `covers` and `answers` default to empty rather than being required, so a
 * malformed payload reaches the engine's accounting and is refused there with a
 * reason a human reads, rather than being retried as a parse failure that
 * explains nothing. Which evidence each outcome demands, and that `covers` names
 * only identifiers the engine handed out, is enforced in `accountBatchVerdicts`.
 */
export const GapGroupVerdict = GapVerdict.omit({ answerAt: true }).extend({
	/** The engine-assigned identifiers (`o1`, `o2`, …) of every observation this ruling settles. Two or more is a claim that they are one defect. */
	covers: z.array(z.string()).default([]),
	/** Two or more covered: the one violated requirement or contradiction every covered observation is. */
	sharedDefect: z.string().optional(),
	/** `already-answered`: one citation per plan file the covered observations span, each quoted from that file's own text or naming a path on disk. */
	answers: z.array(z.object({ phase: z.string(), answerAt: z.string() })).default([]),
});

export type GapGroupVerdict = z.infer<typeof GapGroupVerdict>;
