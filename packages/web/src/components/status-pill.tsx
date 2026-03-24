export function StatusPill(props: Readonly<{ value: string | null | undefined }>): JSX.Element {
  return <span className={`status-pill status-pill--${props.value ?? 'unknown'}`}>{props.value ?? 'unknown'}</span>;
}