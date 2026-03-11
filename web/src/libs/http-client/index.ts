import axios from 'axios';

import { applyExtractorResponseInterceptor } from '@/libs/http-client/interceptors/extractor-response.interceptor';

// ----------------------------------------------------------------------

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE__APP_API_BASE_URL,
  timeout: 30 * 1000,
  withCredentials: false
});

// ----------------------------------------------------------------------

applyExtractorResponseInterceptor(httpClient);
