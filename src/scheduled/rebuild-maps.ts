import { Env } from "../types/env"
import { rebuildMaps } from "../maps"

export const scheduledRebuildMaps: ExportedHandlerScheduledHandler<Env> = async (_, env: Env) => {
  await rebuildMaps(env)
}
