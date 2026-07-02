import { createClaudeCodeDriver } from './createClaudeCodeDriver';

interface Params {
	name: string;
}

/**
 * Driver registry. Resume paths reconstruct the driver from the manifest's
 * recorded name — an unknown name is a hard error, never a silent fallback.
 */
export const getDriver = ({ name }: Params) => {
	if (name === 'claude-code') {
		return createClaudeCodeDriver();
	}

	throw new Error(`unknown driver: ${name} (available: claude-code)`);
};
