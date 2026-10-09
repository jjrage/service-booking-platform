import "server-only";

import { parseEnv, serverEnvSchema } from "./env-schema";

export const serverEnv = parseEnv(serverEnvSchema, process.env, "server");
