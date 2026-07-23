export function fileFromSourceLocation(location) {
  const separator = location.lastIndexOf(":");
  if (separator === -1 || !/^\d+$/.test(location.slice(separator + 1))) {
    throw new Error(`Invalid source location: ${location}`);
  }
  return location.slice(0, separator);
}
