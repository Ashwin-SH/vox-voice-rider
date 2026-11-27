import { getVoiceKeyStatus } from "@/lib/config";
import Dashboard from "./components/Dashboard";

// Read env at request time (reflects a key added at runtime); still cannot crash.
export const dynamic = "force-dynamic";

export default function Home() {
  const { hasKey, provider } = getVoiceKeyStatus();
  return <Dashboard hasKey={hasKey} voiceProvider={provider} />;
}
