import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // Expose ANTHROPIC_API_KEY from .env.local to the bundle.
  // Local dev only — before Chrome Web Store, the Claude call must move
  // behind a backend proxy (see README).
  envPrefix: ["VITE_", "ANTHROPIC_"],
});
