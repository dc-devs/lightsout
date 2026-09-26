import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { FlowActor } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/common/constants/FlowActor.ts';
import { ActorBadge } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/components/ActorBadge.tsx';

describe('ActorBadge', () => {
	test.each([
		{ actor: FlowActor.You, label: 'You', tone: 'text-primary-hover' },
		{ actor: FlowActor.Agent, label: 'Agent', tone: 'text-agent-foreground' },
	])('says $label did the step, in its own colour', ({ actor, label, tone }) => {
		render(<ActorBadge actor={actor} />);

		expect(screen.getByText(label)).toHaveClass(tone);
	});

	test('keeps its icon out of what a screen reader hears, since the word says it', () => {
		const { container } = render(<ActorBadge actor={FlowActor.You} />);

		expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
	});
});
