// Central place to read runtime config. The app must boot even when nothing is set.
export function getVoiceKeyStatus(): { hasKey: boolean; provider: string } {
  const key = process.env.GEMINI_API_KEY?.trim();
  return { hasKey: Boolean(key), provider: key ? "Web Speech + Gemini understanding" : "Browser Web Speech (keyless)" };
}
