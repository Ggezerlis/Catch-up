import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // Expose CATCHUP_* vars (the backend proxy URL/secret) from .env.local to
  // the bundle. The Anthropic key itself never enters this bundle — it lives
  // only in the worker's Cloudflare secrets (see worker/README or root README).
  envPrefix: ["VITE_", "CATCHUP_"],
});
