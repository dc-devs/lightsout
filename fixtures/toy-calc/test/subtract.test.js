import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtract } from '../src/index.js';

test('subtract subtracts two numbers', () => {
	assert.equal(subtract({ number1: 5, number2: 3 }), 2);
});

test('subtract handles negatives', () => {
	assert.equal(subtract({ number1: -2, number2: 3 }), -5);
});

test('subtract returns negative when number2 is larger', () => {
	assert.equal(subtract({ number1: 3, number2: 5 }), -2);
});
