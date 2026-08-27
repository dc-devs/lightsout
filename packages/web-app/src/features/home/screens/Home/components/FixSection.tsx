import implementWorkflowDark from '#assets/implement-workflow.svg?url';
import implementWorkflowLight from '#assets/implement-workflow-light.svg?url';
import planWorkflowDark from '#assets/plan-workflow.svg?url';
import planWorkflowLight from '#assets/plan-workflow-light.svg?url';
import refactorWorkflowDark from '#assets/refactor-workflow.svg?url';
import refactorWorkflowLight from '#assets/refactor-workflow-light.svg?url';
import { Tabs } from '#src/appUI/index.ts';

/**
 * One shipped workflow graphic, in whichever theme the page is wearing.
 *
 * Two images with the `.dark` class deciding between them, rather than one
 * `<picture>` on `prefers-color-scheme`: this app's theme is an explicit stored
 * choice of three, so a media query would put a light diagram on a dark page for
 * every reader who overrode their system. The cost is that both files are
 * fetched; deciding in JavaScript instead would risk a flash on hydration.
 */
const WorkflowGraphic = ({ dark, light, alt }: { dark: string; light: string; alt: string }) => (
	<>
		<img src={light} alt={alt} className="w-full rounded-lg border border-border dark:hidden" />
		<img src={dark} alt={alt} className="hidden w-full rounded-lg border border-border dark:block" />
	</>
);

const workflows = [
	{ value: 'plan', label: 'brainstorm · plan', dark: planWorkflowDark, light: planWorkflowLight, alt: 'The brainstorm and plan commands, step by step' },
	{ value: 'implement', label: 'implement', dark: implementWorkflowDark, light: implementWorkflowLight, alt: 'The implement pipeline, step by step' },
	{ value: 'refactor', label: 'refactor', dark: refactorWorkflowDark, light: refactorWorkflowLight, alt: 'The refactor pipeline, step by step' },
];

/** What lightsout actually does about the slop, in one breath and three diagrams. */
export const FixSection = () => (
	<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
		<h2 className="max-w-3xl font-semibold text-2xl lg:text-3xl">Humans decide. Agents execute. Your commands decide when it’s done.</h2>
		<p className="max-w-3xl text-muted-foreground-strong">
			Settle every decision in a plan. Hand it to the factory. Walk away. The engine runs your lint, types, tests, coverage and build between every stage, and
			the run ends with a refactor pass — verified the same way.
		</p>
		<Tabs
			items={workflows.map((workflow) => ({
				value: workflow.value,
				label: workflow.label,
				content: <WorkflowGraphic dark={workflow.dark} light={workflow.light} alt={workflow.alt} />,
			}))}
		/>
	</section>
);
