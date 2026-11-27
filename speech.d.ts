// Minimal Web Speech API typings (not in this TS lib.dom version). SpeechRecognitionResult
// / SpeechRecognitionResultList already exist in lib.dom; we only fill the gaps.
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
declare var SpeechRecognition: { new (): SpeechRecognition };
declare var webkitSpeechRecognition: { new (): SpeechRecognition };
