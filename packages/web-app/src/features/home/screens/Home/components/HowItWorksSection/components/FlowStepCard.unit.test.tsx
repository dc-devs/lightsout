import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { FlowActor } from '#src/features/home/screens/Home/components/HowItWorksSection/common/constants/FlowActor.ts';
import { FlowStepCard } from '#src/features/home/screens/Home/components/HowItWorksSection/components/FlowStepCard.tsx';

describe('FlowStepCard', () => {
	test('names the command, who runs it, and what it does', () => {
		render(<FlowStepCard command="/plan" actor={FlowActor.You} body="Settle every decision." />);

		expect([screen.getByRole('heading', { level: 3, name: '/plan' }), screen.getByText('You'), screen.getByText('Settle every decision.')]).toHaveLength(3);
	});

	test('carries whatever the step adds below its line', () => {
		render(
			<FlowStepCard command="/implement" actor={FlowActor.Agent} body="Builds the plan.">
				<p>three stages</p>
			</FlowStepCard>,
		);

		expect(screen.getByText('three stages')).toBeInTheDocument();
	});

	test('tags a step a run can leave out as optional', () => {
		render(<FlowStepCard command="ship" actor={FlowActor.Agent} body="Merges it." isOptional />);

		expect(screen.getByText('Optional')).toBeInTheDocument();
	});

	test('carries no tag on a step every run takes', () => {
		render(<FlowStepCard command="/implement" actor={FlowActor.Agent} body="Builds the plan." />);

		expect(screen.queryByText('Optional')).not.toBeInTheDocument();
	});
});
