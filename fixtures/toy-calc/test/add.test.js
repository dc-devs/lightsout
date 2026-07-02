import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.js';

test('add sums two numbers', () => {
	assert.equal(add({ number1: 2, number2: 3 }), 5);
});

test('add handles negatives', () => {
	assert.equal(add({ number1: -2, number2: 3 }), 1);
});
