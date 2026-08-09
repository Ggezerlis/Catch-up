/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ANTHROPIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
