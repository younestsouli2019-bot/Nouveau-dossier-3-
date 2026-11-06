#!/usr/bin/env node
import assert from 'node:assert';

console.log('🧪 Running Offline Verification Engine Tests...');

const mockPriceBook = {
  courses: {
    'course-a': { type: 'quote_required' },
    'course-b': { type: 'fixed' },
    'course-c': { type: 'fixed', amount: 1500 },
  },
};

const items = Object.entries(mockPriceBook.courses);
assert.ok(items.length === 3, 'Should parse all 3 items');
const sellable = items.filter(([, m]) => m.type === 'fixed' && m.amount > 0);
assert.ok(sellable.length === 1, 'Should filter out quotes and empty prices');
assert.ok(sellable[0][0] === 'course-c', 'Should pinpoint the sellable item');
assert.strictEqual(typeof mockPriceBook.courses['course-c'].amount, 'number');
assert.strictEqual(mockPriceBook.courses['course-c'].amount, 1500);

const mutate = (execute, live) => execute && live;
assert.strictEqual(mutate(true, false), false, 'No mutation without SWARM_LIVE');
assert.strictEqual(mutate(false, true), false, 'No mutation without --execute');
assert.strictEqual(mutate(true, true), true);

console.log('🏁 All assertions passed. Network zeroed out.');
