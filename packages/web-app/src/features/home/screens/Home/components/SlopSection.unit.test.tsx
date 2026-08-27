import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SlopSection } from '#src/features/home/screens/Home/components/SlopSection.tsx';

describe('SlopSection', () => {
	test('names all three symptoms, since one of them is the reader’s own', () => {
		render(<SlopSection />);

		const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(titles).toStrictEqual(['Missed the helper. Wrote another.', 'A second pattern beside the first.', 'Copied the shortcut it found.']);
	});

	test('shows what was already there beside what the agent wrote next to it', () => {
		render(<SlopSection />);

		expect(screen.getByText('export const formatDuration = ({ ms }: Params): string => …')).toBeInTheDocument();
		expect(screen.getByText(`const msToLabel = (ms: number) => \`\${Math.round(ms / 1000)}s\`;`)).toBeInTheDocument();
	});

	test('closes on why it gets worse rather than on the last symptom', () => {
		render(<SlopSection />);

		expect(screen.getByText('And it compounds. The mess becomes the context the next agent reads.')).toBeInTheDocument();
	});
});
