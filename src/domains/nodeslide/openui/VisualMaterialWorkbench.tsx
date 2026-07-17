import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { type ActionEvent, Renderer, createLibrary, defineComponent } from '@openuidev/react-lang';
import { ArrowRight, Check, Layers3, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { z } from 'zod';
import type { Deck, PatchOperation, Slide } from '../../../../shared/nodeslide';
import {
  AI2027_OPENUI_PROGRAM,
  AI2027_TRANSFORMATION_LADDER,
  NODESLIDE_OPENUI_ACTION,
  compileVisualMaterialProposal,
  validateVisualMaterialSpec,
} from './visualMaterials';

const ladderProps = z.object({
  eyebrow: z.string(),
  title: z.string(),
  subtitle: z.string(),
  step1Label: z.string(),
  step1Value: z.string(),
  step1Unit: z.string(),
  step2Label: z.string(),
  step2Value: z.string(),
  step2Unit: z.string(),
  step3Label: z.string(),
  step3Value: z.string(),
  step3Unit: z.string(),
  step4Label: z.string(),
  step4Value: z.string(),
  step4Unit: z.string(),
  provenance: z.string(),
});

type VisualMaterialAction = Pick<ActionEvent, 'type' | 'params'>;

const TransformationLadder = defineComponent({
  name: 'TransformationLadder',
  description:
    'A four-stage visual transformation ladder for claims with incompatible units. It must never imply a shared quantitative axis.',
  props: ladderProps,
  component: ({ props }) => {
    const steps = [
      [props.step1Label, props.step1Value, props.step1Unit],
      [props.step2Label, props.step2Value, props.step2Unit],
      [props.step3Label, props.step3Value, props.step3Unit],
      [props.step4Label, props.step4Value, props.step4Unit],
    ];
    return (
      <article className="ns-openui-material" data-testid="openui-transformation-ladder">
        <div className="ns-openui-material-heading">
          <span>{props.eyebrow}</span>
          <h3>{props.title}</h3>
          <p>{props.subtitle}</p>
        </div>
        <ol className="ns-openui-ladder" aria-label="Transformation ladder">
          {steps.map(([label, value, unit], index) => (
            <li key={label}>
              <span className="ns-openui-step-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{label}</small>
                <strong>{value}</strong>
                <span>{unit}</span>
              </div>
              {index < steps.length - 1 ? <ArrowRight size={13} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
        <div className="ns-openui-material-footer">
          <span>
            <ShieldCheck size={13} /> {props.provenance}
          </span>
        </div>
      </article>
    );
  },
});

export const nodeslideVisualMaterialLibrary = createLibrary({
  components: [TransformationLadder],
  root: 'TransformationLadder',
});

export interface VisualMaterialWorkbenchProps {
  deck: Deck;
  slide: Slide;
  disabled?: boolean;
  onPropose: (operations: PatchOperation[], summary: string) => Promise<void>;
}

export function VisualMaterialWorkbench({
  deck,
  slide,
  disabled = false,
  onPropose,
}: VisualMaterialWorkbenchProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'proposed' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const validation = validateVisualMaterialSpec(AI2027_TRANSFORMATION_LADDER);

  const proposeVisualMaterial = async () => {
    if (disabled || actionInFlight.current) {
      return;
    }
    actionInFlight.current = true;
    setStatus('working');
    setMessage(null);
    try {
      const proposal = compileVisualMaterialProposal(AI2027_TRANSFORMATION_LADDER, deck, slide);
      await onPropose(proposal.operations, proposal.summary);
      setStatus('proposed');
      setMessage('Proposal created. The deck is unchanged until you accept it.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The proposal could not be created.');
      actionInFlight.current = false;
    }
  };

  const handleAction = (event: VisualMaterialAction) => {
    if (
      event.type !== NODESLIDE_OPENUI_ACTION ||
      event.params['specId'] !== AI2027_TRANSFORMATION_LADDER.id
    ) {
      return;
    }
    void proposeVisualMaterial();
  };

  return (
    <Collapsible className="ns-openui-workbench" data-testid="openui-visual-workbench">
      <CollapsibleTrigger>
        <span className="ns-openui-summary-icon">
          <Layers3 size={14} />
        </span>
        <span>
          <strong>Visual material lab</strong>
          <small>OpenUI · deterministic Phase 0</small>
        </span>
        <span className={validation.ok ? 'is-valid' : 'is-invalid'}>
          {validation.ok ? <Check size={12} /> : null}
          {validation.ok ? 'Unit-safe' : 'Blocked'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ns-openui-workbench-body" aria-busy={status === 'working'}>
        <Renderer
          response={AI2027_OPENUI_PROGRAM}
          library={nodeslideVisualMaterialLibrary}
          isStreaming={status === 'working' || disabled}
          onAction={handleAction}
        />
        <div className="ns-openui-host-action">
          <span>NodeSlide will create one reviewable add-slide proposal.</span>
          <button
            type="button"
            className="ns-button ns-button--accent"
            data-testid="openui-create-proposal"
            disabled={disabled || status === 'working' || status === 'proposed'}
            onClick={() => void proposeVisualMaterial()}
          >
            <Sparkles size={13} /> Create slide proposal
          </button>
        </div>
        {message ? (
          <output className={`ns-openui-status is-${status}`} data-testid="openui-proposal-status">
            {message}
          </output>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
