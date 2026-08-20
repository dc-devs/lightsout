import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '#src/common/components/ui/Dialog.tsx';

const setupDialog = ({ open = true }: { open?: boolean } = {}) => {
	const mockOnOpenChange = jest.fn<(open: boolean) => void>();

	render(
		<Dialog open={open} onOpenChange={mockOnOpenChange} title=".lightsout/plans/add-search.md" action={<button type="button">Copy raw</button>}>
			<p>the plan body</p>
		</Dialog>,
	);

	return { mockOnOpenChange };
};

describe('Dialog', () => {
	test('names itself with the title it was given, so assistive technology can announce it', () => {
		setupDialog();

		const drawer = screen.getByRole('dialog', { name: '.lightsout/plans/add-search.md' });

		expect(drawer).toBeInTheDocument();
	});

	test('renders its body', () => {
		setupDialog();

		const body = screen.getByText('the plan body');

		expect(body).toBeInTheDocument();
	});

	test('carries the action it was handed beside the close control', () => {
		setupDialog();

		const action = screen.getByRole('button', { name: 'Copy raw' });

		expect(action).toBeInTheDocument();
	});

	test('reports a close when the close control is pressed', () => {
		const { mockOnOpenChange } = setupDialog();

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(mockOnOpenChange).toHaveBeenCalledWith(false);
	});

	test('renders nothing at all while it is closed', () => {
		setupDialog({ open: false });

		const drawer = screen.queryByRole('dialog');

		expect(drawer).not.toBeInTheDocument();
	});
});
