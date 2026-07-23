import { ChatGroq } from "@langchain/groq";

// Central place that knows how to talk to Groq. Phase 2+ will reuse this
// same model instance and just start handing it tools to call.
export function createChatModel() {
  if (!process.env.GROQ_API_KEY) {
    // The packaged tray app deliberately never reads the project's .env
    // (that would mean shipping a real API key inside the installer) — it
    // looks in the user's own AppData folder instead, so the fix differs
    // depending on which face is running.
    const hint = process.versions.electron
      ? "Add GROQ_API_KEY=your_key to a .env file at %APPDATA%\\DeskMate\\.env, then restart DeskMate."
      : "Copy .env.example to .env and add your key.";
    throw new Error(`Missing GROQ_API_KEY. ${hint}`);
  }

  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
  });
}
