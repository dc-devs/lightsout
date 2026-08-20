import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { createClaudeCodeDriver } from '#src/drivers/createClaudeCodeDriver.ts';
import { createCodexDriver } from '#src/drivers/createCodexDriver.ts';

interface Params {
	name: string;
}

/**
 * Driver registry. Resume paths reconstruct the driver from the manifest's
 * recorded name — an unknown name is a hard error, never a silent fallback.
 */
export const getDriver = ({ name }: Params): Driver => {
	if (name === 'claude-code') {
		return createClaudeCodeDriver();
	}

	if (name === 'codex') {
		return createCodexDriver();
	}

	throw new Error(`unknown driver: ${name} (available: claude-code, codex)`);
};
