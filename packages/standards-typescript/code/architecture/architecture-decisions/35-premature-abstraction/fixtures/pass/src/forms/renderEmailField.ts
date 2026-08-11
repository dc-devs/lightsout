interface Params {
	label: string;
	value: string;
}

// The one case that actually exists, written plainly. When a second and a third
// arrive, what they share will be visible instead of guessed.
export const renderEmailField = ({ label, value }: Params): string => `<label data-kind="email">${label}: ${value}</label>`;
