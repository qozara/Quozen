import { useEffect } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import SiteFooter from "@/components/site-footer";
import { useTranslation, Trans } from "react-i18next";

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const legalBaseUrl = import.meta.env.VITE_LEGAL_BASE_URL || "https://qozara.org";

  // Clear message on component mount
  useEffect(() => {
    if (location.state?.message) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <img src="/logo.svg" alt="Quozen" className="w-16 h-16 animate-pulse mb-4" />
        <div className="text-muted-foreground font-medium">{t("common.loading")}</div>
      </div>
    );
  }

  if (isAuthenticated) {
    const from = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={from} replace />;
  }

  return (
    <div className="h-screen flex flex-col bg-primary overflow-hidden">
      {/* Top Section - Brand/Logo */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-32 h-32 bg-white/10 rounded-full flex items-center justify-center p-6 backdrop-blur-md border border-white/20 shadow-2xl animate-in fade-in zoom-in duration-700">
          <img
            src="/logo.svg"
            alt="Quozen Logo"
            className="w-full h-full object-contain brightness-0 invert"
          />
        </div>
        <div className="mt-6 text-center animate-in slide-in-from-bottom-4 duration-700 delay-200">
          <h1 className="text-4xl font-black tracking-tight text-white mb-2">QUOZEN</h1>
          <div className="h-1.5 w-12 bg-white/30 rounded-full mx-auto" />
        </div>
      </div>

      {/* Bottom Section - Actions */}
      <div className="bg-background rounded-t-[2.5rem] p-8 pb-12 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-full duration-700">
        <div className="space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              {t("login.welcome")}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("login.subtitle")}
            </p>
          </div>

          <div className="space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full h-14 text-base font-semibold border-2 border-border hover:bg-muted transition-all flex items-center justify-center gap-3"
              onClick={() => login()}
            >
              <img
                src="https://www.google.com/favicon.ico"
                alt="Google"
                className="w-5 h-5"
              />
              {t("login.continue")}
            </Button>

            <div className="text-[10px] text-center text-muted-foreground/60 leading-relaxed px-4">
              <Trans 
                i18nKey="login.disclaimer"
                components={{
                  tos: <a href={`${legalBaseUrl}/legal/quozen/tos.html`} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary transition-colors font-medium" />,
                  privacy: <a href={`${legalBaseUrl}/legal/quozen/privacy.html`} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary transition-colors font-medium" />
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="bg-background pb-8">
        <SiteFooter />
      </div>
    </div>
  );
}
