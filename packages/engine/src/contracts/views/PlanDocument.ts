import { z } from 'zod';
import { CoverageWorklist } from '#src/contracts/coverage/index.ts';
import { RefactorWorklist } from '#src/contracts/refactor/index.ts';
import { PlanDocumentKind } from '#src/contracts/views/PlanDocumentKind.ts';

/** A plan as a reader shows it: markdown prose, a parsed frozen work-list, or a recorded absence. */
export const PlanDocument = z.object({
	/** Repo-relative path as asked for. */
	path: z.string(),
	kind: z.enum(PlanDocumentKind),
	/** Present iff kind is 'markdown'. */
	text: z.string().optional(),
	/** Present iff kind is 'worklist' — a refactor run's frozen work-list. */
	worklist: RefactorWorklist.optional(),
	/** Present iff kind is 'coverageWorklist' — a coverage run's frozen initial measurement. */
	coverageWorklist: CoverageWorklist.optional(),
});

export type PlanDocument = z.infer<typeof PlanDocument>;
