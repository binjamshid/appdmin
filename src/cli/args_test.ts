import assert from "node:assert/strict";
import { parseArgs } from "./args.ts";

Deno.test("CLI parser keeps command path separate from flags", () => {
  assert.deepEqual(
    parseArgs(["adapter", "add", "openai", "--accept-permissions", "--source=local"]),
    {
      command: ["adapter", "add", "openai"],
      options: { "accept-permissions": true, source: "local" },
    },
  );
});
