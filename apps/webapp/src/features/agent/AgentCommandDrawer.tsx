import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Zap, Send, RefreshCw } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from 'react-i18next';
import { useAgent } from './useAgent';
import { useAppContext } from '@/context/app-context';
import { useSettings } from '@/hooks/use-settings';

export const AgentCommandDrawer: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const handedOffRef = useRef(false);
    const { t } = useTranslation();
    const { executeCommand } = useAgent();
    const { activeGroupId } = useAppContext();
    const { settings } = useSettings();

    const isClosedOrArchived = Boolean(
        activeGroupId && (
            settings?.groupCache?.some(g => g.id === activeGroupId && g.status === 'closed') ||
            settings?.archivedGroupCache?.some(g => g.id === activeGroupId)
        )
    );

    if (isClosedOrArchived) {
        return null;
    }

    const handleSubmit = async () => {
        if (!prompt.trim() || isThinking) return;

        setIsThinking(true);
        const result = await executeCommand(prompt);
        setIsThinking(false);

        if (result.success) {
            handedOffRef.current = true;
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
            <Zap className="w-4 h-4 text-primary" />
        </button>
    );

    const slot = document.getElementById('header-actions-slot');

    return (
        <>
            {slot && createPortal(trigger, slot)}

            <Drawer open={isOpen} onOpenChange={setIsOpen}>
                <DrawerContent
                    onCloseAutoFocus={(event) => {
                        if (handedOffRef.current) {
                            event.preventDefault();
                            handedOffRef.current = false;
                        }
                    }}
                >
                    <DrawerHeader>
                        <DrawerTitle className="flex items-center gap-2" data-testid="drawer-title-ai">
                            <Zap className="w-5 h-5 text-primary" />
                            {t('agent.title')}
                        </DrawerTitle>
                        <DrawerDescription>
                            {t('agent.description')}
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="px-4 pt-2 pb-6">
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
                    </div>
                </DrawerContent>
            </Drawer>
        </>
    );
};
