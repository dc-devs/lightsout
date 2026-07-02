import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiply } from '../src/index.js';

test('multiply multiplies two positive numbers', () => {
	assert.equal(multiply({ number1: 2, number2: 3 }), 6);
});

test('multiply handles zero', () => {
	assert.equal(multiply({ number1: 5, number2: 0 }), 0);
});
