import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { ChartData, Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';

interface SlideRendererProps {
  slide: Slide;
  elements: readonly SlideElement[];
  theme: ThemeSpec;
  className?: string;
  children?: ReactNode;
  elementClassName?: string;
  getElementStyle?: (element: SlideElement) => CSSProperties | undefined;
  isElementSelected?: (element: SlideElement) => boolean;
  onElementKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>, element: SlideElement) => void;
  onElementPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, element: SlideElement) => void;
  onElementDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>, element: SlideElement) => void;
  renderElementContent?: (element: SlideElement, defaultContent: ReactNode) => ReactNode;
}

export function SlideRenderer({
  slide,
  elements,
  theme,
  className = '',
  children,
  elementClassName = '',
  getElementStyle,
  isElementSelected,
  onElementKeyDown,
  onElementPointerDown,
  onElementDoubleClick,
  renderElementContent,
}: SlideRendererProps) {
  const orderedElements = slide.elementOrder
    .map((id) => elements.find((element) => element.id === id))
    .filter(
      (element): element is SlideElement => element !== undefined && element.visible !== false,
    );

  return (
    <div
      className={`ns-slide-renderer ${className}`.trim()}
      style={
        {
          '--ns-theme-canvas': slide.background || theme.colors.canvas,
          '--ns-theme-ink': theme.colors.ink,
          '--ns-theme-muted': theme.colors.muted,
          '--ns-theme-accent': theme.colors.accent,
        } as CSSProperties
      }
      data-slide-id={slide.id}
    >
      {orderedElements.map((element) => (
        <div
          className={`ns-slide-element ns-slide-element--${element.kind} ${elementClassName}`.trim()}
          data-element-id={element.id}
          data-testid={`slide-element-${element.id}`}
          key={element.id}
          aria-label={
            onElementKeyDown
              ? `${element.name}, ${element.kind} slide element${element.locked ? ', locked' : ''}`
              : undefined
          }
          aria-pressed={onElementKeyDown ? Boolean(isElementSelected?.(element)) : undefined}
          onKeyDown={onElementKeyDown ? (event) => onElementKeyDown(event, element) : undefined}
          onPointerDown={
            onElementPointerDown ? (event) => onElementPointerDown(event, element) : undefined
          }
          onDoubleClick={
            onElementDoubleClick ? (event) => onElementDoubleClick(event, element) : undefined
          }
          role={onElementKeyDown ? 'button' : undefined}
          style={{
            left: `${element.bbox.x * 100}%`,
            top: `${element.bbox.y * 100}%`,
            width: `${element.bbox.width * 100}%`,
            height: `${element.bbox.height * 100}%`,
            transform: `rotate(${element.rotation}deg)`,
            ...elementVisualStyle(element),
            ...getElementStyle?.(element),
          }}
          tabIndex={onElementKeyDown ? 0 : undefined}
        >
          {renderElementContent?.(element, <ElementContent element={element} theme={theme} />) ?? (
            <ElementContent element={element} theme={theme} />
          )}
        </div>
      ))}
      {children}
    </div>
  );
}

function ElementContent({ element, theme }: { element: SlideElement; theme: ThemeSpec }) {
  if (element.kind === 'image') {
    return element.imageUrl ? (
      <img
        className="ns-element-image"
        src={element.imageUrl}
        alt={element.altText ?? element.name}
        draggable={false}
      />
    ) : (
      <div
        className="ns-element-image-placeholder"
        role="img"
        aria-label={element.altText ?? element.name}
      >
        <strong>{element.altText ?? 'Image'}</strong>
        <span>Replace image</span>
        {element.image?.credit ? <small>{element.image.credit}</small> : null}
      </div>
    );
  }

  if (element.kind === 'chart' && element.chart) {
    return (
      <ChartGraphic chart={element.chart} accent={element.style.color ?? theme.colors.accent} />
    );
  }

  if (element.kind === 'math') {
    const expression = element.math?.expression ?? element.content ?? '';
    const display = element.math?.display ?? expression;
    const variables = element.math?.variables ?? [];
    return (
      <div
        className={`ns-element-math ns-math-primitive ns-element-math--${element.math?.syntax ?? 'plain'}`}
        role="math"
        aria-label={element.math?.description ?? `${element.name}: ${display}`}
      >
        <code>{display}</code>
        {variables.length > 0 ? (
          <small>
            {variables
              .map(
                (variable) =>
                  `${variable.label} = ${variable.value}${variable.unit ? ` ${variable.unit}` : ''}`,
              )
              .join(' · ')}
          </small>
        ) : null}
        {element.math?.syntax === 'latex' ? <small>LaTeX source</small> : null}
      </div>
    );
  }

  if (element.kind === 'video') {
    const video = element.video;
    return video?.url ? (
      // biome-ignore lint/a11y/useMediaCaption: The structured captions track is rendered when the deck supplies one; silent and illustrative clips may omit it.
      <video
        className="ns-element-video"
        src={mediaFragmentUrl(video.url, video.startAtSeconds, video.endAtSeconds)}
        poster={video.posterUrl}
        controls
        preload="metadata"
        aria-label={video.title ?? element.altText ?? element.name}
      >
        {video.captionsUrl ? (
          <track
            default
            kind="captions"
            src={video.captionsUrl}
            srcLang={video.captionsLanguage ?? 'en'}
          />
        ) : null}
      </video>
    ) : (
      <div className="ns-element-video-placeholder" role="img" aria-label={element.name}>
        <span>Video unavailable</span>
      </div>
    );
  }

  if (element.kind === 'connector') {
    return (
      <svg
        className="ns-element-connector"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={`arrow-${element.id}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        <line
          x1="3"
          y1="50"
          x2="94"
          y2="50"
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#arrow-${element.id})`}
        />
      </svg>
    );
  }

  return <span className="ns-element-copy">{element.content}</span>;
}

function mediaFragmentUrl(url: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return url;
  const fragment = `t=${Math.max(0, start ?? 0)}${end === undefined ? '' : `,${Math.max(0, end)}`}`;
  return `${url.split('#')[0]}#${fragment}`;
}

function elementVisualStyle(element: SlideElement): CSSProperties {
  const style = element.style;
  return {
    background: style.fill,
    borderColor: style.stroke,
    borderStyle: style.stroke ? 'solid' : undefined,
    borderWidth: style.strokeWidth === undefined ? undefined : `${style.strokeWidth}px`,
    borderRadius: style.radius === undefined ? undefined : `${style.radius / 12.8}cqw`,
    boxShadow: style.shadow,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize === undefined ? undefined : `${style.fontSize / 12.8}cqw`,
    fontWeight: style.fontWeight,
    letterSpacing:
      style.letterSpacing === undefined ? undefined : `${style.letterSpacing / 12.8}cqw`,
    lineHeight: style.lineHeight,
    opacity: style.opacity,
    padding: style.padding === undefined ? undefined : `${style.padding / 12.8}cqw`,
    textAlign: style.textAlign,
    alignItems:
      style.verticalAlign === 'middle'
        ? 'center'
        : style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start',
    justifyContent:
      style.textAlign === 'center'
        ? 'center'
        : style.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
  };
}

function ChartGraphic({ chart, accent }: { chart: ChartData; accent: string }) {
  if (chart.chartType === 'donut') {
    const values = chart.series.flatMap((series) => series.values);
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const primary = Math.max(0, values[0] ?? 0);
    const angle = (primary / total) * 360;
    return (
      <div className="ns-chart ns-chart--donut">
        <div
          className="ns-chart-donut"
          style={{
            background: `conic-gradient(${accent} 0deg ${angle}deg, color-mix(in srgb, ${accent} 16%, transparent) ${angle}deg 360deg)`,
          }}
        >
          <span>{Math.round((primary / total) * 100)}%</span>
        </div>
      </div>
    );
  }

  if (chart.chartType === 'bar') {
    const values = chart.series[0]?.values ?? [];
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    return (
      <div
        className="ns-chart ns-chart--bar"
        role="img"
        aria-label={`${chart.labels.join(', ')} bar chart`}
      >
        {values.map((value, index) => (
          <div className="ns-chart-bar-column" key={`${chart.labels[index] ?? 'bar'}-${index}`}>
            <span
              className="ns-chart-bar"
              style={{
                height: `${Math.max(3, (Math.abs(value) / max) * 100)}%`,
                background: chart.series[0]?.color ?? accent,
              }}
            />
            <small>{chart.labels[index]}</small>
          </div>
        ))}
      </div>
    );
  }

  const values = chart.series[0]?.values ?? [];
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const denominator = Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => `${(index / denominator) * 100},${94 - (Math.abs(value) / max) * 82}`)
    .join(' ');
  const areaPoints = `0,100 ${points} 100,100`;
  return (
    <div
      className="ns-chart ns-chart--line"
      role="img"
      aria-label={`${chart.labels.join(', ')} trend chart`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {chart.chartType === 'area' ? (
          <polygon points={areaPoints} fill={accent} opacity="0.14" />
        ) : null}
        <polyline
          points={points}
          fill="none"
          stroke={chart.series[0]?.color ?? accent}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
