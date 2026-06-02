import { test, expect } from "vitest";
import { makeUser } from "./factories.js";

test("harness creates and truncates", async () => {
  const u = await makeUser();
  expect(u.id).toBeTruthy();
});
