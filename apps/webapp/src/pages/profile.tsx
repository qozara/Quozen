import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User as UserIcon, Settings, HelpCircle, LogOut, Mail, RefreshCw, AlertCircle, Coins, Globe, Sparkles, Cpu, Key, Bot } from "lucide-react";
import { quozen } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiFeature } from "@/features/agent/AiFeatureContext";
import { agentClient } from "@/lib/agent";
import { AiProviderFactory } from "@quozen/core";

const POPULAR_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "INR", "CNY", "BRL", "MXN", "ARS", "CHF"
];

const ALL_CURRENCY_CODES = [
  // North & South America, West Europe, Asia, Oceania (Curated)
  "ARS", "AUD", "BOB", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "DKK",
  "EUR", "FJD", "GBP", "GYD", "HKD", "IDR", "INR", "JPY", "KRW", "MXN",
  "MYR", "NOK", "NZD", "PEN", "PHP", "PYG", "SEK", "SGD", "SRD", "THB",
  "TWD", "USD", "UYU", "VES", "VND"
];

const OTHER_CURRENCIES = ALL_CURRENCY_CODES.filter(c => !POPULAR_CURRENCIES.includes(c));

const currencyLabelCache: Record<string, string> = {};

const getCurrencyLabel = (code: string) => {
  if (currencyLabelCache[code]) return currencyLabelCache[code];
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const parts = formatter.formatToParts(0);
    const symbolPart = parts.find(p => p.type === 'currency');
    const symbol = symbolPart ? symbolPart.value : code;
    const label = `${code} (${symbol})`;
    currencyLabelCache[code] = label;
    return label;
  } catch (e) {
    currencyLabelCache[code] = code;
    return code;
  }
};

export default function Profile() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useSettings();
  const { groups } = useGroups();
  const { t } = useTranslation();
  const { status: aiStatus } = useAiFeature();
  const [apiKey, setApiKey] = React.useState("");

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      return await quozen.groups.reconcileGroups();
    },
    onSuccess: (newSettings) => {
      queryClient.setQueryData(["drive", "settings", user?.email], newSettings);
      toast({
        title: t("common.success"),
        description: t("profile.reconcileDesc"),
      });
    },
    onError: (error) => {
      toast({
        title: t("profile.scanFailed"),
        description: t("profile.scanFailedDesc"),
        variant: "destructive"
      });
    }
  });

  const handleCurrencyChange = (currency: string) => {
    if (settings) {
      updateSettings({
        ...settings,
        preferences: {
          ...settings.preferences,
          defaultCurrency: currency
        }
      });
      toast({ title: t("common.save") });
    }
  };

  const handleLanguageChange = (locale: string) => {
    if (settings) {
      // cast to expected union type
      const validLocale = (locale === "en" || locale === "es" || locale === "system") ? locale : "system";

      updateSettings({
        ...settings,
        preferences: {
          ...settings.preferences,
          locale: validLocale
        }
      });
      // Side effect handled by useSettings hook
      toast({ title: t("common.save") });
    }
  };

  const handleLogout = () => {
    logout();
  };

  const handleAiProviderChange = (provider: string) => {
    if (settings) {
      updateSettings({
        ...settings,
        preferences: {
          ...settings.preferences,
          aiProvider: provider as any
        }
      });
      toast({ title: t("common.save") });
    }
  };

  const [isEncrypting, setIsEncrypting] = React.useState(false);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim() || !settings) return;

    setIsEncrypting(true);
    try {
      const ciphertext = await agentClient.encryptApiKey(apiKey);

      updateSettings({
        ...settings,
        encryptedApiKey: ciphertext
      });

      setApiKey("");
      toast({
        title: t("common.success"),
        description: "API Key encrypted and saved securely.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: t("common.error"),
        description: error.message || "Could not encrypt API Key. Check your connection.",
        variant: "destructive"
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-4 mt-4" data-testid="profile-loading">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-2">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 space-y-6 pb-8" data-testid="profile-view">
      {/* Profile Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center overflow-hidden">
              {user.picture ? (
                <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-8 h-8 text-primary-foreground" />
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground" data-testid="text-user-name">
                {user.name}
              </h2>
              <p className="text-muted-foreground" data-testid="text-user-email">
                {user.email}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-foreground" data-testid="text-group-count">
              {groups.length}
            </div>
            <p className="text-sm text-muted-foreground">{t("profile.activeGroups")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-foreground">
              {settings?.preferences?.defaultCurrency || "USD"}
            </div>
            <p className="text-sm text-muted-foreground">{t("profile.currency")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Preferences & Data */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center">
            <Settings className="w-5 h-5 mr-2" />
            {t("profile.preferences")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Currency */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-muted-foreground" />
              {t("profile.currency")}
            </Label>
            <Select
              value={settings?.preferences?.defaultCurrency || "USD"}
              onValueChange={handleCurrencyChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("profile.popularCurrencies")}</SelectLabel>
                  {POPULAR_CURRENCIES.map(code => (
                    <SelectItem key={code} value={code}>{getCurrencyLabel(code)}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t("profile.allCurrencies")}</SelectLabel>
                  {OTHER_CURRENCIES.map(code => (
                    <SelectItem key={code} value={code}>{getCurrencyLabel(code)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              {t("profile.language")}
            </Label>
            <Select
              value={settings?.preferences?.locale || "system"}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("profile.selectLanguage")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System (Auto)</SelectItem>
                <SelectItem value="en">English (US)</SelectItem>
                <SelectItem value="es">Español (LatAm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Sync */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("profile.reconcile")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("profile.reconcileDesc")}
            </p>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              data-testid="button-reconcile"
            >
              <RefreshCw className={`w-4 h-4 mr-3 ${reconcileMutation.isPending ? 'animate-spin' : ''}`} />
              {reconcileMutation.isPending ? t("profile.scanning") : t("profile.scan")}
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("profile.troubleshoot")}</h4>
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                localStorage.removeItem("quozen_access_token");
                window.location.reload();
              }}
            >
              <AlertCircle className="w-4 h-4 mr-3" />
              {t("profile.forceLogin")}
            </Button>
          </div>

        </CardContent>
      </Card>

      {/* AI Assistant */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-primary" />
            {t("profile.aiAssistant")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {aiStatus === 'checking' ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : aiStatus === 'unavailable' ? (
            <p className="text-sm text-muted-foreground italic">
              {t("profile.aiNotAvailable")}
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  {t("profile.aiProvider")}
                </Label>
                <Select
                  value={settings?.preferences?.aiProvider || "auto"}
                  onValueChange={handleAiProviderChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("profile.aiAuto")}</SelectItem>
                    <SelectItem value="byok">{t("profile.aiByok")}</SelectItem>
                    <SelectItem value="local">{t("profile.aiLocal")}</SelectItem>
                    <SelectItem value="disabled">{t("profile.aiDisabled")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("profile.aiProviderDesc")}
                </p>
                {AiProviderFactory.getSetupMessage(settings?.preferences?.aiProvider || 'auto') && (
                  <p className="text-xs font-medium text-amber-600 mt-2 bg-amber-50 p-2 rounded border border-amber-100 italic">
                    {AiProviderFactory.getSetupMessage(settings?.preferences?.aiProvider || 'auto')}
                  </p>
                )}
              </div>

              {settings?.preferences?.aiProvider === 'byok' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                  <Label className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-muted-foreground" />
                    {t("profile.apiKey")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveApiKey}
                      disabled={isEncrypting || !apiKey.trim()}
                    >
                      {isEncrypting ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("profile.saveKey")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Support */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-foreground mb-4">{t("profile.support")}</h3>
          <div className="space-y-2">
            <Button
              variant="ghost"
              className="w-full justify-start"
              data-testid="button-help"
            >
              <HelpCircle className="w-4 h-4 mr-3" />
              {t("profile.help")}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              data-testid="button-contact"
            >
              <Mail className="w-4 h-4 mr-3" />
              {t("profile.contact")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Card>
        <CardContent className="p-4">
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            data-testid="button-sign-out"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-3" />
            {t("profile.signOut")}
          </Button>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground py-4">
        <p>Quozen version ({__COMMIT_HASH__})</p>
        <p>Decentralized Expense Sharing</p>
      </div>
    </div>
  );
}