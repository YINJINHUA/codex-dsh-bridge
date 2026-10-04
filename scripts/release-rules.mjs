// Generic placeholders remain valid documentation; concrete personal paths do not.
export const privatePatterns = [
  /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//,
  /\/Volumes\/[^\s"'`]+/,
  /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'`<>%]+[\\/]+/i,
  /(?<![\\.?a-zA-Z0-9])\\{2,}(?![.?]\\)(?!invalid-server\\)[a-zA-Z0-9][a-zA-Z0-9.-]*\\/,
  /\\{2,}\?\\+UNC\\+(?!invalid-server\\)[a-zA-Z0-9][a-zA-Z0-9.-]*\\/i,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/,
  /(?:api[_-]?key|password|secret)\s*[:=]\s*["'][a-zA-Z0-9+/_=-]{16,}["']/i
];
