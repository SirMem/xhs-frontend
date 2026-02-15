import React, { useState, useEffect, useRef } from 'react';
import { 
  bitable, 
  FieldType, 
  type IFieldMeta
} from '@lark-base-open/js-sdk';
import { 
  Button, 
  Select, 
  Toast, 
  Form, 
  Banner, 
  TextArea, 
  Card, 
  Checkbox, 
  CheckboxGroup, 
  Typography, 
  Space, 
  Divider,
  Tag,
  Spin,
  Tabs,
  Input,
  DatePicker,
  Modal,
  Table
} from '@douyinfe/semi-ui';
import { IconGithubLogo, IconLink, IconSetting, IconPlay, IconRefresh } from '@douyinfe/semi-icons';
import {
  apiStartCrawler,
  apiCrawlerStatus,
  apiGetLatestDetailResultByUrl,
  apiCountNotesByTimeRange,
  apiLowFanViral,
  apiComplianceCheck,
  apiMonitorAddNote,
  apiMonitorList,
  apiMonitorCheckNow,
  apiMonitorResetBaseline,
  apiMonitorDeleteNote,
  apiMonitorUpdateNote,
  getDefaultApiBase,
} from './backend-api';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

// Configuration for available fields to sync
const AVAILABLE_FIELDS = [
  { key: 'title', name: '笔记标题', type: FieldType.Text },
  { key: 'nickname', name: '博主昵称', type: FieldType.Text },
  { key: 'desc', name: '笔记描述', type: FieldType.Text },
  { key: 'liked_count', name: '点赞数', type: FieldType.Number },
  { key: 'time', name: '发布时间', type: FieldType.DateTime },
];

export default function App() {
  // Fixed API base (do not expose to UI)
  const apiBase = getDefaultApiBase();

  const [urlFieldMetaList, setUrlFieldMetaList] = useState<{label: string, value: string}[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>();
  // Global cookie (persisted locally). This avoids re-pasting after closing the window.
  const COOKIE_STORAGE_KEY = 'xhs_global_cookie';
  const [cookie, setCookie] = useState<string>(() => {
    try {
      return window.localStorage.getItem(COOKIE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(['等待操作...']);
  
  // State for selected fields to write back (default all)
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<string[]>(
    AVAILABLE_FIELDS.map(f => f.key)
  );

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  // Persist cookie across sessions.
  useEffect(() => {
    try {
      window.localStorage.setItem(COOKIE_STORAGE_KEY, cookie || '');
    } catch {
      // ignore
    }
  }, [cookie]);

  useEffect(() => {
    const fn = async () => {
      const table = await bitable.base.getActiveTable();
      const textFields = await table.getFieldMetaListByType(FieldType.Text);
      const urlFields = await table.getFieldMetaListByType(FieldType.Url);
      
      const options = [
        ...textFields.map(f => ({ label: `📄 ${f.name}`, value: f.id })),
        ...urlFields.map(f => ({ label: `🔗 ${f.name}`, value: f.id }))
      ];
      setUrlFieldMetaList(options);
      
      if (options.length > 0) setSelectedFieldId(options[0].value);
    };
    fn();
  }, []);

  const handleCrawl = async () => {
    if (!selectedFieldId) {
      Toast.warning('请选择链接所在的列');
      return;
    }
    if (!cookie) {
      Toast.warning('请填写 Cookie');
      return;
    }

    setLoading(true);
    setLogs(['🚀 任务初始化...']);

    try {
      const table = await bitable.base.getActiveTable();
      const linkField = await table.getField(selectedFieldId);
      
      const selection = await bitable.base.getSelection();
      if (!selection.recordId) throw new Error('请先在表格里点击选中一行');
      const recordId = selection.recordId;

      // 1. Get URL
      addLog(`读取记录: ${recordId}`);
      const val = await linkField.getValue(recordId);
      let targetUrl = '';

      if (Array.isArray(val) && (val as any)[0]?.link) {
        targetUrl = (val as any)[0].link;
      } else if (Array.isArray(val) && (val as any)[0]?.text) {
        targetUrl = (val as any)[0].text;
      } else if (typeof val === 'string') {
        targetUrl = val;
      }

      if (!targetUrl || !targetUrl.includes('xiaohongshu')) {
        throw new Error('选中单元格不是有效的小红书链接');
      }

      addLog(`捕获链接: ${targetUrl.substring(0, 30)}...`);

      // 2. Start Crawler
      addLog('📡 发送爬虫请求...');
      await apiStartCrawler(apiBase, targetUrl, cookie);

      // 3. Polling Status
      addLog('⏳ 等待爬虫运行...');
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await apiCrawlerStatus(apiBase);
        if (status?.status === 'idle') {
            addLog('✅ 爬虫任务完成');
            break;
        }
        if (i % 5 === 0) addLog('...正在努力爬取中');
        if (i === 59) throw new Error('等待超时，请检查后端服务');
      }

      // 4. Fetch Result
      addLog('📦 获取数据结果...');
      const resultData = await apiGetLatestDetailResultByUrl(apiBase, targetUrl);
      if (!resultData) throw new Error('未能获取到有效数据，可能是反爬验证失败');

      addLog('💾 正在写入多维表格...');
      
      // Filter targets based on user selection
      const targetsToWrite = AVAILABLE_FIELDS.filter(f => selectedTargetKeys.includes(f.key));

      for (const target of targetsToWrite) {
        let field;
        try {
          field = await table.getFieldByName(target.name);
        } catch {
          addLog(`  + 创建新列: ${target.name}`);
          const fieldId = await table.addField({ 
            type: target.type as any, 
            name: target.name 
          });
          field = await table.getField(fieldId);
        }

        const rawVal = (resultData as any)[target.key];
        if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
          // Format data based on type
          if (target.type === FieldType.DateTime) {
             await field.setValue(recordId, Number(rawVal));
          } else if (target.type === FieldType.Number) {
             await field.setValue(recordId, Number(rawVal));
          } else {
             await field.setValue(recordId, String(rawVal));
          }
        }
      }

      Toast.success('抓取并写入成功！');
      addLog('🎉 全部完成');

    } catch (err: any) {
      console.error(err);
      addLog(`❌ 错误: ${err.message}`);
      if (err.message?.includes('Network Error')) {
        Toast.error('网络错误 (Mixed Content)');
      } else {
        Toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // -------------------------
  // Feature: count notes by time range
  // -------------------------
  const [countKeyword, setCountKeyword] = useState('');
  const [startTimeStr, setStartTimeStr] = useState('');
  const [endTimeStr, setEndTimeStr] = useState('');
  const [countLoading, setCountLoading] = useState(false);
  const [countResult, setCountResult] = useState<any | null>(null);
  const [countResultVisible, setCountResultVisible] = useState(false);

  const parseDateTimeToMs = (s: string): number => {
    const t = s.trim();
    if (!t) return 0;
    // accept ms input directly
    if (/^\d{12,}$/.test(t)) return Number(t);
    // accept "YYYY-MM-DD HH:mm:ss"
    const isoLike = t.includes('T') ? t : t.replace(' ', 'T');
    const d = new Date(isoLike);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const datePickerValueFromStr = (s: string): number | undefined => {
    const ms = parseDateTimeToMs(s);
    return ms ? ms : undefined;
  };

  const datePickerOnChangeToMsStr = (d?: Date | Date[] | string | string[] | number | number[]) => {
    if (!d) return '';
    const v: any = Array.isArray(d) ? d[0] : d;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return String(parseDateTimeToMs(v) || '');
    if (v instanceof Date) return String(v.getTime());
    return '';
  };

  const handleCountNotes = async () => {
    const keyword = countKeyword.trim();
    if (!keyword) {
      Toast.warning('请填写关键词');
      return;
    }
    const startMs = parseDateTimeToMs(startTimeStr);
    const endMs = parseDateTimeToMs(endTimeStr);
    if (!startMs || !endMs) {
      Toast.warning('请填写正确的时间（建议：2026-01-29T00:00:00 或 13位毫秒时间戳）');
      return;
    }
    if (endMs < startMs) {
      Toast.warning('end_time 必须 >= start_time');
      return;
    }

    setCountLoading(true);
    setCountResult(null);
    try {
      const res = await apiCountNotesByTimeRange(apiBase, {
        keyword,
        cookies: cookie.trim(),
        start_time_ms: startMs,
        end_time_ms: endMs,
        note_type: 'all',
        page_size: 20,
        max_pages: 10,
        sleep_ms_min: 600,
        sleep_ms_max: 1800,
        headless: true,
      });
      setCountResult(res);
      setCountResultVisible(true);
      Toast.success('统计完成');
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '统计失败');
    } finally {
      setCountLoading(false);
    }
  };

  const formatMsToLocal = (ms?: any): string => {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '-';
    try {
      return `${new Date(n).toLocaleString()} (${n})`;
    } catch {
      return String(ms);
    }
  };

  // -------------------------
  // Feature: low-fan viral
  // -------------------------
  const [lfKeyword, setLfKeyword] = useState('');
  const [lfLikeThr, setLfLikeThr] = useState('1000');
  const [lfFanThr, setLfFanThr] = useState('2000');
  const [lfSort, setLfSort] = useState('general');
  const [lfNoteType, setLfNoteType] = useState('all');
  const [lfPageSize, setLfPageSize] = useState('20');
  const [lfMaxResults, setLfMaxResults] = useState('60');
  const [lfConcurrency, setLfConcurrency] = useState('5');
  const [lfCacheTtl, setLfCacheTtl] = useState('86400');
  const [lfLoading, setLfLoading] = useState(false);
  const [lfResult, setLfResult] = useState<any | null>(null);
  const [lfResultVisible, setLfResultVisible] = useState(false);

  const handleLowFanViral = async () => {
    const keyword = lfKeyword.trim();
    if (!keyword) {
      Toast.warning('请填写关键词');
      return;
    }
    if (!cookie.trim()) {
      Toast.warning('建议填写 Cookie 提升成功率');
    }
    setLfLoading(true);
    setLfResult(null);
    try {
      const res = await apiLowFanViral(apiBase, {
        keyword,
        cookies: cookie.trim(),
        like_threshold: Number(lfLikeThr) || 0,
        fan_threshold: Number(lfFanThr) || 0,
        sort: lfSort as any,
        note_type: lfNoteType as any,
        page_size: Number(lfPageSize) || 20,
        max_results: Number(lfMaxResults) || 60,
        concurrency: Number(lfConcurrency) || 5,
        cache_ttl_seconds: Number(lfCacheTtl) || 0,
        headless: true,
      });
      setLfResult(res);
      setLfResultVisible(true);
      Toast.success('筛选完成');
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '筛选失败');
    } finally {
      setLfLoading(false);
    }
  };

  // -------------------------
  // Feature: compliance check
  // -------------------------
  const [compText, setCompText] = useState('');
  const [compNoteUrl, setCompNoteUrl] = useState('');
  const [compEnableAi, setCompEnableAi] = useState(false);
  const [compSeverity, setCompSeverity] = useState(3);
  const [compLoading, setCompLoading] = useState(false);
  const [compResult, setCompResult] = useState<any | null>(null);
  const [compModalVisible, setCompModalVisible] = useState(false);

  const aiBaseUrl = (import.meta.env.VITE_COMPLIANCE_AI_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const aiApiKey = (import.meta.env.VITE_COMPLIANCE_AI_API_KEY ?? '').trim();
  const aiModel = (import.meta.env.VITE_COMPLIANCE_AI_MODEL ?? '').trim();

  const handleComplianceCheck = async () => {
    setCompLoading(true);
    setCompResult(null);
    setCompModalVisible(false);
    try {
      const res = await apiComplianceCheck(apiBase, {
        text: compText,
        xhs_note_url: compNoteUrl.trim(),
        cookies: cookie.trim(),
        headless: true,
        severity_threshold: compSeverity,
        enable_ai: compEnableAi,
        // AI config is read from server .env:
        // COMPLIANCE_AI_BASE_URL / COMPLIANCE_AI_API_KEY / COMPLIANCE_AI_MODEL
        ai_base_url: aiBaseUrl || undefined,
        ai_api_key: aiApiKey || undefined,
        ai_model: aiModel || undefined,
        
      });
      setCompResult(res);
      Toast.success('检测完成');
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '检测失败');
    } finally {
      setCompLoading(false);
    }
  };

  // 打开结果弹窗：当 compResult 更新时自动弹出
  useEffect(() => {
    if (compResult) {
      setCompModalVisible(true);
    }
  }, [compResult]);

  // -------------------------
  // Feature: monitor management
  // -------------------------
  const [monNoteUrl, setMonNoteUrl] = useState('');
  const [monLikeThr, setMonLikeThr] = useState('100');
  const [monCommentThr, setMonCommentThr] = useState('20');
  const [monInterval, setMonInterval] = useState('120');
  const [monInitBaseline, setMonInitBaseline] = useState(true);
  const [monLoading, setMonLoading] = useState(false);
  const [monItems, setMonItems] = useState<any[]>([]);
  const [monListVisible, setMonListVisible] = useState(false);

  const refreshMonitorList = async () => {
    setMonLoading(true);
    try {
      const res = await apiMonitorList(apiBase);
      setMonItems(res?.items || []);
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '刷新失败');
    } finally {
      setMonLoading(false);
    }
  };

  const openMonitorList = async () => {
    setMonListVisible(true);
    // Lazy refresh when opening the dialog
    if (!monItems?.length) await refreshMonitorList();
  };

  const handleAddMonitor = async () => {
    if (!monNoteUrl.trim()) {
      Toast.warning('请填写笔记 URL（建议包含 xsec_token）');
      return;
    }
    setMonLoading(true);
    try {
      await apiMonitorAddNote(apiBase, {
        note_url: monNoteUrl.trim(),
        cookies: cookie.trim(),
        like_growth_threshold: Number(monLikeThr) || 0,
        comment_growth_threshold: Number(monCommentThr) || 0,
        check_interval_minutes: Number(monInterval) || 120,
        is_active: true,
        headless: true,
        initialize_baseline: monInitBaseline,
      });
      Toast.success('已添加监控');
      setMonNoteUrl('');
      await refreshMonitorList();
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '添加失败');
    } finally {
      setMonLoading(false);
    }
  };

  const handleRowAction = async (action: string, row: any) => {
    try {
      if (action === 'check') {
        const res = await apiMonitorCheckNow(apiBase, row.note_id, cookie.trim() || row.cookies || '', true);
        Toast.success(`检查完成：点赞+${res.delta_likes} 评论+${res.delta_comments}`);
      } else if (action === 'reset') {
        await apiMonitorResetBaseline(apiBase, row.note_id, cookie.trim() || row.cookies || '', true);
        Toast.success('baseline 已重置');
        await refreshMonitorList();
      } else if (action === 'delete') {
        await apiMonitorDeleteNote(apiBase, row.note_id);
        Toast.success('已删除');
        await refreshMonitorList();
      } else if (action === 'toggle') {
        await apiMonitorUpdateNote(apiBase, { note_id: row.note_id, is_active: !row.is_active });
        Toast.success('已更新状态');
        await refreshMonitorList();
      }
    } catch (e: any) {
      Toast.error(e?.response?.data?.detail || e?.message || '操作失败');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
            <Title heading={3} style={{ margin: 0 }}>小红书数据采集器</Title>
            <Text type="secondary">一键提取笔记详情并回填至多维表格</Text>
        </div>
        <Tag color="red" size="large">XHS Crawler</Tag>
      </div>

        <Card>
          <Form labelPosition="top">
            <Form.Label required>Cookies</Form.Label>
            <TextArea
              value={cookie}
              onChange={(val) => setCookie(val)}
              placeholder="在此粘贴小红书网页版 Cookie..."
              rows={2}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />

            <div style={{ height: 16 }} />

            

          </Form>
        </Card>

      <Tabs type="line">
        <TabPane tab="详情抓取回填" itemKey="crawl">
          <Space vertical spacing="medium" style={{ width: '100%' }}>
            <Card
            >
              <Form labelPosition="top">
                <Form.Label required>链接所在列</Form.Label>
                <Select
                  style={{ width: '100%' }}
                  optionList={urlFieldMetaList}
                  value={selectedFieldId}
                  onChange={(v) => setSelectedFieldId(v as string)}
                  placeholder="选择包含笔记链接的列"
                />
              </Form>
            </Card>

            <Card
              title={<Space><IconLink /><span>字段映射</span></Space>}
              headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
              bodyStyle={{ padding: '20px' }}
            >
              <div style={{ marginBottom: 12 }}><Text type="tertiary">选择需要抓取并回填的数据字段：</Text></div>
              <CheckboxGroup
                value={selectedTargetKeys}
                onChange={(val) => setSelectedTargetKeys(val as string[])}
                direction="horizontal"
                aria-label="选择字段"
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {AVAILABLE_FIELDS.map(f => (
                    <Checkbox key={f.key} value={f.key}>
                      {f.name} <Text type="quaternary" size="small">({f.type === FieldType.Number ? '数字' : f.type === FieldType.DateTime ? '日期' : '文本'})</Text>
                    </Checkbox>
                  ))}
                </div>
              </CheckboxGroup>
            </Card>

            <Button
              type="primary"
              theme="solid"
              size="large"
              block
              icon={loading ? <Spin /> : <IconPlay />}
              onClick={handleCrawl}
              disabled={loading}
              style={{ height: '50px', fontSize: '16px', fontWeight: 600, background: 'linear-gradient(90deg, #ff2442 0%, #ff6b6b 100%)', border: 'none' }}
            >
              {loading ? '正在抓取中...' : '开始抓取选中行'}
            </Button>

            <div style={{
              background: '#1f2937',
              borderRadius: '8px',
              padding: '16px',
              height: '180px',
              overflowY: 'auto',
              fontFamily: 'Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              color: '#e5e7eb',
              border: '1px solid #374151'
            }} ref={logContainerRef}>
              <div style={{ marginBottom: 8, color: '#9ca3af', borderBottom: '1px solid #374151', paddingBottom: 4 }}>
                Console Output
              </div>
              {logs.map((log, idx) => (
                <div key={idx} style={{ marginBottom: 4, lineHeight: '1.4' }}>
                  <span style={{ color: '#6b7280', marginRight: 8 }}>&gt;</span>
                  {log}
                </div>
              ))}
              {loading && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#10b981' }}>_</span>
                </div>
              )}
            </div>
          </Space>
        </TabPane>

        <TabPane tab="时间段统计" itemKey="count">
          <Space vertical spacing="medium" style={{ width: '100%' }}>
            <Card title="关键词时间段内笔记数量（近似）" bodyStyle={{ padding: 20 }}>
              <Form labelPosition="top">
                <Form.Label required>关键词</Form.Label>
                <Input value={countKeyword} onChange={(v) => setCountKeyword(String(v))} placeholder="例如：考研" />

                <div style={{ height: 12 }} />
                <Form.Label required>开始时间</Form.Label>
                <DatePicker
                  type="dateTime"
                  format="yyyy-MM-dd HH:mm:ss"
                  value={datePickerValueFromStr(startTimeStr)}
                  onChange={(d) => setStartTimeStr(datePickerOnChangeToMsStr(d as any))}
                  triggerRender={() => (
                    <Input
                      value={startTimeStr}
                      onChange={(v) => setStartTimeStr(String(v))}
                      placeholder="点击选择（选择后自动变成13位毫秒时间戳）"
                    />
                  )}
                />
               
                <div style={{ height: 12 }} />
                <Form.Label required>结束时间</Form.Label>
                <DatePicker
                  type="dateTime"
                  format="yyyy-MM-dd HH:mm:ss"
                  value={datePickerValueFromStr(endTimeStr)}
                  onChange={(d) => setEndTimeStr(datePickerOnChangeToMsStr(d as any))}
                  triggerRender={() => (
                    <Input
                      value={endTimeStr}
                      onChange={(v) => setEndTimeStr(String(v))}
                      placeholder="点击选择（选择后自动变成13位毫秒时间戳）"
                    />
                  )}
                />
                

                <div style={{ height: 16 }} />
                <Button type="primary" loading={countLoading} onClick={handleCountNotes}>
                  {countLoading ? '统计中...' : '开始统计'}
                </Button>
              </Form>
            </Card>

            <Modal
              title="统计结果（已成功返回）"
              visible={Boolean(countResult) && countResultVisible}
              onCancel={() => setCountResultVisible(false)}
              footer={(
                <Button type="primary" onClick={() => setCountResultVisible(false)}>
                  知道了
                </Button>
              )}
              style={{ width: 620, maxWidth: '96vw' }}
            >
              {countResult ? (
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><Text strong>关键词：</Text>{String(countResult.keyword ?? '-')}</div>
                  <div><Text strong>笔记数量（近似）：</Text>{String(countResult.count ?? '-')}</div>
                  <div><Text strong>扫描页数：</Text>{String(countResult.pages_scanned ?? '-')}</div>
                  <div><Text strong>本次扫描中最早的发布时间：</Text>{formatMsToLocal(countResult.oldest_time_seen_ms)}</div>
                  <div><Text strong>是否截断（达到扫描上限）：</Text>{(countResult.truncated === true) ? '是' : '否'}</div>
                  <div><Text strong>未知发布时间数量：</Text>{String(countResult.unknown_time_count ?? '-')}</div>

                  <Divider margin="12px" />
                  <Text type="tertiary" size="small">原始返回（JSON）：</Text>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }}>{JSON.stringify(countResult, null, 2)}</pre>
                </div>
              ) : (
                <Text type="tertiary">暂无结果</Text>
              )}
            </Modal>
          </Space>
        </TabPane>

        <TabPane tab="低粉爆款" itemKey="low_fan_viral">
          <Space vertical spacing="medium" style={{ width: '100%' }}>
            <Card title="低粉爆款检测（服务端两层过滤）" bodyStyle={{ padding: 20 }}>
              <Form labelPosition="top">
                <Form.Label required>关键词</Form.Label>
                <Input value={lfKeyword} onChange={(v) => setLfKeyword(String(v))} placeholder="例如：考研" />

                <div style={{ height: 12 }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Form.Label>点赞阈值（爆款）</Form.Label>
                    <Input value={lfLikeThr} onChange={(v) => setLfLikeThr(String(v))} placeholder="默认 1000" />
                  </div>
                  <div>
                    <Form.Label>粉丝阈值（低粉）</Form.Label>
                    <Input value={lfFanThr} onChange={(v) => setLfFanThr(String(v))} placeholder="默认 2000" />
                  </div>
                  <div>
                    <Form.Label>排序</Form.Label>
                    <Select
                      value={lfSort}
                      onChange={(v) => setLfSort(String(v))}
                      optionList={[
                        { label: 'general（综合）', value: 'general' },
                        { label: 'popularity（最热）', value: 'popularity' },
                        { label: 'most_popular（最热视频）', value: 'most_popular' },
                        { label: 'latest（最新）', value: 'latest' },
                        { label: 'popularity_descending（热度降序）', value: 'popularity_descending' },
                        { label: 'time_descending（时间降序）', value: 'time_descending' },
                      ]}
                    />
                  </div>
                  <div>
                    <Form.Label>笔记类型</Form.Label>
                    <Select
                      value={lfNoteType}
                      onChange={(v) => setLfNoteType(String(v))}
                      optionList={[
                        { label: 'all（全部）', value: 'all' },
                        { label: 'video（视频）', value: 'video' },
                        { label: 'image（图文）', value: 'image' },
                      ]}
                    />
                  </div>
                  <div>
                    <Form.Label>每页数量</Form.Label>
                    <Input value={lfPageSize} onChange={(v) => setLfPageSize(String(v))} placeholder="默认 20" />
                  </div>
                  <div>
                    <Form.Label>最多扫描条数</Form.Label>
                    <Input value={lfMaxResults} onChange={(v) => setLfMaxResults(String(v))} placeholder="默认 60" />
                  </div>
                  <div>
                    <Form.Label>并发数</Form.Label>
                    <Input value={lfConcurrency} onChange={(v) => setLfConcurrency(String(v))} placeholder="默认 5" />
                  </div>
                  <div>
                    <Form.Label>粉丝缓存 TTL（秒）</Form.Label>
                    <Input value={lfCacheTtl} onChange={(v) => setLfCacheTtl(String(v))} placeholder="默认 86400" />
                  </div>
                </div>

                <div style={{ height: 16 }} />
                <Button type="primary" loading={lfLoading} onClick={handleLowFanViral}>
                  {lfLoading ? '筛选中...' : '开始筛选'}
                </Button>
              </Form>
            </Card>

            <Modal
              title="筛选结果"
              visible={Boolean(lfResult) && lfResultVisible}
              onCancel={() => setLfResultVisible(false)}
              footer={(
                <Button type="primary" onClick={() => setLfResultVisible(false)}>
                  知道了
                </Button>
              )}
              style={{ width: 980, maxWidth: '96vw' }}
            >
              {lfResult ? (
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><Text strong>关键词：</Text>{String(lfResult.keyword ?? '-')}</div>
                  <div><Text strong>扫描笔记数：</Text>{String(lfResult.scanned_notes ?? '-')}</div>
                  <div><Text strong>爆款候选：</Text>{String(lfResult.viral_candidates ?? '-')}</div>
                  <div><Text strong>查询作者数：</Text>{String(lfResult.creators_queried ?? '-')}</div>
                  <div><Text strong>最终结果：</Text>{String((lfResult.results || []).length)}</div>

                  <Divider margin="12px" />
                  <Table
                    dataSource={lfResult.results || []}
                    pagination={{ pageSize: 20 }}
                    rowKey="note_id"
                    columns={[
                      { title: 'note_id', dataIndex: 'note_id', width: 160 },
                      { title: '标题', dataIndex: 'title', width: 200, render: (t: any) => <Text ellipsis={{ showTooltip: true }}>{String(t || '')}</Text> },
                      { title: '点赞', dataIndex: 'liked_count', width: 90 },
                      { title: '粉丝', dataIndex: 'fans', width: 90 },
                      { title: '作者', dataIndex: 'nickname', width: 120, render: (t: any) => <Text ellipsis={{ showTooltip: true }}>{String(t || '')}</Text> },
                      {
                        title: '链接',
                        dataIndex: 'note_url',
                        width: 240,
                        render: (t: any) => (
                          <Text ellipsis={{ showTooltip: true }}>{String(t || '')}</Text>
                        ),
                      },
                    ]}
                  />

                  <Divider margin="12px" />
                  <Text type="tertiary" size="small">原始返回（JSON）：</Text>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }}>
                    {JSON.stringify(lfResult, null, 2)}
                  </pre>
                </div>
              ) : (
                <Text type="tertiary">暂无结果</Text>
              )}
            </Modal>
          </Space>
        </TabPane>

        <TabPane tab="违禁词检测" itemKey="compliance">
          <Space vertical spacing="medium" style={{ width: '100%' }}>
            <Card title="违禁词检测" bodyStyle={{ padding: 20 }}>
              <Form labelPosition="top">
                <Form.Label>小红书笔记 URL（可选）</Form.Label>
                <Input value={compNoteUrl} onChange={(v) => setCompNoteUrl(String(v))} placeholder="https://www.xiaohongshu.com/explore/xxx?xsec_token=..." />

                <div style={{ height: 12 }} />
                <Form.Label>待检测文本</Form.Label>
                <TextArea value={compText} onChange={(v) => setCompText(String(v))} rows={4} placeholder="把你创作的笔记文案粘贴到这里..." />

                <div style={{ height: 12 }} />
                <Form.Label>严重度阈值（≥ 判定不通过）</Form.Label>
                <Input value={String(compSeverity)} onChange={(v) => setCompSeverity(Number(v) || 1)} placeholder="例如：3" />

                <div style={{ height: 12 }} />
                <Checkbox checked={compEnableAi} onChange={(e) => setCompEnableAi(Boolean((e as any).target?.checked))}>
                  启用 AI 审核（静态通过后才会调用；AI 配置从服务端 .env 读取）
                </Checkbox>

                {compEnableAi && (
                  <Text type="tertiary" style={{ display: 'block', marginTop: 8 }}>
                    请在服务端 `.env` 中配置：COMPLIANCE_AI_BASE_URL / COMPLIANCE_AI_API_KEY / COMPLIANCE_AI_MODEL
                  </Text>
                )}

                <div style={{ height: 16 }} />
                <Button type="primary" loading={compLoading} onClick={handleComplianceCheck}>
                  {compLoading ? '检测中...' : '开始检测'}
                </Button>
              </Form>
            </Card>

            {compResult && (
              <Card title="检测结果" bodyStyle={{ padding: 20 }}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color={compResult?.final?.passed ? 'green' : 'red'}>
                    {compResult?.final?.passed ? '通过' : '不通过'}
                  </Tag>
                  <Text type="tertiary" style={{ marginLeft: 8 }}>
                    risk_level={compResult?.final?.risk_level ?? '-'} categories={(compResult?.final?.categories || []).join(', ') || '-'}
                  </Text>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(compResult, null, 2)}</pre>
              </Card>
            )}

            <Modal
              title="AI 审核结果"
              visible={compModalVisible}
              onOk={() => setCompModalVisible(false)}
              onCancel={() => setCompModalVisible(false)}
              centered
              okText="关闭"
              cancelButtonProps={{ style: { display: 'none' } }}
              width={720}
            >
              {compResult ? (
                <div style={{ display: 'grid', rowGap: 12 }}>
                  <div>
                    <Text strong>原始文本：</Text>
                    <Text>{compResult.text || '-'}</Text>
                  </div>
                  <div>
                    <Text strong>AI 状态：</Text>
                    <Tag color={compResult.ai?.status === 'success' ? 'green' : 'red'}>
                      {compResult.ai?.status || '-'}
                    </Tag>
                    <Text style={{ marginLeft: 8 }}>{compResult.ai?.reason || '-'}</Text>
                  </div>
                  <div>
                    <Text strong>风险类别：</Text>
                    <Text>{(compResult.ai?.risk_categories || []).join('，') || '无'}</Text>
                  </div>
                  <div>
                    <Text strong>证据：</Text>
                    <Text>{(compResult.ai?.evidence || []).join('，') || '无'}</Text>
                  </div>
                  <div>
                    <Text strong>改写建议：</Text>
                    <Text>{compResult.ai?.rewrite || '无'}</Text>
                  </div>
                  <div>
                    <Text strong>改进建议：</Text>
                    <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      {(compResult.ai?.suggestions || []).map((s: string, idx: number) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                    {(!compResult.ai?.suggestions || compResult.ai?.suggestions.length === 0) && <Text>无</Text>}
                  </div>
                  <Divider margin="8px" />
                  <div>
                    <Text strong>最终判定：</Text>
                    <Tag color={compResult.final?.passed ? 'green' : 'red'}>
                      {compResult.final?.passed ? '通过' : '不通过'}
                    </Tag>
                    <Text style={{ marginLeft: 8 }}>
                      risk_level={compResult.final?.risk_level ?? '-'} categories={(compResult.final?.categories || []).join(', ') || '-'}
                    </Text>
                  </div>
                  <Divider margin="8px" />
                  <Text type="tertiary" size="small">原始返回（JSON）：</Text>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>
                    {JSON.stringify(compResult, null, 2)}
                  </pre>
                </div>
              ) : (
                <Text type="tertiary">暂无结果</Text>
              )}
            </Modal>
          </Space>
        </TabPane>

        <TabPane tab="实时监控" itemKey="monitor">
          <Space vertical spacing="medium" style={{ width: '100%' }}>
            <Banner
              type="info"
              description="提示：监控告警由 monitor_worker.py 独立进程执行；前端负责添加/管理监控项。"
            />

            <Card title="添加监控项" bodyStyle={{ padding: 20 }}>
              <Form labelPosition="top">
                <Form.Label required>笔记 URL（建议包含 xsec_token）</Form.Label>
                <Input value={monNoteUrl} onChange={(v) => setMonNoteUrl(String(v))} placeholder="https://www.xiaohongshu.com/explore/xxx?xsec_token=..." />

                <div style={{ height: 12 }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Form.Label>点赞增量阈值</Form.Label>
                    <Input value={monLikeThr} onChange={(v) => setMonLikeThr(String(v))} />
                  </div>
                  <div>
                    <Form.Label>评论增量阈值</Form.Label>
                    <Input value={monCommentThr} onChange={(v) => setMonCommentThr(String(v))} />
                  </div>
                  <div>
                    <Form.Label>检查间隔（分钟）</Form.Label>
                    <Input value={monInterval} onChange={(v) => setMonInterval(String(v))} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <Checkbox checked={monInitBaseline} onChange={(e) => setMonInitBaseline(Boolean((e as any).target?.checked))}>
                      初始化 baseline（避免首次误报）
                    </Checkbox>
                  </div>
                </div>

                <div style={{ height: 16 }} />
                <Space>
                  <Button type="primary" loading={monLoading} onClick={handleAddMonitor}>添加</Button>
                  <Button icon={<IconRefresh />} onClick={refreshMonitorList} loading={monLoading}>刷新列表</Button>
                  <Button theme="solid" onClick={openMonitorList}>查看监控列表</Button>
                </Space>
              </Form>
            </Card>

            <Modal
              title="监控列表"
              visible={monListVisible}
              onCancel={() => setMonListVisible(false)}
              footer={null}
              style={{ width: 980, maxWidth: '96vw' }}
              bodyStyle={{ padding: 0 }}
            >
              <Table
                dataSource={monItems}
                pagination={false}
                rowKey="note_id"
                columns={[
                  { title: 'note_id', dataIndex: 'note_id', width: 220 },
                  { title: '标题', dataIndex: 'note_title', width: 200, render: (t: any) => <Text ellipsis={{ showTooltip: true }}>{String(t || '')}</Text> },
                  { title: '作者', dataIndex: 'author_name', width: 120, render: (t: any) => <Text ellipsis={{ showTooltip: true }}>{String(t || '')}</Text> },
                  { title: 'active', dataIndex: 'is_active', width: 70, render: (v: any) => <Tag color={v ? 'green' : 'grey'}>{v ? 'ON' : 'OFF'}</Tag> },
                  { title: 'last_likes', dataIndex: 'last_likes', width: 90 },
                  { title: 'last_comments', dataIndex: 'last_comments', width: 110 },
                  { title: 'next_check', dataIndex: 'next_check_time', width: 180, render: (t: any) => <Text size="small">{t ? String(t) : '-'}</Text> },
                  {
                    title: '操作',
                    dataIndex: 'op',
                    width: 260,
                    render: (_: any, row: any) => (
                      <Space>
                        <Button size="small" onClick={() => handleRowAction('check', row)}>检查</Button>
                        <Button size="small" onClick={() => handleRowAction('reset', row)}>重置baseline</Button>
                        <Button size="small" onClick={() => handleRowAction('toggle', row)}>{row.is_active ? '暂停' : '启用'}</Button>
                        <Button size="small" type="danger" onClick={() => handleRowAction('delete', row)}>删除</Button>
                      </Space>
                    ),
                  },
                ]}
              />
              <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <Text type="tertiary" size="small">列表仅展示最近 200 条（服务端限制）。</Text>
                <Button size="small" icon={<IconRefresh />} onClick={refreshMonitorList} loading={monLoading}>刷新</Button>
              </div>
            </Modal>
          </Space>
        </TabPane>
      </Tabs>
    </div>
  );
}
