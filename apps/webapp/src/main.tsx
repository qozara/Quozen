import { createRoot } from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import ErrorBoundary from "./components/error-boundary";
import { initQuozenStorage } from "./lib/storage";
import "./index.css";
// Import i18n configuration
import "./lib/i18n";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

if (!clientId) {
  console.error("Missing VITE_GOOGLE_CLIENT_ID environment variable");
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

initQuozenStorage()
  .catch((err) => {
    console.warn("Local RxDB storage initialization warning:", err);
  })
  .finally(() => {
    createRoot(rootElement).render(
      <GoogleOAuthProvider clientId={clientId || ""}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </GoogleOAuthProvider>
    );
  });

