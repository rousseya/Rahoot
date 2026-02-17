import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const env = createEnv({
  server: {
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    SOCKET_URL: z.string().default("http://localhost:3001"),
    GOOGLE_CLIENT_ID: z.string().default(""),
  },

  runtimeEnv: {
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    SOCKET_URL: process.env.SOCKET_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  },
})

export default env
