export function MetricCard(props: Readonly<{ label: string; value: number | string; hint: string }>): JSX.Element {
  return (
    <article className="metric-card">
      <span className="metric-card__label">{props.label}</span>
      <strong className="metric-card__value">{props.value}</strong>
      <span className="metric-card__hint">{props.hint}</span>
    </article>
  );
}