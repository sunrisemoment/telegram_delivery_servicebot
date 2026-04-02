import { Component, isValidElement } from 'react';
import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'olive' | 'warning';
}) {
  return (
    <article className={`panel stat-card tone-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  const normalizedTone =
    tone === 'approved' || tone === 'delivered' || tone === 'olive' || tone === 'active'
      ? 'approved'
      : tone === 'pending' || tone === 'placed' || tone === 'warning'
        ? 'pending'
        : tone === 'cancelled' || tone === 'inactive' || tone === 'revoked'
          ? 'cancelled'
          : 'neutral';

  return <span className={`status-pill ${normalizedTone}`}>{children}</span>;
}

export function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  let renderedValue: ReactNode = value;

  if (value === null || value === undefined || value === '') {
    renderedValue = 'N/A';
  } else if (!isValidElement(value) && typeof value === 'object' && !Array.isArray(value)) {
    const namedValue = (value as { name?: unknown }).name;
    if (typeof namedValue === 'string') {
      renderedValue = namedValue;
    } else {
      try {
        renderedValue = JSON.stringify(value);
      } catch {
        renderedValue = 'N/A';
      }
    }
  }

  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{renderedValue}</strong>
    </div>
  );
}

export function EmptyPanel({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="empty-panel">
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return <article className="panel loading-panel">{label}…</article>;
}

export function ErrorPanel({ message }: { message: string }) {
  return <article className="panel inline-error">{message}</article>;
}

type ViewErrorBoundaryProps = {
  title: string;
  children: ReactNode;
};

type ViewErrorBoundaryState = {
  error: Error | null;
};

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`Admin view crash: ${this.props.title}`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <article className="panel inline-error">
          <strong>{this.props.title}</strong>
          <p>{this.state.error.message || 'This section failed to render.'}</p>
          <button className="secondary-button compact-button" onClick={() => window.location.reload()} type="button">
            Reload Admin
          </button>
        </article>
      );
    }

    return this.props.children;
  }
}
