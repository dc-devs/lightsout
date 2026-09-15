import { z } from 'zod';

/** Canonical repository-relative path; filesystem access also checks realpath containment. */
export const PlanningPath = z
	.string()
	.min(1)
	.refine(
		(path) =>
			path === '.' ||
			(!path.startsWith('/') &&
				!path.includes(':') &&
				!path.includes('\\') &&
				!path.includes('\0') &&
				path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')),
		'Expected a normalized repository-relative path',
	);
export type PlanningPath = z.infer<typeof PlanningPath>;
