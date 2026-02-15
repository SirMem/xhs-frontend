import axios from 'axios';
import type { AxiosInstance } from 'axios';

export type ApiBase = string; // should include `/api`, e.g. http://127.0.0.1:8080/api

export function getDefaultApiBase(): ApiBase {
  // Fixed base for this frontend build.
  // If you need to override in development, use VITE_API_BASE at build time.
  const env = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;
  return (env || 'https://www.inkflow.chat/api').replace(/\/+$/, '');
}

export function setDefaultApiBase(base: string) {
  // no-op: api base is fixed in production build
  void base;
}

function client(apiBase: ApiBase, timeoutMs = 30000): AxiosInstance {
  return axios.create({
    baseURL: apiBase.replace(/\/+$/, ''),
    timeout: timeoutMs,
  });
}

// -------------------------
// Crawler
// -------------------------

export async function apiStartCrawler(apiBase: ApiBase, url: string, cookies: string) {
  const payload = {
    platform: 'xhs',
    login_type: 'cookie',
    crawler_type: 'detail',
    save_option: 'json',
    specified_ids: url,
    cookies,
    enable_comments: false,
    headless: true,
  };
  await client(apiBase, 10000).post('/crawler/start', payload);
}

export async function apiCrawlerStatus(apiBase: ApiBase): Promise<{ status: string }> {
  const res = await client(apiBase, 10000).get('/crawler/status');
  return res.data;
}

export async function apiGetLatestDetailResultByUrl(apiBase: ApiBase, targetUrl: string): Promise<any | null> {
  // 1) list files
  const listRes = await client(apiBase, 30000).get('/data/files', { params: { platform: 'xhs', file_type: 'json' } });
  const files = listRes.data?.files || [];
  if (!Array.isArray(files) || files.length === 0) return null;

  // 2) pick latest detail_contents
  const targetFile = files
    .filter((f: any) => typeof f?.name === 'string' && f.name.includes('detail_contents'))
    .sort((a: any, b: any) => (b.modified_at || 0) - (a.modified_at || 0))[0];
  if (!targetFile?.path) return null;

  // 3) read preview; keep `/` in path
  const safePath = encodeURI(String(targetFile.path));
  const contentRes = await client(apiBase, 30000).get(`/data/files/${safePath}`, { params: { preview: true, limit: 2000 } });
  const rawData = contentRes.data;
  const dataList = Array.isArray(rawData) ? rawData : (rawData?.data || []);
  if (!Array.isArray(dataList) || dataList.length === 0) return null;

  // 4) match note_id from url
  const match = targetUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
  const noteId = match ? match[1] : '';
  if (noteId) {
    const found = dataList.find((item: any) => item?.note_id === noteId || (item?.note_url && String(item.note_url).includes(noteId)));
    if (found) return found;
  }
  return dataList[dataList.length - 1] || null;
}

// -------------------------
// XHS extensions
// -------------------------

export interface CountNotesByTimeRangeReq {
  keyword: string;
  cookies?: string;
  start_time_ms: number;
  end_time_ms: number;
  note_type?: 'all' | 'video' | 'image' | 0 | 1 | 2;
  page_size?: number;
  max_pages?: number;
  sleep_ms_min?: number;
  sleep_ms_max?: number;
  headless?: boolean;
}

export async function apiCountNotesByTimeRange(apiBase: ApiBase, req: CountNotesByTimeRangeReq) {
  const res = await client(apiBase, 60000).post('/xhs/count_notes_by_time_range', req);
  return res.data;
}

export interface LowFanViralReq {
  keyword: string;
  cookies?: string;
  like_threshold?: number;
  fan_threshold?: number;
  sort?: 'general' | 'popularity' | 'most_popular' | 'latest' | 'popularity_descending' | 'time_descending';
  note_type?: 'all' | 'video' | 'image' | 0 | 1 | 2;
  page_size?: number;
  max_results?: number;
  concurrency?: number;
  cache_ttl_seconds?: number;
  headless?: boolean;
}

export async function apiLowFanViral(apiBase: ApiBase, req: LowFanViralReq) {
  const res = await client(apiBase, 120000).post('/xhs/low_fan_viral', req);
  return res.data;
}

// -------------------------
// Compliance
// -------------------------

export interface ComplianceCheckReq {
  text?: string;
  xhs_note_url?: string;
  cookies?: string;
  headless?: boolean;
  severity_threshold?: number;
  enable_ai?: boolean;
  ai_base_url?: string;
  ai_api_key?: string;
  ai_model?: string;
  ai_timeout_seconds?: number;
  ai_temperature?: number;
  ai_max_tokens?: number;
}

export async function apiComplianceCheck(apiBase: ApiBase, req: ComplianceCheckReq) {
  const res = await client(apiBase, 60000).post('/compliance/check', req);
  return res.data;
}

// -------------------------
// Monitor
// -------------------------

export interface MonitorAddNoteReq {
  note_url?: string;
  note_id?: string;
  xsec_token?: string;
  xsec_source?: string;
  like_growth_threshold?: number;
  comment_growth_threshold?: number;
  check_interval_minutes?: number;
  is_active?: boolean;
  cookies?: string;
  headless?: boolean;
  initialize_baseline?: boolean;
}

export async function apiMonitorAddNote(apiBase: ApiBase, req: MonitorAddNoteReq) {
  const res = await client(apiBase, 60000).post('/monitor/add_note', req);
  return res.data;
}

export async function apiMonitorList(apiBase: ApiBase) {
  const res = await client(apiBase, 30000).get('/monitor/list');
  return res.data;
}

export async function apiMonitorCheckNow(apiBase: ApiBase, note_id: string, cookies = '', headless = true) {
  const res = await client(apiBase, 60000).post('/monitor/check_now', { note_id, cookies, headless });
  return res.data;
}

export async function apiMonitorResetBaseline(apiBase: ApiBase, note_id: string, cookies = '', headless = true) {
  const res = await client(apiBase, 60000).post('/monitor/reset_baseline', { note_id, cookies, headless });
  return res.data;
}

export async function apiMonitorDeleteNote(apiBase: ApiBase, note_id: string) {
  const res = await client(apiBase, 30000).post('/monitor/delete_note', { note_id });
  return res.data;
}

export async function apiMonitorUpdateNote(apiBase: ApiBase, payload: any) {
  const res = await client(apiBase, 30000).post('/monitor/update_note', payload);
  return res.data;
}
