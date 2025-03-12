import { Hyperbrowser } from "./src";

const hb = new Hyperbrowser({
  apiKey: "hb_68cf7b15f0b0e41e33bf12c1cfa8",
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(jobId: string) {
  while (true) {
    const status = await hb.agents.browserUse.getStatus(jobId);
    if (status.status !== "pending" && status.status !== "running") {
      return await hb.agents.browserUse.get(jobId);
    }
    await sleep(5000);
  }
}

async function main() {
  const res = await hb.agents.browserUse.start({
    task: "go to hacker news and summarize the discussion on the top 10 posts",
    llm: "gemini-2.0-flash",
    sessionOptions: {
      useStealth: true,
      useProxy: true,
      adblock: true,
      acceptCookies: true,
      annoyances: true,
    },
  });
  console.log(res.liveUrl);

  const result = await pollJob(res.jobId);
  console.log(result.data?.finalResult);
}

main();
