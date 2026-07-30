import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[eaon] render crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback">
          <h2>Something crashed</h2>
          <p>{String(this.state.error.message ?? this.state.error)}</p>
          <button className="btn btn-accent" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
