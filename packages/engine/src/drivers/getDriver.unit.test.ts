import { expect, test } from '@jest/globals';
import { getDriver } from '@/drivers';

test('getDriver: the claude-code name yields a driver that reports that harness', () => {
	const driver = getDriver({ name: 'claude-code' });

	expect(driver.name).toBe('claude-code');
	expect(typeof driver.invoke).toBe('function');
});

test('getDriver: the codex name yields a driver that reports that harness', () => {
	const driver = getDriver({ name: 'codex' });

	expect(driver.name).toBe('codex');
	expect(typeof driver.invoke).toBe('function');
});

test('getDriver: each name yields its own driver — no shared instance, no fallback between them', () => {
	const claude = getDriver({ name: 'claude-code' });
	const codex = getDriver({ name: 'codex' });

	expect(claude.name).not.toBe(codex.name);
});

test('getDriver: an unknown name is a hard error naming the drivers that do exist', () => {
	expect(() => getDriver({ name: 'cursor' })).toThrow(/unknown driver: cursor \(available: claude-code, codex\)/);
});

test('getDriver: an empty name is rejected too, never silently resolved to a default', () => {
	expect(() => getDriver({ name: '' })).toThrow(/unknown driver: {2}\(available: claude-code, codex\)/);
});
