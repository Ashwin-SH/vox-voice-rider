import { test } from "node:test";
import assert from "node:assert/strict";
import { getVoiceKeyStatus } from "../lib/config";

// Guards the keyless contract: the app must report keyless mode unless a real
// GEMINI key is present, and it must never treat a blank/whitespace key as set.
test("keyless when GEMINI_API_KEY is unset", () => {
  delete process.env.GEMINI_API_KEY;
  const s = getVoiceKeyStatus();
  assert.equal(s.hasKey, false);
  assert.match(s.provider, /keyless/i);
});

test("premium voice when GEMINI_API_KEY is set", () => {
  process.env.GEMINI_API_KEY = "test-key";
  const s = getVoiceKeyStatus();
  assert.equal(s.hasKey, true);
  assert.match(s.provider, /Gemini/i);
  delete process.env.GEMINI_API_KEY;
});

test("whitespace-only key is treated as unset", () => {
  process.env.GEMINI_API_KEY = "   ";
  assert.equal(getVoiceKeyStatus().hasKey, false);
  delete process.env.GEMINI_API_KEY;
});
