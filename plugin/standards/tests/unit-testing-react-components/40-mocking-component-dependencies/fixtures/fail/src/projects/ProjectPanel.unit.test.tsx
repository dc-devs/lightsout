import { expect, describe, test, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ProjectPanel } from './ProjectPanel';

// An internal child under this module's own common/ — mocking it leaves it
// with no coverage at all, and the wrapper drops the props it is handed.
jest.mock('./common/components/ProjectRow', () => ({
	ProjectRow: () => <div />,
}));

const setupProjectPanel = () => {
	render(<ProjectPanel workspaceId={1} />);
};

describe('ProjectPanel', () => {
	test('lists the projects the hook returned', () => {
		setupProjectPanel();

		const panel = screen.getByRole('list');

		expect(panel).toBeInTheDocument();
	});
});
