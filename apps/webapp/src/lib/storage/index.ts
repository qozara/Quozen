import {
    QuozenClient,
    GoogleDriveStorageLayer,
    InMemoryAdapter,
    RemoteMockAdapter
} from "@quozen/core";
import { getAuthToken } from "../tokenStore";

let cachedAdapter: any = null;

export const getQuozen = (): QuozenClient => {
    const userStr = localStorage.getItem("quozen_user_profile");
    const user = userStr ? JSON.parse(userStr) : { id: "", username: "", email: "", name: "" };

    const mockValue = import.meta.env.VITE_USE_MOCK_STORAGE;
    const useRemoteMock = mockValue === 'remote';
    const useMock = useRemoteMock || mockValue === 'true' || import.meta.env.MODE === 'test';

    if (!cachedAdapter) {
        cachedAdapter = useMock
            ? (useRemoteMock ? new RemoteMockAdapter(getAuthToken) : new InMemoryAdapter())
            : new GoogleDriveStorageLayer(getAuthToken);
    }

    return new QuozenClient({ storage: cachedAdapter, user, enableCache: true, cacheTtlMs: 30000 });
};

export const quozen = new Proxy({} as QuozenClient, { 
    get(target, prop) { 
        return (getQuozen() as any)[prop]; 
    } 
});

export { InMemoryAdapter };
