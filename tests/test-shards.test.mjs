import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectTests, shards } from '../scripts/test-shards.mjs';

const files = fs.readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort();

test('three shards cover every discovered test file exactly once and preserve the full default run', () => {
  const selected = [1, 2, 3].flatMap(n => selectTests(files, [`--shard=${n}/3`]).files);
  assert.equal(new Set(selected).size, selected.length);
  assert.deepEqual(selected.sort(), files);
  assert.deepEqual(selectTests(files).files, files);
  assert.equal(selectTests(files, ['--list', '--shard=2/3']).list, true);
});

test('new, missing, duplicate or empty shard assignments fail instead of silently skipping tests', () => {
  const groups = shards.map(group => [...group]);
  groups[0].push(groups[1][0]);
  for (const [inventory, plan] of [[files.concat('new.test.mjs'), shards], [files.slice(1), shards],
    [files, groups], [files, [[], shards[1], shards[2]]]]) {
    assert.throws(() => selectTests(inventory, [], plan), /test_shard_coverage_mismatch/);
  }
});

test('invalid shard requests fail before running a partial or unintended full suite', () => {
  for (const args of [['--shard=0/3'], ['--shard=4/3'], ['--shard=1/2'], ['--shard=1/3', '--shard=2/3'],
    ['--shard=1/3junk'], ['--shard=01/3'], ['--list', '--list'], ['--unknown']]) {
    assert.throws(() => selectTests(files, args), /invalid_test_shard_arguments/);
  }
});
