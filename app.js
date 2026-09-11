(() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const DEFAULT_API = 'https://land-api-r900.onrender.com';
  const COLUMNS = [
    ['_index','項次'], ['pre_review_case_no','初審單號'], ['type','類型'], ['owner_name','所有權人'], ['owner_id','所有權人證號'], ['owner_share','持分'],
    ['location','縣市區/地段'], ['address','建號:建物門牌 / 地號:地上建號'], ['main_no','主建號/地號'],
    ['main_building_parts','【A】主建物概況'], ['main_building_m2','【A】合計主建物(m²)'], ['main_building_ping','【A】合計主建物(坪)'],
    ['public_parts','【B】共有建物概況'], ['public_m2','【B】合計共有面積(m²)'], ['public_ping','【B】合計共有面積(坪)'],
    ['parking_count','【C】車位數'], ['parking_ratio','【C】車權利範圍(累加)'], ['parking_m2','【C】車位面積(m²)'], ['parking_ping','【C】車位面積(坪)'],
    ['total_m2_w_car','【D】合計m²(含車)'], ['total_ping_w_car','合計坪數(含車坪)'], ['total_m2_no_car','【D】合計m²(不含車)'], ['total_ping_no_car','合計坪數(不含車)'],
    ['announced_value','公告現值'], ['announced_price','公告地價'], ['post_share_m2_w_car','【E】持分後合計m²(含車)'], ['post_share_ping_w_car','【E】持分後合計坪(含車)'],
    ['post_share_m2_no_car','【E】持分後m²(不含車)'], ['post_share_ping_no_car','【E】持分後合計坪(不含車)'], ['pure_amount','純金額提取'], ['collateral','共擔提純 (完整版)'],
    ['settings','設定情形 (H順位)'], ['notes','備註'], ['change_index','【關鍵】異動索引'], ['query_time','謄本日期'], ['source_file','來源檔案'], ['record_time','建檔日']
  ];

  const els = Object.fromEntries([
    'apiBase','saveApi','pdfInput','pickFile','fileInfo','recognize','clear','statusCard','statusDot','statusText','statusDetail','resultCard','resultSummary','resultBody','result','warningBox','copyResult','downloadCsv'
  ].map(id => [id, document.getElementById(id)]));

  let selectedFile = null;
  let lastData = null;
  els.apiBase.value = localStorage.getItem('landApiBase') || DEFAULT_API;

  const normalizeBase = value => value.trim().replace(/\/+$/, '');
  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const displayValue = value => Array.isArray(value) ? value.join('、') : (value === 0 ? '0' : (value || '—'));

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
      resetFile(); setStatus('error','檔案格式不符','請選擇 PDF 檔案。'); return;
    }
    if (file.size > MAX_BYTES) {
      resetFile(); setStatus('error','檔案過大','僅接受 20MB 以內的 PDF。'); return;
    }
    selectedFile = file;
    els.fileInfo.textContent = `${file.name}｜${(file.size / 1024 / 1024).toFixed(2)} MB`;
    els.fileInfo.classList.remove('hidden');
    els.recognize.disabled = false;
    els.clear.disabled = false;
    setStatus('', '檔案已選取', '按「開始辨識」後才會上傳到私有後端。');
  }

  function renderTable(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    els.resultBody.innerHTML = '';
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = COLUMNS.map(([key]) => {
        const value = key === '_index' ? index + 1 : row[key];
        const cls = key === 'notes' && Array.isArray(row.risk_alerts) && row.risk_alerts.length ? 'risk-cell' : '';
        return `<td class="${cls}">${escapeHtml(displayValue(value)).replaceAll('\n','<br>')}</td>`;
      }).join('');
      els.resultBody.appendChild(tr);
    });
    if (!rows.length) els.resultBody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-cell">未產生可顯示的表格列。</td></tr>`;

    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
    if (warnings.length) {
      els.warningBox.innerHTML = `<strong>待補強項目</strong><ul>${warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
      els.warningBox.classList.remove('hidden');
    } else {
      els.warningBox.classList.add('hidden');
    }
    els.resultSummary.textContent = [`共 ${rows.length} 筆`, data.page_count ? `${data.page_count} 頁` : '', data.parser_version ? `解析器 ${data.parser_version}` : ''].filter(Boolean).join('｜');
  }

  function csvEscape(value) {
    const text = Array.isArray(value) ? value.join('、') : String(value ?? '');
    return `"${text.replaceAll('"','""')}"`;
  }

  function downloadCsv() {
    if (!lastData || !Array.isArray(lastData.rows)) return;
    const lines = [COLUMNS.map(([,label]) => csvEscape(label)).join(',')];
    lastData.rows.forEach((row,index) => lines.push(COLUMNS.map(([key]) => csvEscape(key === '_index' ? index + 1 : row[key])).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFile?.name?.replace(/\.pdf$/i,'') || 'land-registry'}-辨識結果.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  els.saveApi.addEventListener('click', () => {
    const base = normalizeBase(els.apiBase.value) || DEFAULT_API;
    els.apiBase.value = base;
    localStorage.setItem('landApiBase', base);
    setStatus('ok','API 網址已儲存',base);
  });
  els.pickFile.addEventListener('click', () => els.pdfInput.click());
  els.pdfInput.addEventListener('change', event => acceptFile(event.target.files?.[0]));
  els.clear.addEventListener('click', resetFile);
  els.downloadCsv.addEventListener('click', downloadCsv);

  ['dragenter','dragover'].forEach(name => els.pickFile.addEventListener(name, event => { event.preventDefault(); els.pickFile.classList.add('drag'); }));
  ['dragleave','drop'].forEach(name => els.pickFile.addEventListener(name, event => { event.preventDefault(); els.pickFile.classList.remove('drag'); }));
  els.pickFile.addEventListener('drop', event => acceptFile(event.dataTransfer?.files?.[0]));

  els.recognize.addEventListener('click', async () => {
    if (!selectedFile) return;
    const base = normalizeBase(els.apiBase.value) || DEFAULT_API;
    const form = new FormData();
    form.append('file', selectedFile, selectedFile.name);
    els.recognize.disabled = true;
    resetResult();
    setStatus('working','辨識中','PDF 正在送往後端解析。');
    try {
      const response = await fetch(`${base}/api/parse`, {method:'POST', body:form, headers:{Accept:'application/json'}});
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
      if (!response.ok) throw new Error(data?.error || data?.detail || `HTTP ${response.status}`);
      lastData = data;
      els.result.textContent = JSON.stringify(data,null,2);
      renderTable(data);
      els.resultCard.classList.remove('hidden');
      setStatus('ok','辨識完成',`已產生 ${Array.isArray(data.rows) ? data.rows.length : 0} 筆資料。`);
    } catch (error) {
      setStatus('error','辨識失敗',error?.message || '無法連線到後端 API。');
    } finally {
      els.recognize.disabled = false;
    }
  });

  els.copyResult.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(els.result.textContent); setStatus('ok','已複製結果','JSON 已複製到剪貼簿。'); }
    catch { setStatus('error','複製失敗','瀏覽器未允許存取剪貼簿。'); }
  });
})();
