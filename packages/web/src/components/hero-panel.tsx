import type { ReactNode } from 'react';

export function HeroPanel(
  props: Readonly<{
    eyebrow: string;
    title: string;
    description: string;
    statusItems: Array<{ label: string; value: string }>;
    action?: ReactNode;
  }>
): JSX.Element {
  return (
    <section className="hero-panel">
      <div className="hero-panel__header">
        <div>
          <p className="eyebrow">{props.eyebrow}</p>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
        </div>
        {props.action ? <div className="hero-panel__action">{props.action}</div> : null}
      </div>

      <div className="hero-panel__status-row">
        {props.statusItems.map((item) => (
          <div key={item.label}>
            <span className="hero-panel__label">{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}