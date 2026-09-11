(() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_FILES = 50;
  const PAGE_SIZE = 50;
  const API_BASE = 'https://land-api-r900.onrender.com';
  const DB_NAME = 'LandRegistryApiDB';
  const DB_VERSION = 1;
  const STORE = 'properties';
  const RISK_WORDS = ['流抵','查封','限制登記','套繪','假扣押','假處分','預告登記'];
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
    'preReviewCaseNoInput','pdfInput','recognize','updateDatabase','downloadCsv','openTemplate','clearDatabase',
    'ownerQuery','ownerIdQuery','addressQuery','preReviewCaseNoQuery','dateStartQuery','dateEndQuery','riskQuery','sortQuery','clearQuery',
    'statusCard','statusDot','statusText','statusDetail','warningBox','resultSummary','resultHead','resultBody','mainTableContainer','paginationContainer','virtualScrollbar','virtualScrollContent',
    'modalOverlay','modalTitle','modalSubtitle','modalTbody','modalEmptyState','exportModalCsv','closeModal','templateOverlay','columnChooser','closeTemplate'
  ].map(id => [id, document.getElementById(id)]));

  let allRows = [];
  let previewRows = [];
  let lastData = null;
  let currentModalRecords = [];
  let currentPageRows = [];
  let currentPage = 1;
  let isPreviewMode = false;
  let visibleColumns = loadColumns();

  function loadColumns(){
    try {
      const saved = JSON.parse(localStorage.getItem('landWebColumns') || 'null');
      if(Array.isArray(saved) && saved.length) return COLUMNS.filter(([k])=>saved.includes(k)).map(([k])=>k);
    } catch {}
    return COLUMNS.map(([k])=>k);
  }
  function saveColumns(){ localStorage.setItem('landWebColumns', JSON.stringify(visibleColumns)); }
  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const displayValue = value => Array.isArray(value) ? value.join('、') : (value === 0 ? '0' : (value || '—'));
  const csvEscape = value => `"${String(Array.isArray(value)?value.join('、'):(value??'')).replaceAll('"','""')}"`;
  const normalize = value => String(value||'').replace(/[\s\u3000]+/g,'').toUpperCase();
  const todayString = () => new Date().toISOString().slice(0,10);

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'propertyCompositeKey'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  function buildKey(row){
    return [row.pre_review_case_no||'',row.type||'',row.location||'',row.main_no||'',row.owner_id||row.owner_name||''].join('|');
  }
  async function dbGetAll(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const req=tx.objectStore(STORE).getAll();
      req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
    });
  }
  async function dbPutAll(rows){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const store=tx.objectStore(STORE);
      rows.forEach(row=>store.put({...row,propertyCompositeKey:buildKey(row)}));
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
  async function dbClear(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const req=tx.objectStore(STORE).clear();
      req.onsuccess=resolve; req.onerror=()=>reject(req.error);
    });
  }

  function setStatus(kind,title,detail=''){
    els.statusCard.classList.remove('hidden');
    els.statusDot.className=`status-dot ${kind||''}`.trim();
    els.statusText.textContent=title;
    els.statusDetail.textContent=detail;
  }
  function hasRisk(row){
    const risk = Array.isArray(row.risk_alerts) ? row.risk_alerts.join(' ') : String(row.risk_alerts||'');
    const combined = `${risk} ${row.notes||''} ${row.settings||''}`;
    return RISK_WORDS.some(k=>combined.includes(k)) || /民間法人設定|民間個人設定/.test(combined);
  }
  function indexHasRisk(records){
    return (records||[]).some(r => RISK_WORDS.some(k=>`${r.reason||''} ${r.action||''} ${r.note||''} ${r.dept||''}`.includes(k)) || /\*\*|＊＊/.test(String(r.mortgagee||r.rawHolder||'')));
  }
  function formatDate(raw){ return String(raw||'').replace(/年/g,'.').replace(/月/g,'.').replace(/日/g,''); }

  function renderHeader(){
    els.resultHead.innerHTML='';
    for(const key of visibleColumns){
      const meta=COLUMNS.find(([k])=>k===key); if(!meta) continue;
      const th=document.createElement('th'); th.dataset.key=key; th.textContent=meta[1]; els.resultHead.appendChild(th);
    }
  }
  function indexCellHtml(row,pageIndex){
    const records=Array.isArray(row.change_index_records)?row.change_index_records:[];
    if(!records.length) return `<span class="index-empty">無關聯索引<br>(${escapeHtml(row.main_no||'')})</span>`;
    const sorted=[...records].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const latest=formatDate(sorted[0]?.date)||'-';
    const risk=indexHasRisk(records);
    return `<button class="index-button ${risk?'risk':''}" data-page-row="${pageIndex}" type="button"><span>查看明細 (${records.length})</span><small>更新: ${escapeHtml(latest)}</small></button>${risk?'<span class="risk-text" style="display:block;text-align:center;margin-top:4px;font-size:10px">⚠️ 含風險異動</span>':''}`;
  }
  function richCell(key,row,index){
    if(key==='_index') return String(index+1);
    if(key==='type') return `<span class="type-tag ${row.type==='土地'?'type-land':'type-build'}">${escapeHtml(row.type||'')}</span>`;
    if(key==='change_index') return indexCellHtml(row,index);
    if(key==='pure_amount'){
      const vals=Array.isArray(row.pure_amount)?row.pure_amount:String(row.pure_amount||'').split(/\n|、/).filter(v=>v&&v!=='無');
      return vals.length?vals.map(v=>`<span class="pure-amount-box">${escapeHtml(v)}</span>`).join(''):'<span style="color:#cbd5e1">--</span>';
    }
    if(key==='collateral' && Array.isArray(row.collateral_groups) && row.collateral_groups.length){
      return row.collateral_groups.map(g=>`<div class="collateral-group"><span class="collateral-label">${escapeHtml(g.label)}</span><span>${escapeHtml(g.content)}</span></div>`).join('');
    }
    return escapeHtml(displayValue(row[key])).replaceAll('\n','<br>');
  }

  function filteredRows(){
    const oq=normalize(els.ownerQuery.value), iq=normalize(els.ownerIdQuery.value), aq=normalize(els.addressQuery.value), cq=normalize(els.preReviewCaseNoQuery.value);
    const start=els.dateStartQuery.value.trim(), end=els.dateEndQuery.value.trim(), rq=els.riskQuery.value;
    let rows=allRows.filter(row=>{
      if(oq && !normalize(row.owner_name).includes(oq)) return false;
      if(iq && !normalize(row.owner_id).includes(iq)) return false;
      if(aq && !normalize(`${row.location||''} ${row.address||''} ${row.main_no||''}`).includes(aq)) return false;
      if(cq && !normalize(row.pre_review_case_no).includes(cq)) return false;
      const rd=String(row.record_time||'');
      if(start && (!rd || rd<start)) return false;
      if(end && (!rd || rd>end)) return false;
      if(rq==='yes' && !hasRisk(row)) return false;
      if(rq==='no' && hasRisk(row)) return false;
      return true;
    });
    const sort=els.sortQuery.value;
    if(sort==='owner_id_asc') rows.sort((a,b)=>String(a.owner_id||'~~~~').localeCompare(String(b.owner_id||'~~~~'),'zh-Hant'));
    else if(sort==='owner_id_desc') rows.sort((a,b)=>String(b.owner_id||'').localeCompare(String(a.owner_id||''),'zh-Hant'));
    else rows.sort((a,b)=>String(b.query_time||'').localeCompare(String(a.query_time||'')));
    return rows;
  }

  function renderTable(){
    renderHeader();
    const rows=filteredRows();
    const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    if(currentPage>totalPages) currentPage=totalPages;
    if(currentPage<1) currentPage=1;
    const start=(currentPage-1)*PAGE_SIZE;
    currentPageRows=rows.slice(start,start+PAGE_SIZE);
    els.resultBody.innerHTML='';
    currentPageRows.forEach((row,pageIndex)=>{
      const tr=document.createElement('tr');
      visibleColumns.forEach(key=>{
        const td=document.createElement('td'); td.dataset.key=key;
        if(key==='notes'&&hasRisk(row)) td.classList.add('risk-cell');
        if(key==='change_index') td.classList.add('index-cell');
        td.innerHTML=richCell(key,row,start+pageIndex);
        tr.appendChild(td);
      });
      els.resultBody.appendChild(tr);
    });
    if(!currentPageRows.length){
      const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="${visibleColumns.length}" style="text-align:center;color:#94a3b8;padding:32px">資料庫是空的，或沒有符合查詢條件的資料。</td>`; els.resultBody.appendChild(tr);
    }
    const matched=rows.filter(r=>Number(r.change_index_count||0)>0).length;
    els.resultSummary.textContent=`共 ${rows.length} 筆資料${isPreviewMode?'｜預覽模式':''}${lastData?.file_count?`｜${lastData.file_count} 份 PDF`:''}${matched?`｜${matched} 筆已配對異動索引`:''}`;
    renderPagination(rows.length,totalPages);
    requestAnimationFrame(syncVirtualSize);
  }
  function renderPagination(total,totalPages){
    if(totalPages<=1){els.paginationContainer.innerHTML=total?`<div>共 ${total} 筆資料</div>`:'';return;}
    els.paginationContainer.innerHTML=`<div>共 ${total} 筆資料</div><div class="pagination-actions"><button data-page="1">首頁</button><button data-page="${Math.max(1,currentPage-1)}">上一頁</button><span>${currentPage} / ${totalPages}</span><button data-page="${Math.min(totalPages,currentPage+1)}">下一頁</button><button data-page="${totalPages}">末頁</button></div>`;
  }
  els.paginationContainer.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;currentPage=Number(b.dataset.page)||1;renderTable();});

  function syncVirtualSize(){
    const table=els.mainTableContainer.querySelector('table');
    els.virtualScrollContent.style.width=`${table.scrollWidth}px`;
    els.virtualScrollbar.classList.toggle('hidden',table.scrollWidth<=els.mainTableContainer.clientWidth);
  }
  let syncing=false;
  els.mainTableContainer.addEventListener('scroll',()=>{if(syncing)return;syncing=true;els.virtualScrollbar.scrollLeft=els.mainTableContainer.scrollLeft;syncing=false});
  els.virtualScrollbar.addEventListener('scroll',()=>{if(syncing)return;syncing=true;els.mainTableContainer.scrollLeft=els.virtualScrollbar.scrollLeft;syncing=false});

  function renderWarnings(data){
    const warnings=Array.isArray(data.warnings)?data.warnings.filter(Boolean):[];
    if(!warnings.length){els.warningBox.classList.add('hidden');els.warningBox.innerHTML='';return;}
    els.warningBox.innerHTML=`<strong>待確認項目</strong><ul>${warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
    els.warningBox.classList.remove('hidden');
  }

  function openIndexModal(row){
    const records=Array.isArray(row.change_index_records)?[...row.change_index_records]:[];
    currentModalRecords=records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.order||'').localeCompare(String(a.order||'')));
    els.modalTitle.textContent='異動歷程明細';
    els.modalSubtitle.textContent=`號碼: ${row.main_no||'-'} | 地點: ${row.location||'-'}｜依登記次序由舊到新繼承權利人；移轉、清償及塗銷分別更新，未載明不代表民間設定。`;
    els.modalTbody.innerHTML='';
    if(!currentModalRecords.length){els.modalEmptyState.classList.remove('hidden');}
    else{
      els.modalEmptyState.classList.add('hidden');
      currentModalRecords.forEach(r=>{
        const tr=document.createElement('tr');
        const action=String(r.action||'');
        let cls='tag tag-mod';
        if(/新增|第一次/.test(action)) cls='tag tag-add'; else if(/刪除/.test(action)||/清償|塗銷/.test(String(r.reason||''))) cls='tag tag-del'; else if(/設定/.test(action)||/設定/.test(String(r.reason||''))) cls='tag tag-set';
        const reasonRisk=RISK_WORDS.some(k=>`${r.reason||''} ${r.action||''} ${r.note||''}`.includes(k));
        const mortgageRisk=/\*\*|＊＊/.test(String(r.mortgagee||r.rawHolder||''));
        const owner = r.owner && !/^\s*$/.test(r.owner) ? r.owner : '未載明';
        const mortgagee = r.mortgagee && !/^\s*$/.test(r.mortgagee) ? r.mortgagee : ((r.dept||'').includes('他項權利部')?'未載明':'');
        tr.innerHTML=`<td>${escapeHtml(r.order||'')}</td><td>${escapeHtml(r.date||'')}</td><td class="${reasonRisk?'risk-text':''}">${escapeHtml(r.reason||'')}</td><td><span class="${cls}">${escapeHtml(action)}</span></td><td>${escapeHtml(owner)}</td><td class="${mortgageRisk?'risk-text':''}">${escapeHtml(mortgagee)}</td><td>${escapeHtml(r.note||'')}</td><td>${escapeHtml(r.dept||'')}</td>`;
        els.modalTbody.appendChild(tr);
      });
    }
    els.modalOverlay.classList.add('open'); els.modalOverlay.setAttribute('aria-hidden','false');
  }
  function closeModal(){els.modalOverlay.classList.remove('open');els.modalOverlay.setAttribute('aria-hidden','true');}
  els.resultBody.addEventListener('click',event=>{
    const btn=event.target.closest('[data-page-row]'); if(!btn) return;
    const absolute=Number(btn.dataset.pageRow); const rows=filteredRows(); const row=rows[absolute]; if(row) openIndexModal(row);
  });
  els.closeModal.addEventListener('click',closeModal);
  els.modalOverlay.addEventListener('click',e=>{if(e.target===els.modalOverlay)closeModal();});

  function downloadBlob(content,name){const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  els.exportModalCsv.addEventListener('click',()=>{
    if(!currentModalRecords.length)return;
    const cols=[['order','登記次序'],['date','登記日期'],['reason','登記原因'],['action','異動別'],['owner','所有權部權利人'],['mortgagee','他項權利部權利人'],['note','說明'],['dept','部別']];
    const lines=[cols.map(([,l])=>csvEscape(l)).join(',')]; currentModalRecords.forEach(r=>lines.push(cols.map(([k])=>csvEscape(r[k])).join(',')));
    downloadBlob('\uFEFF'+lines.join('\r\n'),`異動歷程-${Date.now()}.csv`);
  });
  els.downloadCsv.addEventListener('click',()=>{
    const rows=filteredRows(); if(!rows.length)return;
    const columns=COLUMNS.filter(([k])=>visibleColumns.includes(k)); const lines=[columns.map(([,l])=>csvEscape(l)).join(',')];
    rows.forEach((row,index)=>lines.push(columns.map(([k])=>csvEscape(k==='_index'?index+1:row[k])).join(',')));
    downloadBlob('\uFEFF'+lines.join('\r\n'),`地政謄本辨識結果-${new Date().toISOString().slice(0,10)}.csv`);
  });

  function openTemplate(){
    els.columnChooser.innerHTML=COLUMNS.map(([key,label])=>`<label class="column-item"><input type="checkbox" value="${key}" ${visibleColumns.includes(key)?'checked':''}><span>${escapeHtml(label)}</span></label>`).join('');
    els.templateOverlay.classList.add('open'); els.templateOverlay.setAttribute('aria-hidden','false');
  }
  function closeTemplate(){
    const checked=[...els.columnChooser.querySelectorAll('input:checked')].map(i=>i.value); if(checked.length){visibleColumns=checked;saveColumns();renderTable();}
    els.templateOverlay.classList.remove('open'); els.templateOverlay.setAttribute('aria-hidden','true');
  }
  els.openTemplate.addEventListener('click',openTemplate); els.closeTemplate.addEventListener('click',closeTemplate); els.templateOverlay.addEventListener('click',e=>{if(e.target===els.templateOverlay)closeTemplate();});

  ['input','change'].forEach(ev=>{
    [els.ownerQuery,els.ownerIdQuery,els.addressQuery,els.preReviewCaseNoQuery,els.dateStartQuery,els.dateEndQuery,els.riskQuery,els.sortQuery].forEach(el=>el.addEventListener(ev,()=>{currentPage=1;renderTable();}));
  });
  els.clearQuery.addEventListener('click',()=>{
    [els.ownerQuery,els.ownerIdQuery,els.addressQuery,els.preReviewCaseNoQuery,els.dateStartQuery,els.dateEndQuery].forEach(el=>el.value='');
    els.riskQuery.value=''; els.sortQuery.value='query_time_desc'; currentPage=1; renderTable();
  });

  els.recognize.addEventListener('click',async()=>{
    const files=Array.from(els.pdfInput.files||[]);
    if(!files.length){setStatus('error','尚未選擇檔案','請先選擇一份或多份 PDF。');return;}
    if(files.length>MAX_FILES){setStatus('error','檔案過多',`一次最多 ${MAX_FILES} 份 PDF。`);return;}
    const oversized=files.find(f=>f.size>MAX_BYTES); if(oversized){setStatus('error','檔案過大',`${oversized.name} 超過 20MB。`);return;}
    const form=new FormData(); files.forEach(f=>form.append('files',f,f.name));
    els.recognize.disabled=true; setStatus('working','正在解析',`共 ${files.length} 份 PDF，正在辨識謄本並配對異動索引…`);
    try{
      const response=await fetch(`${API_BASE}/api/parse-batch`,{method:'POST',body:form,headers:{Accept:'application/json'}});
      const text=await response.text(); let data; try{data=text?JSON.parse(text):{}}catch{data={raw:text};}
      if(!response.ok) throw new Error(data?.error||`HTTP ${response.status}`);
      const caseNo=els.preReviewCaseNoInput.value.trim();
      previewRows=(Array.isArray(data.rows)?data.rows:[]).map(row=>({...row,pre_review_case_no:caseNo||row.pre_review_case_no||'-'}));
      allRows=previewRows; isPreviewMode=true; lastData={...data,rows:previewRows}; currentPage=1; renderWarnings(data); renderTable();
      const matched=previewRows.filter(r=>Number(r.change_index_count||0)>0).length;
      setStatus('ok','解析完成',`產生 ${previewRows.length} 筆資料；${matched} 筆已配對異動索引。`);
    }catch(error){setStatus('error','解析失敗',error?.message||'無法連線到後端 API。');}finally{els.recognize.disabled=false;}
  });

  els.updateDatabase.addEventListener('click',async()=>{
    if(!previewRows.length){setStatus('error','沒有可更新的資料','請先執行解析。');return;}
    const caseNo=els.preReviewCaseNoInput.value.trim();
    if(!caseNo && !confirm('尚未填寫初審單號；若不填寫，日後將無法使用此項條件搜尋。是否仍要繼續更新本機資料庫？')) return;
    if(!confirm('確定要將目前解析的資料加入或更新到本機資料庫嗎？')) return;
    try{
      const recordTime=todayString();
      const rows=previewRows.map(row=>({...row,pre_review_case_no:caseNo||row.pre_review_case_no||'-',record_time:recordTime}));
      await dbPutAll(rows); previewRows=[]; isPreviewMode=false; els.pdfInput.value='';
      allRows=await dbGetAll(); lastData=null; currentPage=1; renderTable();
      setStatus('ok','更新完成',`成功加入或更新 ${rows.length} 筆資料。`);
    }catch(error){setStatus('error','更新失敗',error?.message||'無法寫入本機資料庫。');}
  });

  els.clearDatabase.addEventListener('click',async()=>{
    if(!confirm('⚠️ 確定要刪除本機資料庫中的所有歷史紀錄嗎？此操作無法復原！')) return;
    try{await dbClear(); previewRows=[]; allRows=[]; isPreviewMode=false; currentPage=1; renderTable(); setStatus('ok','已清空','本機資料庫已成功清空。');}
    catch(error){setStatus('error','清空失敗',error?.message||'無法清空本機資料庫。');}
  });

  async function init(){
    try{allRows=await dbGetAll();isPreviewMode=false;renderTable();if(allRows.length)setStatus('ok','已載入本機資料庫',`共 ${allRows.length} 筆資料。`);}
    catch{renderTable();}
  }
  init();
})();
