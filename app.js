(() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_FILES = 50;
  const API_BASE = 'https://land-api-r900.onrender.com';
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
    'preReviewCaseNoInput','pdfInput','recognize','downloadCsv','openTemplate','clear','ownerQuery','ownerIdQuery','addressQuery','riskQuery','clearQuery','statusCard','statusDot','statusText','statusDetail','warningBox','resultSummary','resultHead','resultBody','mainTableContainer','virtualScrollbar','virtualScrollContent','modalOverlay','modalTitle','modalSubtitle','modalTbody','modalEmptyState','exportModalCsv','closeModal','templateOverlay','columnChooser','closeTemplate'
  ].map(id => [id, document.getElementById(id)]));

  let allRows = [];
  let lastData = null;
  let currentModalRecords = [];
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
    els.resultHead.innerHTML = '';
    for(const key of visibleColumns){
      const meta=COLUMNS.find(([k])=>k===key); if(!meta) continue;
      const th=document.createElement('th'); th.dataset.key=key; th.textContent=meta[1]; els.resultHead.appendChild(th);
    }
  }

  function indexCellHtml(row,rowIndex){
    const records=Array.isArray(row.change_index_records)?row.change_index_records:[];
    if(!records.length) return `<span class="index-empty">無關聯索引<br>(${escapeHtml(row.main_no||'')})</span>`;
    const sorted=[...records].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const latest=formatDate(sorted[0]?.date)||'-';
    const risk=indexHasRisk(records);
    return `<button class="index-button ${risk?'risk':''}" data-index-row="${rowIndex}" type="button">查看明細 (${records.length})<small>更新: ${escapeHtml(latest)}</small></button>${risk?'<span class="risk-text" style="display:block;text-align:center;margin-top:4px;font-size:10px">⚠️ 含風險異動</span>':''}`;
  }

  function richCell(key,row,rowIndex){
    if(key==='_index') return String(rowIndex+1);
    if(key==='type') return `<span class="type-tag ${row.type==='土地'?'type-land':'type-build'}">${escapeHtml(row.type||'')}</span>`;
    if(key==='change_index') return indexCellHtml(row,rowIndex);
    if(key==='pure_amount'){
      const vals=Array.isArray(row.pure_amount)?row.pure_amount:String(row.pure_amount||'').split(/\n|、/).filter(Boolean);
      return vals.length?vals.map(v=>`<span class="pure-amount-box">${escapeHtml(v)}</span>`).join(''):'<span style="color:#cbd5e1">--</span>';
    }
    if(key==='collateral'){
      if(Array.isArray(row.collateral_groups)&&row.collateral_groups.length){
        return row.collateral_groups.map(g=>`<div class="collateral-group"><span class="collateral-label">${escapeHtml(g.label)}</span><span>${escapeHtml(g.content)}</span></div>`).join('');
      }
    }
    return escapeHtml(displayValue(row[key])).replaceAll('\n','<br>');
  }

  function filteredRows(){
    const oq=normalize(els.ownerQuery.value), iq=normalize(els.ownerIdQuery.value), aq=normalize(els.addressQuery.value), rq=els.riskQuery.value;
    return allRows.filter(row=>{
      if(oq && !normalize(row.owner_name).includes(oq)) return false;
      if(iq && !normalize(row.owner_id).includes(iq)) return false;
      if(aq && !normalize(`${row.location||''} ${row.address||''} ${row.main_no||''}`).includes(aq)) return false;
      if(rq==='yes' && !hasRisk(row)) return false;
      if(rq==='no' && hasRisk(row)) return false;
      return true;
    });
  }

  function renderTable(){
    renderHeader();
    const rows=filteredRows();
    els.resultBody.innerHTML='';
    rows.forEach((row,index)=>{
      const tr=document.createElement('tr');
      visibleColumns.forEach(key=>{
        const td=document.createElement('td'); td.dataset.key=key;
        if(key==='notes'&&hasRisk(row)) td.classList.add('risk-cell');
        if(key==='change_index') td.classList.add('index-cell');
        td.innerHTML=richCell(key,row,index);
        tr.appendChild(td);
      });
      tr.dataset.filteredIndex=index;
      els.resultBody.appendChild(tr);
    });
    if(!rows.length){
      const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="${visibleColumns.length}" style="text-align:center;color:#94a3b8;padding:32px">目前沒有符合條件的資料</td>`; els.resultBody.appendChild(tr);
    }
    const matched=allRows.filter(r=>Number(r.change_index_count||0)>0).length;
    els.resultSummary.textContent=`共 ${rows.length} 筆資料${lastData?.file_count?`｜${lastData.file_count} 份 PDF`:''}${matched?`｜${matched} 筆已配對異動索引`:''}`;
    requestAnimationFrame(syncVirtualSize);
  }

  function syncVirtualSize(){
    const table=els.mainTableContainer.querySelector('table');
    els.virtualScrollContent.style.width=`${table.scrollWidth}px`;
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
    els.modalSubtitle.textContent=`號碼: ${row.main_no||'-'} | 地點: ${row.location||'-'}｜依登記次序追蹤權利人異動`;
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
        tr.innerHTML=`<td>${escapeHtml(r.order||'')}</td><td>${escapeHtml(r.date||'')}</td><td class="${reasonRisk?'risk-text':''}">${escapeHtml(r.reason||'')}</td><td><span class="${cls}">${escapeHtml(action)}</span></td><td>${escapeHtml(r.owner||'未載明')}</td><td class="${mortgageRisk?'risk-text':''}">${escapeHtml(r.mortgagee||'')}</td><td>${escapeHtml(r.note||'')}</td><td>${escapeHtml(r.dept||'')}</td>`;
        els.modalTbody.appendChild(tr);
      });
    }
    els.modalOverlay.classList.add('open'); els.modalOverlay.setAttribute('aria-hidden','false');
  }
  function closeModal(){els.modalOverlay.classList.remove('open');els.modalOverlay.setAttribute('aria-hidden','true')}

  els.resultBody.addEventListener('click',event=>{
    const btn=event.target.closest('[data-index-row]'); if(!btn) return;
    const rows=filteredRows(); const row=rows[Number(btn.dataset.indexRow)]; if(row) openIndexModal(row);
  });
  els.closeModal.addEventListener('click',closeModal);
  els.modalOverlay.addEventListener('click',e=>{if(e.target===els.modalOverlay)closeModal()});
  els.exportModalCsv.addEventListener('click',()=>{
    if(!currentModalRecords.length)return;
    const cols=[['order','登記次序'],['date','登記日期'],['reason','登記原因'],['action','異動別'],['owner','所有權部權利人'],['mortgagee','他項權利部權利人'],['note','說明'],['dept','部別']];
    const lines=[cols.map(([,l])=>csvEscape(l)).join(',')]; currentModalRecords.forEach(r=>lines.push(cols.map(([k])=>csvEscape(r[k])).join(',')));
    downloadBlob('\uFEFF'+lines.join('\r\n'),`異動歷程-${Date.now()}.csv`);
  });

  function downloadBlob(content,name){const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
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
  els.openTemplate.addEventListener('click',openTemplate); els.closeTemplate.addEventListener('click',closeTemplate); els.templateOverlay.addEventListener('click',e=>{if(e.target===els.templateOverlay)closeTemplate()});

  ['input','change'].forEach(ev=>{els.ownerQuery.addEventListener(ev,renderTable);els.ownerIdQuery.addEventListener(ev,renderTable);els.addressQuery.addEventListener(ev,renderTable);els.riskQuery.addEventListener(ev,renderTable)});
  els.clearQuery.addEventListener('click',()=>{els.ownerQuery.value='';els.ownerIdQuery.value='';els.addressQuery.value='';els.riskQuery.value='';renderTable()});
  els.clear.addEventListener('click',()=>{allRows=[];lastData=null;els.pdfInput.value='';els.preReviewCaseNoInput.value='';els.warningBox.classList.add('hidden');els.statusCard.classList.add('hidden');renderTable()});

  els.recognize.addEventListener('click',async()=>{
    const files=Array.from(els.pdfInput.files||[]);
    if(!files.length){setStatus('error','尚未選擇檔案','請先選擇一份或多份 PDF。');return;}
    if(files.length>MAX_FILES){setStatus('error','檔案過多',`一次最多 ${MAX_FILES} 份 PDF。`);return;}
    const oversized=files.find(f=>f.size>MAX_BYTES); if(oversized){setStatus('error','檔案過大',`${oversized.name} 超過 20MB。`);return;}
    const form=new FormData(); files.forEach(f=>form.append('files',f,f.name));
    els.recognize.disabled=true; setStatus('working','正在解析',`共 ${files.length} 份 PDF，正在辨識謄本並配對異動索引…`);
    try{
      const response=await fetch(`${API_BASE}/api/parse-batch`,{method:'POST',body:form,headers:{Accept:'application/json'}});
      const text=await response.text(); let data; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
      if(!response.ok) throw new Error(data?.error||`HTTP ${response.status}`);
      const caseNo=els.preReviewCaseNoInput.value.trim();
      allRows=(Array.isArray(data.rows)?data.rows:[]).map(row=>({...row,pre_review_case_no:caseNo||row.pre_review_case_no||'-'}));
      lastData={...data,rows:allRows}; renderWarnings(data); renderTable();
      const matched=allRows.filter(r=>Number(r.change_index_count||0)>0).length;
      setStatus('ok','解析完成',`產生 ${allRows.length} 筆資料；${matched} 筆已配對異動索引。`);
    }catch(error){setStatus('error','解析失敗',error?.message||'無法連線到後端 API。')}finally{els.recognize.disabled=false}
  });

  renderTable();
})();
