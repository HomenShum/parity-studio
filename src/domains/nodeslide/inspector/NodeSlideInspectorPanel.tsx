import type { NodeSlideEditorCommandId } from '../../../../shared/nodeslide';
import { InspectorPanel, type InspectorPanelProps } from './InspectorPanel';

export type NodeSlideInspectorPanelProps = InspectorPanelProps<NodeSlideEditorCommandId>;

export default function NodeSlideInspectorPanel(props: NodeSlideInspectorPanelProps) {
  return <InspectorPanel<NodeSlideEditorCommandId> {...props} />;
}
