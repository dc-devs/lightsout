import { describe, expect, test } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import { HowItWorksSection } from '#src/features/home/screens/Home/components/HowItWorksSection/HowItWorksSection.tsx';

/** The zone a reader sees a step in, by the zone's label. */
const readZoneSteps = ({ label }: { label: string }) =>
	within(screen.getByText(label).parentElement ?? document.body)
		.getAllByRole('heading', { level: 3 })
		.map((heading) => heading.textContent);

describe('HowItWorksSection', () => {
	test('states who does what, in two lines', () => {
		render(<HowItWorksSection />);

		expect(screen.getByRole('heading', { level: 2, name: 'Humans decide. Agents execute.' })).toBeInTheDocument();
	});

	test('puts the steps a person decides on one side of the handoff', () => {
		render(<HowItWorksSection />);

		expect(readZoneSteps({ label: 'You decide' })).toStrictEqual(['/brainstorm', '/plan']);
	});

	test('puts the steps an agent executes on the other', () => {
		render(<HowItWorksSection />);

		expect(readZoneSteps({ label: 'Agents execute' })).toStrictEqual(['/implement', 'ship']);
	});

	test('marks ship, and only ship, as optional, since a run ships only when asked to', () => {
		render(<HowItWorksSection />);

		const optional = screen
			.getAllByText('Optional')
			.map((tag) => within(tag.closest('article') ?? document.body).getByRole('heading', { level: 3 }).textContent);

		expect(optional).toStrictEqual(['ship']);
	});

	test('names what ship does, through to the cleanup after the merge', () => {
		render(<HowItWorksSection />);

		const stages = within(screen.getByRole('heading', { level: 3, name: 'ship' }).closest('article') ?? document.body)
			.getAllByRole('listitem')
			.map((item) => item.textContent);

		expect(stages).toStrictEqual([
			'Pushes the branch and opens the pull request',
			'Waits for your CI, then merges',
			'Moves the ticket to Done',
			'Removes the worktree and deletes the branch',
		]);
	});

	test('marks the handoff between the two', () => {
		render(<HowItWorksSection />);

		expect(screen.getByText('Hand off')).toBeInTheDocument();
	});

	test('offers auto-plan as the way to let an agent run the plan step, still checking with you on the big calls', () => {
		render(<HowItWorksSection />);

		expect(screen.getByText('/auto-plan').parentElement).toHaveTextContent(
			'answering the questions with its own recommendations and checking with you only on the big calls',
		);
	});

	test('names the stages implement runs, in order', () => {
		render(<HowItWorksSection />);

		const stages = within(screen.getByRole('heading', { level: 3, name: '/implement' }).closest('article') ?? document.body)
			.getAllByRole('listitem')
			.map((item) => item.textContent);

		expect(stages).toStrictEqual(['Writes locked acceptance tests', 'Implements the code', 'Writes tests', 'Refactors']);
	});

	test('shows what brainstorm works through, above the level of code', () => {
		render(<HowItWorksSection />);

		const covers = within(screen.getByRole('heading', { level: 3, name: '/brainstorm' }).closest('article') ?? document.body)
			.getAllByRole('listitem')
			.map((item) => item.textContent);

		expect(covers).toStrictEqual(['Product design', 'Architecture', 'Edge cases']);
	});

	test('shows what plan produces and proves, the technical detail first', () => {
		render(<HowItWorksSection />);

		const covers = within(screen.getByRole('heading', { level: 3, name: '/plan' }).closest('article') ?? document.body)
			.getAllByRole('listitem')
			.map((item) => item.textContent);

		expect(covers).toStrictEqual([
			'Technical implementation, step by step',
			'Grilled on every edge case, one question at a time',
			'Facts checked against your code',
			'Duplicates caught before coding',
		]);
	});
});
