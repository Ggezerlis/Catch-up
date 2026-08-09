import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

// The OAuth client_id can't live in a static manifest.json without being
// committed, so the manifest is generated here from .env.local at build time.
export default defineManifest((env) => {
  const vars = loadEnv(env.mode, process.cwd(), "");
  return {
    manifest_version: 3,
    name: "Catch Up",
    version: "0.1.0",
    description: "Catch up on your unread Gmail in under 60 seconds.",
    action: {
      default_popup: "src/popup/index.html",
      default_title: "Catch Up",
    },
    background: {
      service_worker: "src/background/index.ts",
      type: "module",
    },
    permissions: ["identity", "storage"],
    host_permissions: [
      "https://gmail.googleapis.com/*",
      "https://api.anthropic.com/*",
    ],
    oauth2: {
      client_id:
        vars.GOOGLE_CLIENT_ID ??
        "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    },
  };
});
