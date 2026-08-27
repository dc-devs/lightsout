import { getCommandCatalogEntry } from '#src/commands/getCommandCatalogEntry.ts';
import { CommandActor, type CommandStep } from '#src/contracts/index.ts';

/** The brand gradient every infographic interpolates its card colours between. */
const theme = { from: '#35d6e8', to: '#b06bf5' };

/** One step as a card. `tone` names a gradient endpoint: the engine's own steps take the far end, everything a person or an agent does takes the near one. */
const renderCard = ({ step }: { step: CommandStep }) => ({
	title: step.title,
	tag: { label: step.actor, tone: step.actor === CommandActor.Engine ? 'to' : 'from' },
	bullets: step.bullets,
	...(step.note === undefined ? {} : { note: step.note }),
	...(step.savedLabel === undefined ? {} : { savedLabel: step.savedLabel }),
	saved: step.saved,
});

interface Params {
	/** The catalog id of a command that has a graphic — `plan`, `implement` or `refactor`. */
	id: string;
}

/**
 * The `flow-graphic` spec JSON for a command's infographic, from its catalog
 * entry.
 *
 * The shape is the one `.claude/skills/flow-graphic/reference/spec.md`
 * documents, which is what `build_graphic.py` reads. Rendering it here rather
 * than committing three hand-written specs is what stops a step's wording
 * drifting between the README's graphic and the command's own page.
 *
 * @throws {Error} When no command answers to the id, or the command has no graphic — asking for a spec that does not exist is a bug, not an empty file.
 */
export const renderWorkflowSpec = ({ id }: Params): unknown => {
	const entry = getCommandCatalogEntry({ id });

	if (entry?.graphic === undefined) {
		throw new Error(`no workflow graphic for '${id}' — the catalog gives one to plan, implement and refactor only`);
	}

	return {
		title: entry.graphic.title,
		subtitle: entry.graphic.subtitle,
		columns: entry.graphic.columns,
		savedLabel: 'SAVED TO DISK',
		theme,
		banner: entry.graphic.banner,
		cards: entry.steps.map((step) => renderCard({ step })),
	};
};
