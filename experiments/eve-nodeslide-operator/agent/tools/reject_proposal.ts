import { reviewProposalInputSchema } from '@parity/nodeslide-agent-client';
import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';

import { nodeSlideClient } from '../../lib/nodeslide-client.js';

export default defineTool({
  description:
    'Reject the exact reviewed NodeSlide proposal without changing the deck. Requires the reviewed digest and base version.',
  inputSchema: reviewProposalInputSchema,
  approval: always(),
  async execute(input) {
    return nodeSlideClient().rejectProposal(input);
  },
});
