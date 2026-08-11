import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

// The OAuth client_id can't live in a static manifest.json without being
// committed, so the manifest is generated here from .env.local at build time.
export default defineManifest((env) => {
  const vars = loadEnv(env.mode, process.cwd(), "");
  // Grants the service worker cross-origin fetch to the proxy without CORS
  // headers being required on its responses. Falls back to a placeholder
  // until CATCHUP_PROXY_URL is set in .env.local.
  const proxyOrigin = (() => {
    try {
      return new URL(vars.CATCHUP_PROXY_URL ?? "").origin;
    } catch {
      return "https://your-worker-subdomain.workers.dev";
    }
  })();
  return {
    manifest_version: 3,
    name: "Catch Up",
    version: "0.1.0",
    description: "Catch up on your unread Gmail in under 60 seconds.",
    action: {
      default_popup: "src/popup/index.html",
      default_title: "Catch Up",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    background: {
      service_worker: "src/background/index.ts",
      type: "module",
    },
    permissions: ["identity", "storage"],
    host_permissions: [
      "https://gmail.googleapis.com/*",
      `${proxyOrigin}/*`,
    ],
    oauth2: {
      client_id:
        vars.GOOGLE_CLIENT_ID ??
        "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    },
  };
});
