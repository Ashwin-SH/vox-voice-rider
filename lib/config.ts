// Central place to read runtime config. The app must boot even when nothing is set.
export interface VoiceConfig {
  hasGemini: boolean; // Gemini for natural-language understanding
  hasSarvam: boolean; // Sarvam for Indian-language speech (STT + TTS)
  provider: string;
}

export function getVoiceConfig(): VoiceConfig {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasSarvam = Boolean(process.env.SARVAM_API_KEY?.trim());
  const provider = hasSarvam
    ? hasGemini
      ? "Sarvam voice + Gemini understanding"
      : "Sarvam · Indian-language voice + understanding"
    : hasGemini
      ? "Web Speech + Gemini understanding"
      : "Browser Web Speech (keyless)";
  return { hasGemini, hasSarvam, provider };
}
