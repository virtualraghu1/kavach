import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="page-placeholder">
        <h1>We couldn’t open the demo</h1>
        <p>Your saved demo data has not been removed. Reload to try again.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload Kavach
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
