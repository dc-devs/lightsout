import { z } from 'zod';

/** A durable, self-contained question rather than an unexplained option label. */
export const PlanningQuestion = z
	.object({
		context: z.string().min(1),
		question: z.string().min(1),
		options: z.array(z.object({ label: z.string().min(1), description: z.string().min(1) }).strict()),
		recommendation: z.string().min(1),
		answerId: z.string().min(1).optional(),
	})
	.strict();
export type PlanningQuestion = z.infer<typeof PlanningQuestion>;
