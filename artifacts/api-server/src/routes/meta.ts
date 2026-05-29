import { Router, type IRouter } from "express";

export const TESTED_VERSIONS = [
  "1.16.5",
  "1.18.2",
  "1.19.4",
  "1.20.1",
  "1.20.4",
] as const;

export const LATEST_TESTED = "1.20.4";

const router: IRouter = Router();

router.get("/meta", (_req, res) => {
  res.json({
    testedVersions: TESTED_VERSIONS,
    latestTested: LATEST_TESTED,
    providers: ["ollama", "openai", "anthropic"],
    cognitiveModes: [
      "deterministic",
      "lightweight",
      "balanced",
      "auto",
      "deep-reasoning",
    ],
    playstyles: ["companion", "worker", "adventurer", "safe", "auto"],
    note: "version field is optional. Leave blank to let mineflayer auto-detect.",
  });
});

export default router;
