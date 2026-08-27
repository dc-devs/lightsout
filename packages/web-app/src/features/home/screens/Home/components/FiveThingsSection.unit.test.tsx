import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { FiveThingsSection } from '#src/features/home/screens/Home/components/FiveThingsSection.tsx';

describe('FiveThingsSection', () => {
	test('makes five claims, in the order a reader feels them', () => {
		render(<FiveThingsSection />);

		const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(titles).toStrictEqual([
			'The engine runs the gates, not the agent.',
			'Standards at every stage.',
			'Refactor is mandatory.',
			'Evidence on disk.',
			'Your harness, your bill.',
		]);
	});

	test('backs each claim with the sentence that makes it concrete', () => {
		render(<FiveThingsSection />);

		expect(screen.getByText('It spawns the Claude Code or Codex you already have. No new key, no proxy, no model in the middle.')).toBeInTheDocument();
	});
});
