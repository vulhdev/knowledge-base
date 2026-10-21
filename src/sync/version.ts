import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const HOST_VERSION: string = pkg.version;

export function parseMajorMinor(version: string): string {
  const [major = "0", minor = "0"] = version.split(".");
  return `${major}.${minor}`;
}
