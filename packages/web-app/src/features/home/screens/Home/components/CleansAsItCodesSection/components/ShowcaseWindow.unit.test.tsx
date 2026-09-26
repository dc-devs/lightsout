import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ShowcaseWindow } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/ShowcaseWindow.tsx';

describe('ShowcaseWindow', () => {
	test('names what it is showing in its title bar', () => {
		render(<ShowcaseWindow title="plan.md">scene</ShowcaseWindow>);

		expect(screen.getByText('plan.md')).toBeInTheDocument();
	});

	test('plays the scene it was given', () => {
		render(<ShowcaseWindow title="plan.md">scene</ShowcaseWindow>);

		expect(screen.getByText('scene')).toBeInTheDocument();
	});
});
