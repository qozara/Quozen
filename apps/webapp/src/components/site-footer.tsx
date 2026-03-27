export default function SiteFooter() {
  const legalBaseUrl = import.meta.env.VITE_LEGAL_BASE_URL || "https://qozara.org";

  return (
    <footer className="w-full py-6 mt-6 border-t border-border text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
      <div>© {new Date().getFullYear()} · Quozen is a research project by the Qozara Lab · Built for the Open Source Community</div>
      <div className="flex gap-4">
        <a
          href={`${legalBaseUrl}/legal/quozen/privacy.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          Privacy Policy
        </a>
        <a
          href={`${legalBaseUrl}/legal/quozen/tos.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          Terms of Service
        </a>
      </div>
    </footer>
  );
}
