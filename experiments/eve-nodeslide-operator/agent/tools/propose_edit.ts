import { proposeEditInputSchema } from '@parity/nodeslide-agent-client';
import { defineTool } from 'eve/tools';

import { nodeSlideClient } from '../../lib/nodeslide-client.js';

export default defineTool({
  description:
    'Create a validated, unapplied NodeSlide edit proposal. This never changes the canonical deck. Hosted execution requires explicit per-call consent.',
  inputSchema: proposeEditInputSchema,
  async execute(input) {
    return nodeSlideClient().proposeEdit(input);
  },
});
