import axios from 'axios';

import { applyExtractorResponseInterceptor } from '@/libs/http-client/interceptors/extractor-response.interceptor';

// ----------------------------------------------------------------------

// baseURL contract: in production the frontend nginx reverse-proxies /api/*
// (and bare-prefix backend endpoints) to the backend service same-origin,
// so axios MUST issue relative URLs. Allowing VITE__APP_API_BASE_URL to
// override here is what caused the v19 regression where rebuilds with
// .env baked an absolute backend URL into the bundle and bypassed the
// proxy entirely. Default to '' (relative) and only honor the env var
// if it's an explicit non-empty string set at build time.
const envBase = import.meta.env.VITE__APP_API_BASE_URL;
export const httpClient = axios.create({
  baseURL: typeof envBase === 'string' && envBase.length > 0 ? envBase : '',
  timeout: 30 * 1000,
  withCredentials: false
});

// ----------------------------------------------------------------------

applyExtractorResponseInterceptor(httpClient);
