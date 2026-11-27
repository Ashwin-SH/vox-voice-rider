import { test } from "node:test";
import assert from "node:assert/strict";
import { getVoiceConfig } from "../lib/config";

test("keyless when nothing is set", () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.SARVAM_API_KEY;
  const c = getVoiceConfig();
  assert.equal(c.hasGemini, false);
  assert.equal(c.hasSarvam, false);
  assert.match(c.provider, /keyless|Web Speech/i);
});

test("detects Sarvam key → Indian-language voice", () => {
  process.env.SARVAM_API_KEY = "test";
  const c = getVoiceConfig();
  assert.equal(c.hasSarvam, true);
  assert.match(c.provider, /Sarvam/i);
  delete process.env.SARVAM_API_KEY;
});

test("detects Gemini key → understanding", () => {
  process.env.GEMINI_API_KEY = "test";
  const c = getVoiceConfig();
  assert.equal(c.hasGemini, true);
  delete process.env.GEMINI_API_KEY;
});

test("whitespace-only key is treated as unset", () => {
  process.env.SARVAM_API_KEY = "   ";
  assert.equal(getVoiceConfig().hasSarvam, false);
  delete process.env.SARVAM_API_KEY;
});
