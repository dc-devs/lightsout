import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SceneStatus } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/SceneStatus.ts';
import { StatusChip } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/StatusChip.tsx';

describe('StatusChip', () => {
	test('says where the scene has got to', () => {
		render(<StatusChip status={SceneStatus.Working}>19 / 20 files</StatusChip>);

		expect(screen.getByText('19 / 20 files')).toHaveAttribute('data-status', SceneStatus.Working);
	});

	test.each([
		{ status: SceneStatus.Over, expected: 'text-status-failed-foreground' },
		{ status: SceneStatus.Fixing, expected: 'text-primary-hover' },
		{ status: SceneStatus.Clean, expected: 'text-status-passed-foreground' },
	])('wears the colour of the $status state', ({ status, expected }) => {
		render(<StatusChip status={status}>label</StatusChip>);

		expect(screen.getByText('label')).toHaveClass(expected);
	});
});
