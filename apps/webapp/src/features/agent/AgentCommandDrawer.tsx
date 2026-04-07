import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Send, Zap, Bot, Cpu } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from 'react-i18next';
import { useAgent } from './useAgent';
import { useAiFeature } from './AiFeatureContext';
import { RefreshCw } from 'lucide-react';

export const AgentCommandDrawer: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const { t } = useTranslation();
    const { executeCommand } = useAgent();
    const { provider } = useAiFeature();

    const getBadgeInfo = () => {
        const mode = provider?.mode || 'cloud';
        if (mode === 'local-browser') return { icon: <Cpu className="w-3 h-3" />, label: t('agent.onDevice') };
        if (mode === 'local-ollama') return { icon: <Cpu className="w-3 h-3" />, label: 'Local Ollama' };
        if (mode === 'byok') return { icon: <Zap className="w-3 h-3" />, label: t('agent.poweredByYourKey') };
        return { icon: <Bot className="w-3 h-3" />, label: t('agent.poweredByTeamKey') };
    };

    const badge = getBadgeInfo();

    const handleSubmit = async () => {
        if (!prompt.trim() || isThinking) return;

        setIsThinking(true);
        const result = await executeCommand(prompt);
        setIsThinking(false);

        if (result.success) {
            setIsOpen(false);
            setPrompt('');
        }
    };

    const trigger = (
        <button
            onClick={() => setIsOpen(true)}
            className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors"
            title={t('agent.title')}
            data-testid="button-ai-assistant"
        >
            <Sparkles className="w-4 h-4 text-primary" />
        </button>
    );

    const slot = document.getElementById('header-actions-slot');

    return (
        <>
            {slot && createPortal(trigger, slot)}

            <Drawer open={isOpen} onOpenChange={setIsOpen}>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle className="flex items-center gap-2" data-testid="drawer-title-ai">
                            <Sparkles className="w-5 h-5 text-primary" />
                            {t('agent.title')}
                        </DrawerTitle>
                        <DrawerDescription>
                            {t('agent.description')}
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="px-4 py-2 space-y-4">
                        <div className="relative">
                            <Textarea
                                autoFocus
                                placeholder={t('agent.inputPlaceholder')}
                                className="min-h-[120px] resize-none pr-12 focus-visible:ring-primary text-base"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                            />
                            <Button
                                size="icon"
                                className="absolute bottom-3 right-3 rounded-full h-8 w-8"
                                disabled={!prompt.trim() || isThinking}
                                onClick={handleSubmit}
                                data-testid="button-ai-submit"
                            >
                                {isThinking ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                            </Button>
                        </div>

                        <div className="flex items-center gap-1.5 px-1 pb-6">
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground animate-in fade-in duration-500">
                                {badge.icon}
                                <span>{badge.label}</span>
                            </div>
                        </div>
                    </div>
                </DrawerContent>
            </Drawer>
        </>
    );
};
