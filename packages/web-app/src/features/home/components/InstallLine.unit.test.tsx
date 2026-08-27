import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';

describe('InstallLine', () => {
	test('shows the one command the page asks a reader to run', () => {
		render(<InstallLine />);

		expect(screen.getByText('/plugin marketplace add dc-devs/lightsout')).toBeInTheDocument();
	});

	test('offers to put that command on the clipboard, which is the whole point of showing it', () => {
		render(<InstallLine />);

		expect(screen.getByRole('button', { name: 'Copy install command' })).toBeInTheDocument();
	});

	test('takes a class from whichever section it is standing in', () => {
		const { container } = render(<InstallLine className="w-full" />);

		expect(container.firstChild).toHaveClass('w-full');
	});
});
