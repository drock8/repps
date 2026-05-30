import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base px-6">
        <div className="text-center max-w-xs">
          <p className="text-display-md text-ink-primary mb-2">
            Something went wrong
          </p>
          <p className="text-body text-ink-secondary mb-6">
            The app hit an unexpected error. Tap below to reload.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-accent text-ink-inverse font-bold text-body rounded-pill py-3 px-8 transition-all duration-200 ease-apple active:scale-95"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
