import { inspectDeckInputSchema } from '@parity/nodeslide-agent-client';
import { defineTool } from 'eve/tools';

import { nodeSlideClient } from '../../lib/nodeslide-client.js';

export default defineTool({
  description:
    'Inspect a NodeSlide deck or one slide. This is read-only and returns bounded structured content, versions, locks, sources, validation, and a receipt.',
  inputSchema: inspectDeckInputSchema,
  async execute(input) {
    return nodeSlideClient().inspectDeck(input);
  },
});
