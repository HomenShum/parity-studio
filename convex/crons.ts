import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'recover stale NodeSlide agent runs',
  { minutes: 2 },
  internal.nodeslide.recoverStaleAgentRunsInternal,
  {},
);

crons.interval(
  'prune expired NodeSlide execution traces',
  { hours: 1 },
  internal.nodeslide.pruneExpiredExecutionTracesInternal,
  {},
);

crons.interval(
  'prune expired NodeSlide shadow comparisons',
  { hours: 1 },
  internal.nodeslide.pruneExpiredShadowComparisonsInternal,
  {},
);

export default crons;
