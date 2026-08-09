import { expect, describe, test, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ProjectPanel } from './ProjectPanel';

// Mocked Imports
// -------------------------
const mockUseProjects = jest.fn<(params: { workspaceId: number }) => { data: Array<{ name: string }> }>();

jest.mock('@/features/projects/hooks/useProjects', () => ({
	useProjects: (params: { workspaceId: number }) => mockUseProjects(params),
}));
// -------------------------

const setupProjectPanel = ({ names = ['Apollo'] }: { names?: string[] } = {}) => {
	mockUseProjects.mockReturnValue({ data: names.map((name) => ({ name })) });
	render(<ProjectPanel workspaceId={1} />);
};

describe('ProjectPanel', () => {
	test('lists the projects the hook returned', () => {
		setupProjectPanel({ names: ['Apollo'] });

		const project = screen.getByText('Apollo');

		expect(project).toBeInTheDocument();
	});
});
