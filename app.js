(() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const DEFAULT_API = 'https://land-api-r900.onrender.com';
  const els = {
    apiBase: document.getElementById('apiBase'),
    saveApi: document.getElementById('saveApi'),
    pdfInput: document.getElementById('pdfInput'),
    pickFile: document.getElementById('pickFile'),
    fileInfo: document.getElementById('fileInfo'),
    recognize: document.getElementById('recognize'),
    clear: document.getElementById('clear'),
    statusCard: document.getElementById('statusCard'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    statusDetail: document.getElementById('statusDetail'),
    resultCard: document.getElementById('resultCard'),
    resultSummary: document.getElementById('resultSummary'),
    resultBody: document.getElementById('resultBody'),
    result: document.getElementById('result'),
    warningBox: document.getElementById('warningBox'),
    copyResult: document.getElementById('copyResult'),
    downloadCsv: document.getElementById('downloadCsv'),
  };

  let selectedFile = null;
  let lastData = null;
  const savedApi = localStorage.getItem('landApiBase') || DEFAULT_API;
  els.apiBase.value = savedApi;

  function normalizeBase(value) {
    return value.trim().replace(/\/+$/, '');
  }

  function setStatus(kind, title, detail = '') {
    els.statusCard.classList.remove('hidden');
    els.statusDot.className = `status-dot ${kind || ''}`.trim();
    els.statusText.textContent = title;
    els.statusDetail.textContent = detail;
  }

  function resetResult() {
    lastData = null;
    els.resultCard.classList.add('hidden');
    els.result.textContent = '';
    els.resultSummary.textContent = '';
    els.resultBody.innerHTML = '';
    els.warningBox.classList.add('hidden');
    els.warningBox.innerHTML = '';
  }

  function resetFile() {
    selectedFile = null;
    els.pdfInput.value = '';
    els.fileInfo.classList.add('hidden');
    els.fileInfo.textContent = '';
    els.recognize.disabled = true;
    els.clear.disabled = true;
    els.statusCard.classList.add('hidden');
    resetResult();
  }

  function acceptFile(file) {
    if (!file) return;
    resetResult();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      resetFile();
      setStatus('error', '檔案格式不符', '請選擇 PDF 檔案。');
      return;
    }
    if (file.size > MAX_BYTES) {
      resetFile();
      setStatus('error', '檔案過大', '測試版僅接受 20MB 以內的 PDF。');
      return;
    }
    selectedFile = file;
    els.fileInfo.textContent = `${file.name}｜${(file.size / 1024 / 1024).toFixed(2)} MB`;
    els.fileInfo.classList.remove('hidden');
    els.recognize.disabled = false;
    els.clear.disabled = false;
    setStatus('', '檔案已選取', '按「開始辨識」後才會上傳到私有後端。');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function displayValue(value) {
    if (Array.isArray(value)) return value.join('、');
    if (value === 0) return '0';
    return value || '—';
  }

  function renderTable(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    els.resultBody.innerHTML = '';

    rows.forEach((row, index) => {
      const risk = Array.isArray(row.risk_alerts) ? row.risk_alerts.join('、') : (row.risk_alerts || '');
      const values = [
        index + 1,
        row.type,
        row.owner_name,
        row.owner_id,
        row.location,
        row.main_no,
        row.address,
        row.owner_share,
        row.total_ping || '',
        row.registration_date,
        row.registration_reason,
        row.settings,
        risk,
        row.query_time,
        row.source_file,
      ];
      const tr = document.createElement('tr');
      tr.innerHTML = values.map((value, colIndex) => {
        const cls = colIndex === 12 && risk ? 'risk-cell' : '';
        return `<td class="${cls}">${escapeHtml(displayValue(value)).replaceAll('\n', '<br>')}</td>`;
      }).join('');
      els.resultBody.appendChild(tr);
    });

    if (!rows.length) {
      els.resultBody.innerHTML = '<tr><td colspan="15" class="empty-cell">未產生可顯示的表格列。</td></tr>';
    }

    const warningList = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
    if (warningList.length) {
      els.warningBox.innerHTML = `<strong>目前限制</strong><ul>${warningList.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
      els.warningBox.classList.remove('hidden');
    } else {
      els.warningBox.classList.add('hidden');
    }

    const parser = data.parser_version ? `解析器 ${data.parser_version}` : '';
    const pages = data.page_count ? `${data.page_count} 頁` : '';
    els.resultSummary.textContent = [`共 ${rows.length} 筆`, pages, parser].filter(Boolean).join('｜');
  }

  function csvEscape(value) {
    const text = Array.isArray(value) ? value.join('、') : String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadCsv() {
    if (!lastData || !Array.isArray(lastData.rows)) return;
    const columns = [
      ['type', '類型'], ['owner_name', '所有權人'], ['owner_id', '所有權人證號'],
      ['location', '縣市區/地段'], ['main_no', '主建號/地號'], ['address', '建物門牌/地上建號'],
      ['owner_share', '持分'], ['total_m2', '合計m²'], ['total_ping', '合計坪數'],
      ['registration_date', '登記日期'], ['registration_reason', '登記原因'], ['settings', '設定情形'],
      ['risk_alerts', '風險提醒'], ['query_time', '謄本日期'], ['source_file', '來源檔案']
    ];
    const lines = [columns.map(([, label]) => csvEscape(label)).join(',')];
    lastData.rows.forEach(row => lines.push(columns.map(([key]) => csvEscape(row[key])).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFile?.name?.replace(/\.pdf$/i, '') || 'land-registry'}-辨識結果.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  els.saveApi.addEventListener('click', () => {
    const base = normalizeBase(els.apiBase.value) || DEFAULT_API;
    els.apiBase.value = base;
    localStorage.setItem('landApiBase', base);
    setStatus('ok', 'API 網址已儲存', base);
  });

  els.pickFile.addEventListener('click', () => els.pdfInput.click());
  els.pdfInput.addEventListener('change', event => acceptFile(event.target.files?.[0]));
  els.clear.addEventListener('click', resetFile);
  els.downloadCsv.addEventListener('click', downloadCsv);

  ['dragenter', 'dragover'].forEach(name => {
    els.pickFile.addEventListener(name, event => {
      event.preventDefault();
      els.pickFile.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    els.pickFile.addEventListener(name, event => {
      event.preventDefault();
      els.pickFile.classList.remove('drag');
    });
  });
  els.pickFile.addEventListener('drop', event => acceptFile(event.dataTransfer?.files?.[0]));

  els.recognize.addEventListener('click', async () => {
    if (!selectedFile) return;
    const base = normalizeBase(els.apiBase.value) || DEFAULT_API;
    els.apiBase.value = base;
    const form = new FormData();
    form.append('file', selectedFile, selectedFile.name);
    els.recognize.disabled = true;
    resetResult();
    setStatus('working', '辨識中', 'PDF 正在送往後端處理，請勿關閉頁面。');

    try {
      const response = await fetch(`${base}/api/parse`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; }
      catch { data = { raw: text }; }
      if (!response.ok) throw new Error(data?.error || data?.detail || `HTTP ${response.status}`);
      lastData = data;
      els.result.textContent = JSON.stringify(data, null, 2);
      renderTable(data);
      els.resultCard.classList.remove('hidden');
      setStatus('ok', '辨識完成', `已產生 ${Array.isArray(data.rows) ? data.rows.length : 0} 筆表格資料。`);
    } catch (error) {
      setStatus('error', '辨識失敗', error?.message || '無法連線到後端 API。');
    } finally {
      els.recognize.disabled = false;
    }
  });

  els.copyResult.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.result.textContent);
      setStatus('ok', '已複製結果', 'JSON 已複製到剪貼簿。');
    } catch {
      setStatus('error', '複製失敗', '瀏覽器未允許存取剪貼簿。');
    }
  });
})();
