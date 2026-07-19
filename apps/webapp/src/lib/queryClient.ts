import { QueryClient, QueryFunctionContext } from "@tanstack/react-query";
import axios from "axios";
// 1. IMPORT FROM YOUR NEW FILE, NOT from auth-provider
import { getAuthToken } from "./tokenStore"; 
// 2. DO NOT import useAuth here

// Centralized Axios instance for all API requests
const apiBaseUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_URL)
  ? (import.meta as any).env.VITE_API_URL
  : 'http://localhost:5001';

export const axiosInstance = axios.create({
  baseURL: apiBaseUrl,
});

// Add token to all requests if present
axiosInstance.interceptors.request.use((config: any) => {
  // 3. Use the non-React token getter
  const token = getAuthToken(); 
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 422 && error.response?.data?.schemaStatus) {
      window.dispatchEvent(new CustomEvent('schema-error', { detail: error.response.data.schemaStatus }));
    }
    return Promise.reject(error);
  }
);

// Default query function for react-query using Axios
const axiosQueryFn = async <T>({ queryKey }: QueryFunctionContext): Promise<T> => {
  // queryKey is an array, join with / for REST endpoints
  // 4. FIX: Join query key parts directly to form the URL path
  const url = (queryKey as string[]).join('/');
  
  const response = await axiosInstance.get<T>(url);
  return response.data;
};


// Generic API request function using Axios
export async function apiRequest<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  data?: any,
  config: object = {}
): Promise<T> {
  // 5. FIX: Use the URL as provided, without stripping prefixes
  const response = await axiosInstance.request<T>({
    method,
    url: url, // <-- Use original URL
    data,
    ...config,
  });
  return response.data;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: axiosQueryFn,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
