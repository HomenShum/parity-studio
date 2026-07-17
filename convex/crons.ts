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

crons.interval(
  'prune expired NodeSlide visual evidence',
  { hours: 1 },
  internal.nodeslide.pruneExpiredEvidenceCapturesInternal,
  {},
);

crons.interval(
  'check opted-in NodeSlide web sources',
  { minutes: 15 },
  internal.nodeslideSourceRefresh.scanDueInternal,
  {},
);

export default crons;
