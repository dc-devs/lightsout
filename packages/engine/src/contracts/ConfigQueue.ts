import { z } from 'zod';

const sharedQueueShape = {
	'route-labels': z.object({ direct: z.string(), 'auto-plan': z.string() }).strict(),
	'max-parallel': z.number().int().positive(),
	'api-key-env': z.string(),
	'eligible-statuses': z.array(z.string()).optional(),
	'in-progress-status': z.string().optional(),
	setup: z.string().optional(),
	'branch-template': z.string().optional(),
	'decisions-heading': z.string().optional(),
	'worker-timeout': z.string().optional(),
	'question-timeout': z.string().optional(),
	'parked-label': z.string().optional(),
};

const jiraSiteUrl = z
	.string()
	.url()
	.refine((value) => {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return false;
		}

		return url.protocol === 'https:' && url.hostname.endsWith('.atlassian.net') && url.pathname === '/' && url.search === '' && url.hash === '';
	}, 'Jira site-url must be an HTTPS *.atlassian.net origin');

/** The strict tracker-specific queue configuration stored in `lightsout.config.json`. */
export const ConfigQueue = z.discriminatedUnion('tracker', [
	z
		.object({
			...sharedQueueShape,
			tracker: z.literal('linear'),
			team: z.string().min(1, 'Linear queues need a team'),
		})
		.strict(),
	z
		.object({
			...sharedQueueShape,
			tracker: z.literal('jira'),
			'site-url': jiraSiteUrl,
			project: z.string().min(1, 'Jira queues need a project'),
			'api-user-email-env': z.string().min(1, 'Jira queues need an api-user-email-env'),
		})
		.strict(),
]);

export type ConfigQueue = z.infer<typeof ConfigQueue>;
