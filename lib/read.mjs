import fs from 'node:fs';

// Regular-file callers validate type/ownership first. A short read is not EOF.
export function readBounded(fd, limit, errorCode) {
  const bytes = Buffer.alloc(limit + 1);
  let count = 0;
  while (count < bytes.length) {
    const got = fs.readSync(fd, bytes, count, bytes.length - count, null);
    if (got === 0) break;
    count += got;
  }
  if (count > limit) throw Error(errorCode);
  return bytes.subarray(0, count);
}
