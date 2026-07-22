import { chromium, type BrowserContext, type Page } from "playwright";
import { ensureDirs } from "../storage/paths.js";

export interface LaunchOptions {
  headless?: boolean;
  profileDir?: string;
}

export async function launchBrowser(
  opts: LaunchOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const { browserProfile } = ensureDirs();
  const profileDir = opts.profileDir ?? browserProfile;
  const headless = opts.headless ?? process.env.FORMBANE_HEADLESS === "1";

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: headless ? { width: 1280, height: 800 } : null,
    args: headless ? [] : ["--start-maximized"],
    acceptDownloads: true,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}
