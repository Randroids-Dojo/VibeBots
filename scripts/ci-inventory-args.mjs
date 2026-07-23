import path from "node:path";

export function outputPathFromArgs(args) {
  const index = args.indexOf("--output");
  if (index === -1) return null;
  if (!args[index + 1]) throw new Error("--output requires a file path");
  return path.resolve(args[index + 1]);
}
