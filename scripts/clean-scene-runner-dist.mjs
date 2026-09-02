import { rm } from "node:fs/promises";

const distribution = new URL("../packages/ts/scene-runner/dist/", import.meta.url);
await rm(distribution, { recursive: true, force: true });
