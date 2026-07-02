import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divide } from '../src/index.js';

test('divide divides two positive numbers', () => {
	assert.equal(divide({ number1: 6, number2: 3 }), 2);
});

test('divide returns a fractional result', () => {
	assert.equal(divide({ number1: 1, number2: 4 }), 0.25);
});

test('divide handles negatives', () => {
	assert.equal(divide({ number1: -6, number2: 3 }), -2);
});

test('divide returns null when number2 is 0', () => {
	assert.equal(divide({ number1: 5, number2: 0 }), null);
});

test('divide returns 0 when number1 is 0', () => {
	assert.equal(divide({ number1: 0, number2: 5 }), 0);
});
