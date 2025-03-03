import { Hyperbrowser } from "./src";

const client = new Hyperbrowser({
  apiKey: "hb_609738f2d4058f47f12d3c054e7e",
});

async function main() {
  const resp = await client.beta.agents.browserUse.startAndWait({
    task: "Go to google.com, search for hyperbrowser.ai, and return the top 3 search results.",
    sessionOptions: {
      adblock: true,
      solveCaptchas: true,
      useProxy: true,
      useStealth: true,
      acceptCookies: true,
      enableWebRecording: true,
    },
  });
  console.log(JSON.stringify(resp, null, 2));
}

main();
