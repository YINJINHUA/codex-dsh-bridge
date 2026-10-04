import { privateDir } from '../lib/config.mjs';
import { safeError } from '../lib/errors.mjs';
try {
  if (process.argv.length !== 3) throw Error('canonical_state_directory_required');
  privateDir(process.argv[2]);
  console.log(JSON.stringify({ ok: true, note: 'Private directory verified; existing ACLs unchanged.' }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeError(error) })); process.exitCode = 1;
}
