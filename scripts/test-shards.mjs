// Balanced using Windows measurements; each file must occur exactly once.
export const shards = [
  [
    "core.test.mjs",
    "transport.test.mjs",
    "windows-platform.test.mjs",
    "dsh-policy-worker.test.mjs",
    "dsh-policy-cli.test.mjs",
    "test-shards.test.mjs",
    "default-home.test.mjs",
    "secure-channel.test.mjs",
    "release-hygiene.test.mjs",
    "release-publish.test.mjs",
    "process.test.mjs",
    "socket-mode.test.mjs"
  ],
  [
    "hardening.test.mjs",
    "codex-host.test.mjs",
    "codex.test.mjs",
    "dsh-policy.test.mjs",
    "worker.test.mjs"
  ],
  [
    "create.test.mjs",
    "codex-policy.test.mjs",
    "dsh-policy-host.test.mjs",
    "review-fixes.test.mjs",
    "release-037.test.mjs"
  ]
];

export function selectTests(discovered, args = [], groups = shards) {
  const assigned = groups.flat();
  if (groups.length !== 3 || groups.some(group => !group.length) ||
      new Set(assigned).size !== assigned.length ||
      [...assigned].sort().join('\n') !== [...discovered].sort().join('\n')) {
    throw Error('test_shard_coverage_mismatch');
  }
  const options = args.filter(arg => arg !== '--list');
  if (args.length - options.length > 1 || options.length > 1 ||
      (options.length && !/^--shard=[123]\/3$/.test(options[0]))) throw Error('invalid_test_shard_arguments');
  const shard = options.length ? Number(options[0][8]) : null;
  return { shard, list: args.includes('--list'), files: shard ? [...groups[shard - 1]] : [...discovered].sort() };
}
