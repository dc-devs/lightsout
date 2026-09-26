import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Appear } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/Appear.tsx';

describe('Appear', () => {
	test('renders its content visible, so nothing can leave it hidden', () => {
		render(<Appear>clean</Appear>);

		expect(screen.getByText('clean')).toHaveClass('opacity-100');
	});

	test('starts the fade from below and transparent, in CSS alone', () => {
		render(<Appear>clean</Appear>);

		expect(screen.getByText('clean')).toHaveClass('starting:opacity-0', 'starting:translate-y-2');
	});

	test('takes a class from the scene it sits in', () => {
		render(<Appear className="gap-4">clean</Appear>);

		expect(screen.getByText('clean')).toHaveClass('gap-4');
	});
});
