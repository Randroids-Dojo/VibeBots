import path from "node:path";

export function fileFromSourceLocation(location) {
  const separator = location.lastIndexOf(":");
  if (separator === -1 || !/^\d+$/.test(location.slice(separator + 1))) {
    throw new Error(`Invalid source location: ${location}`);
  }
  return location.slice(0, separator);
}

export function inventorySourcePath(file, testDir = "tests/e2e") {
  const normalizedFile = file.replaceAll("\\", "/");
  const normalizedTestDir = testDir.replaceAll("\\", "/").replace(/\/$/, "");
  if (
    path.isAbsolute(normalizedFile) ||
    /^[A-Za-z]:\//.test(normalizedFile) ||
    normalizedFile.startsWith(`${normalizedTestDir}/`)
  ) {
    return path.normalize(normalizedFile);
  }
  return path.join(testDir, normalizedFile);
}
