import axios from 'axios';

// 后端地址 (HTTP)
// ⚠️ 注意：如果你的 Lark/Feishu 客户端强制 HTTPS，这个 HTTP 请求可能会被 Block (Mixed Content)
const API_BASE = 'https://www.inkflow.chat/api';

// 定义返回的数据结构
export interface XhsNoteData {
  title?: string;
  nickname?: string;
  desc?: string;
  liked_count?: number;
  time?: number; // timestamp
  note_url?: string;
  note_id?: string;
  [key: string]: any;
}

/**
 * 启动爬虫任务
 */
export async function startCrawler(url: string, cookie: string) {
  try {
    const payload = {
      platform: 'xhs',
      login_type: 'cookie',
      crawler_type: 'detail',
      save_option: 'json',
      specified_ids: url,
      cookies: cookie,
      enable_comments: false,
      // Docker/Linux 服务器一般没有图形界面（XServer），必须用无头模式
      headless: true
    };
    
    // 设置较短的 timeout 防止 UI 卡死，因为只是触发任务
    await axios.post(`${API_BASE}/crawler/start`, payload, { timeout: 10000 });
  } catch (error: any) {
    console.error('Start crawler failed:', error);
    // 有些时候后端虽然报错但任务其实已经接受了，这里严格抛出
    throw new Error(error.response?.data?.message || error.message || '启动爬虫失败');
  }
}

/**
 * 检查爬虫状态
 * @returns true if finished (idle), false if running
 */
export async function checkStatus(): Promise<boolean> {
  try {
    const res = await axios.get(`${API_BASE}/crawler/status`, { timeout: 5000 });
    const statusData = res.data;
    
    // 逻辑：如果状态是 idle 且没有正在进行的 active task platform，则认为空闲
    if (statusData.status === 'idle') {
      return true;
    }
    return false; 
  } catch (error) {
    console.warn('Check status failed, assuming finished or error:', error);
    return true; // 如果连不上状态接口，为防止死循环，暂时视为结束
  }
}

/**
 * 获取结果数据
 */
export async function getResult(targetUrl: string): Promise<XhsNoteData | null> {
  try {
    // 1. 获取文件列表
    const listRes = await axios.get(`${API_BASE}/data/files?platform=xhs&file_type=json`);
    const files = listRes.data.files || [];
    
    if (files.length === 0) return null;

    // 2. 找最新的 detail_contents 文件
    const targetFile = files
      .filter((f: any) => f.name.includes('detail_contents'))
      .sort((a: any, b: any) => b.modified_at - a.modified_at)[0];
    console.log(targetFile);

    if (!targetFile) return null;

    // 3. 读取内容 (preview=true)
    // FastAPI 路由是 `/api/data/files/{file_path:path}`：
    // 这里不能对整个 path 用 encodeURIComponent（会把 `/` 编码成 `%2F`，后端找不到文件）。
    // 用 encodeURI（保留 `/`）或逐段编码后再用 `/` 拼回去。
    const safePath = encodeURI(targetFile.path);
    const contentRes = await axios.get(`${API_BASE}/data/files/${safePath}`, {
      params: { preview: true, limit: 2000 },
    });
    const rawData = contentRes.data;
    console.log(rawData);

    // 兼容后端可能返回 { data: [...] } 或直接 [...]
    const dataList = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    if (!Array.isArray(dataList) || dataList.length === 0) return null;

    // 4. 在结果中根据 note_id 或 url 匹配当前行
    // 尝试从 targetUrl 中提取 ID，通常是 /explore/xxxx?
    const match = targetUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
    const noteId = match ? match[1] : '';

    let foundItem = null;
    
    if (noteId) {
        foundItem = dataList.find((item: any) => item.note_id === noteId || (item.note_url && item.note_url.includes(noteId)));
    }
    
    // 如果没找到特定 ID，但列表里只有一个结果，通常就是它 (单条抓取模式)
    if (!foundItem && dataList.length > 0) {
        // 取最新的一条
        foundItem = dataList[dataList.length - 1];
    }

    return foundItem || null;
  } catch (error) {
    console.error('Get result failed:', error);
    return null;
  }
}
