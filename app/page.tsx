import { getVoiceConfig } from "@/lib/config";
import Dashboard from "./components/Dashboard";

// Read env at request time (reflects a key added at runtime); still cannot crash.
export const dynamic = "force-dynamic";

export default function Home() {
  const { hasGemini, hasSarvam, provider } = getVoiceConfig();
  return <Dashboard hasGemini={hasGemini} hasSarvam={hasSarvam} voiceProvider={provider} />;
}
