import { z } from 'zod';

/**
 * The optional `docs` block of `lightsout.config.json` — the documentation
 * surfaces a repository declares, each a repo-relative path and a line saying
 * what that document is responsible for.
 *
 * Declaring the block turns three seams on at once: the plan writer is briefed
 * on the surfaces, every implementable plan file must carry a `## Documentation`
 * statement, and `plan grade` runs one whole-plan checker that verifies it. A
 * repository that declares none sees all three off at zero cost — no section, no
 * added prompt text, no checker spawn and no new question.
 *
 * The entry object is `.strict()` for the same reason `ConfigShip` is: the rest
 * of the config strips unknown keys, so a misspelled `cover` or `paths` must
 * fail loudly rather than silently declaring a surface with no description.
 *
 * `.min(1)` because an empty array would mean "declared, but nothing", which
 * reads as opting in to a check that can never fire. A repository with nothing
 * to declare omits the key.
 */
export const ConfigDocs = z
	.array(
		z
			.object({
				/** Repo-relative path of the document, e.g. `docs/configuration.md`. */
				path: z.string().min(1),
				/** One line saying what this document is responsible for. */
				covers: z.string().min(1),
			})
			.strict(),
	)
	.min(1);

export type ConfigDocs = z.infer<typeof ConfigDocs>;
