import { serveFixtures, fixturesDir } from "../src/browser/runFixture.js";

const port = Number(process.env.PORT || 8765);
const { baseUrl } = await serveFixtures(fixturesDir(), port);
console.log(`Formbane fixtures: ${baseUrl}/simple.html`);
console.log(`Dir: ${fixturesDir()}`);
