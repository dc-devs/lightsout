import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { BurnDownSection } from '#src/features/home/screens/Home/components/BurnDownSection.tsx';

describe('BurnDownSection', () => {
	test('names the two commands aimed at code a repo already has', () => {
		render(<BurnDownSection />);

		const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(names).toStrictEqual(['/refactor', '/test-coverage-to-threshold']);
	});

	test('sends a reader to the skill file rather than to a command page that does not exist yet', () => {
		render(<BurnDownSection />);

		const links = screen.getAllByRole('link', { name: 'What it does →' });

		expect(links.map((link) => link.getAttribute('href'))).toStrictEqual([
			'https://github.com/dc-devs/lightsout/blob/main/plugin/skills/refactor/SKILL.md',
			'https://github.com/dc-devs/lightsout/blob/main/plugin/skills/test-coverage-to-threshold/SKILL.md',
		]);
	});
});
