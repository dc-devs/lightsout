import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';

const setupInstallLine = ({ className }: { className?: string } = {}) => {
	const { container } = render(<InstallLine className={className} />);

	return { line: container.firstElementChild, command: container.querySelector('code') };
};

describe('InstallLine', () => {
	test('shows the one command the page asks a reader to run', () => {
		const { command } = setupInstallLine();

		expect(command).toHaveTextContent('/plugin marketplace add lightsout-factory/lightsout');
	});

	test('offers that command to the clipboard as an icon', () => {
		setupInstallLine();

		expect(screen.getByRole('button', { name: 'Copy install command' })).toHaveTextContent('');
	});

	test('takes a class from whichever section it is standing in', () => {
		const { line } = setupInstallLine({ className: 'w-full' });

		expect(line).toHaveClass('w-full');
	});
});
