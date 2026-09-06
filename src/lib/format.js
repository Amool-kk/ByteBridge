/** 5368709120 -> "5 GB" (for human-readable error messages). */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`;
}
