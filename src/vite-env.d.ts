/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly CATCHUP_PROXY_URL: string;
  readonly CATCHUP_PROXY_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
