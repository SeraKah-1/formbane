import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function formbaneHome(): string {
  const override = process.env.FORMBANE_HOME;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".formbane");
}

export function ensureDirs(home = formbaneHome()): {
  home: string;
  profilePath: string;
  browserProfile: string;
  sessions: string;
  submissions: string;
  configPath: string;
} {
  const dirs = {
    home,
    profilePath: path.join(home, "profile.json"),
    browserProfile: path.join(home, "browser-profile"),
    sessions: path.join(home, "sessions"),
    submissions: path.join(home, "submissions"),
    configPath: path.join(home, "config.json"),
  };
  for (const d of [home, dirs.browserProfile, dirs.sessions, dirs.submissions]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return dirs;
}
