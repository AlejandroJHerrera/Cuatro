import { test, expect } from "vitest";
import { renderQrPng } from "./qrRender.js";

test("renders a PNG buffer with a PNG magic prefix", async () => {
  const buf = await renderQrPng("cuatro:1:ABC123:A7:sig");
  expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(buf.length).toBeGreaterThan(200);
});
