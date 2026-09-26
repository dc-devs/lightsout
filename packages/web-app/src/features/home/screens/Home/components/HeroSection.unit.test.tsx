import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { heroDescription } from '#src/features/home/common/constants/heroDescription.ts';
import { HeroSection } from '#src/features/home/screens/Home/components/HeroSection.tsx';

describe('HeroSection', () => {
	test('leads with the promise in three words', () => {
		render(<HeroSection />);

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop the slop.');
	});

	test('says plainly what it is, in the sentence a shared link quotes', () => {
		render(<HeroSection />);

		expect(screen.getByText(heroDescription)).toBeInTheDocument();
	});

	test('says who it is for before the headline', () => {
		render(<HeroSection />);

		expect(screen.getByText('lightsout · Quality control for AI coding agents')).toBeInTheDocument();
	});

	test('offers one action, installing the plugin, and no link away from it', () => {
		render(<HeroSection />);

		expect({ buttons: screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')), links: screen.queryAllByRole('link') }).toStrictEqual({
			buttons: ['Copy install command'],
			links: [],
		});
	});

	test('says what stage it is at and what it runs with, under the action', () => {
		render(<HeroSection />);

		expect(screen.getByText('Alpha · MIT · Works with Claude Code, Codex, and Pi')).toBeInTheDocument();
	});
});
