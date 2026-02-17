import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

const env = createEnv({
  server: {
    WEB_ORIGIN: z.string().optional().default("http://localhost:3000"),
    SOCKET_URL: z.string().optional().default("http://localhost:3001"),
    SOCKER_PORT: z.string().optional().default("3001"),
    GOOGLE_CLIENT_ID: z.string().optional().default(""),
  },

  runtimeEnv: {
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    SOCKET_URL: process.env.SOCKET_URL,
    SOCKER_PORT: process.env.SOCKER_PORT,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  },
});

export default env;
