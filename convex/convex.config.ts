import { defineApp } from 'convex/server';
import persistentTextStreaming from '@convex-dev/persistent-text-streaming/convex.config';
import workflow from '@convex-dev/workflow/convex.config';

const app = defineApp();
app.use(workflow);
app.use(persistentTextStreaming);

export default app;
