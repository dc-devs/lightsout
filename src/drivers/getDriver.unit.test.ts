import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDriver } from '@/drivers';

test('getDriver: the claude-code name yields a driver that reports that harness', () => {
	const driver = getDriver({ name: 'claude-code' });

	assert.equal(driver.name, 'claude-code');
	assert.equal(typeof driver.invoke, 'function');
});

test('getDriver: the codex name yields a driver that reports that harness', () => {
	const driver = getDriver({ name: 'codex' });

	assert.equal(driver.name, 'codex');
	assert.equal(typeof driver.invoke, 'function');
});

test('getDriver: each name yields its own driver — no shared instance, no fallback between them', () => {
	const claude = getDriver({ name: 'claude-code' });
	const codex = getDriver({ name: 'codex' });

	assert.notEqual(claude.name, codex.name);
});

test('getDriver: an unknown name is a hard error naming the drivers that do exist', () => {
	assert.throws(() => getDriver({ name: 'cursor' }), /unknown driver: cursor \(available: claude-code, codex\)/);
});

test('getDriver: an empty name is rejected too, never silently resolved to a default', () => {
	assert.throws(() => getDriver({ name: '' }), /unknown driver:  \(available: claude-code, codex\)/);
});
