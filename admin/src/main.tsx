import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";
const App = React.lazy(() =>
  import("./App").then((module) => ({ default: module.App })),
);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense
        fallback={
          <main className="page-placeholder" role="status">
            <h1>Kavach</h1>
            <p>Loading colony enrollment…</p>
            <p className="small">Demo mode — no emergency alerts are sent.</p>
          </main>
        }
      >
        <App />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
