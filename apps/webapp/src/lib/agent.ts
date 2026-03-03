import { AgentClient } from "@quozen/core";
import { getAuthToken } from "./tokenStore";

const PROXY_URL = import.meta.env.VITE_AI_PROXY_URL;

export const agentClient = new AgentClient(
    PROXY_URL,
    getAuthToken
);
