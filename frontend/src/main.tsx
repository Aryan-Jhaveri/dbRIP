/**
 * Application entry point — mounts the React app into the DOM.
 *
 * WHAT THIS FILE DOES:
 *   1. Imports global CSS (Tailwind utilities + our base styles)
 *   2. Wraps the app in React's StrictMode (enables extra dev-time warnings)
 *   3. Wraps the app in QueryClientProvider (makes TanStack Query available
 *      to all components — any component can fetch data from the API)
 *   4. Renders into the #root div defined in index.html
 *
 * WHAT IS QueryClientProvider?
 *   TanStack Query manages all HTTP requests to the FastAPI backend. It handles
 *   caching, loading states, error states, and background refetching. The
 *   QueryClientProvider at the top of the tree makes this available to every
 *   component via hooks like useQuery().
 *
 * WHY StrictMode?
 *   StrictMode intentionally double-renders components in development to help
 *   catch bugs (like missing cleanup in useEffect). It does NOT affect production.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";

/**
 * QueryClient configuration.
 *
 * staleTime: How long cached data is considered "fresh" (5 minutes).
 *   During this window, navigating back to a page reuses cached data instantly
 *   instead of re-fetching. 5 minutes is reasonable for a read-only database
 *   where the data rarely changes.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
