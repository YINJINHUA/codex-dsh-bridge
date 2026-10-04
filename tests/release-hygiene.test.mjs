import test from 'node:test';
import assert from 'node:assert/strict';
import { privatePatterns } from '../scripts/release-rules.mjs';

test('release checks distinguish concrete Windows identity paths from placeholders', () => {
  const blocked = text => privatePatterns.some(rule => rule.test(text));
  const slash = String.fromCharCode(92);
  const home = ['C:', 'Users', 'synthetic-person', 'state'].join(slash);
  const unc = ['', '', 'private-host', 'private-share'].join(slash);
  const extended = ['', '', '?', 'UNC', 'private-host', 'private-share'].join(slash);
  for (const value of [home, JSON.stringify(home), unc, extended]) assert.equal(blocked(value), true);
  for (const value of ['%USERPROFILE%' + slash + '.codex-dsh-bridge', 'C:' + slash + 'path-to-trusted-tools',
    ['', '', '.', 'pipe', 'codex-dsh-example'].join(slash), ['', '', 'invalid-server', 'share'].join(slash)])
    assert.equal(blocked(value), false);
});
