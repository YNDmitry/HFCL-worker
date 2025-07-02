import { Env } from '../types/env';
import { scheduledRebuildMaps }  from './rebuild-maps';
import { scheduledRebuildChart } from './yahoo-chart';

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext,
) {
  switch (event.cron) {
    case '0 0 * * *': // 00:00 UTC — rebuild slug-map
      return scheduledRebuildMaps(event, env, _ctx);
    case '*/15 * * * *': // Every 15 min — update quote
      return scheduledRebuildChart(event, env, _ctx);
    default:
      console.warn('Unhandled cron', event.cron);
  }
}
