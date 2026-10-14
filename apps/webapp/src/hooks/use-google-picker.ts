import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/context/auth-provider";

const API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY;
const APP_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.split("-")[0]; // Project ID usually first part of client ID

interface UseGooglePickerProps {
    onPick: (doc: google.picker.PickerDocument) => void;
    onCancel?: () => void;
    query?: string;
}

export function useGooglePicker({ onPick, onCancel, query }: UseGooglePickerProps) {
    const { token } = useAuth();
    const [isLoaded, setIsLoaded] = useState(() => {
        return typeof window !== "undefined" && Boolean(window.google && window.google.picker);
    });
    const [error, setError] = useState<string | null>(null);

    // Load the Google API script if not already loaded
    const loadPickerApi = useCallback(() => {
        if (window.google && window.google.picker) {
            setIsLoaded(true);
            return;
        }

        if (!API_KEY) {
            setError("VITE_GOOGLE_PICKER_API_KEY is missing in environment variables.");
            return;
        }

        const scriptId = "google-picker-api-script";
        if (document.getElementById(scriptId)) {
            return;
        }

        const script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://apis.google.com/js/api.js";
        script.async = true;
        script.defer = true;

        script.onload = () => {
            if (window.gapi) {
                window.gapi.load("picker", {
                    callback: () => setIsLoaded(true),
                });
            } else {
                setError("Google API failed to load.");
            }
        };

        script.onerror = () => setError("Failed to load Google Picker API script.");
        document.body.appendChild(script);
    }, []);

    // Proactively load Picker API on mount so it's ready when user clicks
    useEffect(() => {
        loadPickerApi();
    }, [loadPickerApi]);

    // Open the picker
    const openPicker = useCallback(() => {
        if (!isLoaded) {
            loadPickerApi();
            return;
        }

        if (!token) {
            setError("User not authenticated.");
            return;
        }

        if (!API_KEY || !APP_ID) {
            setError("Missing API Key or App ID configuration.");
            return;
        }

        // Spreadsheets view with setOwnedByMe(false) so shared spreadsheets are included
        const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
            .setMimeTypes("application/vnd.google-apps.spreadsheet")
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setOwnedByMe(false);

        if (query) {
            view.setQuery(query);
        }

        // Dedicated Docs view with setOwnedByMe(false) to guarantee visibility for restricted files shared by email
        const allDocsView = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setMimeTypes("application/vnd.google-apps.spreadsheet")
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setOwnedByMe(false);

        if (query) {
            allDocsView.setQuery(query);
        }

        const picker = new google.picker.PickerBuilder()
            .setAppId(APP_ID)
            .setOAuthToken(token)
            .setDeveloperKey(API_KEY)
            .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
            .addView(view)
            .addView(allDocsView)
            .setCallback((data: google.picker.PickerResponse) => {
                if (data.action === google.picker.Action.PICKED && data.docs && data.docs.length > 0) {
                    onPick(data.docs[0]);
                } else if (data.action === google.picker.Action.CANCEL) {
                    if (onCancel) onCancel();
                }
            })
            .build();

        picker.setVisible(true);
    }, [isLoaded, token, onPick, onCancel, loadPickerApi, query]);

    return { openPicker, isLoaded, error };
}