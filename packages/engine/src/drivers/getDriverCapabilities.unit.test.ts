import { describe, expect, test } from '@jest/globals';
import { getDriver } from '#src/drivers/getDriver.ts';
import { getDriverCapabilities } from '#src/drivers/getDriverCapabilities.ts';

describe('getDriverCapabilities', () => {
	test('getDriverCapabilities: claude-code declares every isolation control', () => {
		const capabilities = getDriverCapabilities({ name: 'claude-code' });

		expect(capabilities).toStrictEqual({
			name: 'claude-code',
			noMcpServers: true,
			noSkillCatalog: true,
			toolAllowlist: true,
			settingsPreserved: true,
		});
	});

	test('getDriverCapabilities: omp declares the skill and tool controls but not MCP exclusion', () => {
		const capabilities = getDriverCapabilities({ name: 'omp' });

		// omp publishes --no-skills and --tools and no MCP flag at all, so the
		// record must report the gap rather than round a partial surface up
		expect(capabilities).toStrictEqual({
			name: 'omp',
			noMcpServers: false,
			noSkillCatalog: true,
			toolAllowlist: true,
			settingsPreserved: true,
		});
	});

	// A control is declared only where the flag expressing it was checked against
	// an installed binary, so these two records pin an unverified surface as
	// absent rather than as optimistic support
	test.each([
		{
			name: 'codex',
			expected: {
				name: 'codex',
				noMcpServers: false,
				noSkillCatalog: false,
				toolAllowlist: false,
				settingsPreserved: false,
			},
		},
		{
			name: 'pi',
			expected: {
				name: 'pi',
				noMcpServers: false,
				noSkillCatalog: false,
				toolAllowlist: true,
				settingsPreserved: true,
			},
		},
	])('getDriverCapabilities: $name declares only the controls its flag surface was verified to have', ({ name, expected }) => {
		const capabilities = getDriverCapabilities({ name });

		expect(capabilities).toStrictEqual(expected);
	});

	test('getDriverCapabilities: every harness getDriver accepts has a capability record', () => {
		const harnesses = ['claude-code', 'codex', 'omp', 'pi'];

		const reported = harnesses.map((name) => ({
			driver: getDriver({ name }).name,
			capabilities: getDriverCapabilities({ name }).name,
		}));

		expect(reported).toStrictEqual([
			{ driver: 'claude-code', capabilities: 'claude-code' },
			{ driver: 'codex', capabilities: 'codex' },
			{ driver: 'omp', capabilities: 'omp' },
			{ driver: 'pi', capabilities: 'pi' },
		]);
	});

	test('getDriverCapabilities: an unknown name is a hard error naming the harnesses that do exist', () => {
		expect(() => getDriverCapabilities({ name: 'cursor' })).toThrow(/claude-code[\s\S]*codex[\s\S]*omp[\s\S]*pi/);
		expect(() => getDriverCapabilities({ name: '' })).toThrow(/claude-code[\s\S]*codex[\s\S]*omp[\s\S]*pi/);
	});
});
