import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No auth / POC: proxy /api straight to the backend so the browser only ever talks to
// one origin in dev. The OpenAI WebRTC calls (client_secrets consumption + SDP exchange)
// go directly from the browser to api.openai.com, not through this proxy — see plan.md.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
