// ─────────────────────────────────────────────
//  JOURNAL AI ANALYSIS  (analysis.js)
//  Uses the same local Ollama instance as speech.js
//
//  Philosophy: pure data extraction only.
//  No interpretation, no advice, no human framing.
//  Returns raw structured JSON that the UI renders.
//
//  Output saved locally via File System Access API
//  (user picks a folder on first save) with a
//  standard download as fallback.
// ─────────────────────────────────────────────

(function () {
  'use strict';

  const OLLAMA_BASE  = 'http://localhost:11434';
  const OLLAMA_URL   = OLLAMA_BASE + '/api/generate';

  // ── STORAGE ───────────────────────────────
  async function getAnalyses() {
    // Analyses are now stored per-entry in Supabase, not as a single localStorage object
    // This function is kept for compatibility but returns empty object
    return {};
  }
  async function saveAnalysis(key, data) {
    // Save to Supabase using the entry ID as key
    await supabase.saveAnalysis(key, data);
  }
  async function fetchAnalysis(entryId) {
    return await supabase.fetchAnalysis(entryId);
  }

  // ── MODEL RESOLUTION (mirrors speech.js) ─
  const MODEL_PRIORITY = [
    'llama3.2', 'llama3.1:8b', 'llama3:8b',
    'mistral', 'llama3.2:1b', 'phi3:mini', 'phi3', 'gemma2:2b',
  ];
  let resolvedModel = null;

  async function resolveModel() {
    if (resolvedModel) return resolvedModel;
    try {
      const res  = await fetch(OLLAMA_BASE + '/api/tags');
      const data = await res.json();
      const installed = (data.models || []).map(m => m.name);
      for (const pref of MODEL_PRIORITY) {
        const match = installed.find(n => n.startsWith(pref.split(':')[0]));
        if (match) { resolvedModel = match; return resolvedModel; }
      }
      if (installed.length > 0) { resolvedModel = installed[0]; return resolvedModel; }
      throw new Error('No Ollama models installed. Run: ollama pull llama3.2');
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error('Cannot reach Ollama.\n  Start it with:  OLLAMA_ORIGINS="*" ollama serve');
      }
      throw err;
    }
  }

  // ── FIND ENTRY ID BY CONTENT ──────────────
  // Since activeJournalEntryId is not exposed on window,
  // match by content to get the real entry ID.
  function findEntryId(content) {
    if (typeof getJournalEntries !== 'function') return null;
    const entries = getJournalEntries();
    const match   = entries.find(e => (e.content || '').trim() === content.trim());
    return match ? match.id : null;
  }

  // ── ANALYSE ───────────────────────────────
  async function analyseEntry(content, btn) {
    btn.disabled = true;
    btn.classList.add('stt-polishing');
    btn.innerHTML = barChartSvg() + ' Analysing…';

    // Strict data-extraction prompt — no opinion, no advice
    const prompt = `You are a data extraction engine. Analyse the following journal entry text. Return ONLY a valid JSON object. No preamble, no explanation, no markdown fences.

Required JSON fields (use null where not determinable):

{
  "word_count": <integer>,
  "sentence_count": <integer>,
  "paragraph_count": <integer>,
  "avg_sentence_length_words": <float>,
  "events": [
    {
      "event": "<concise description of a specific thing that happened, exactly as stated>",
      "emotional_response": ["<emotion word>"],
      "emotion_intensity": "<low|medium|high>"
    }
  ],
  "emotions_detected": [<lowercase emotion strings clearly present in the text>],
  "emotions_absent": [<emotions from this fixed set NOT in emotions_detected: joy, sadness, anger, fear, disgust, surprise, trust, anticipation>],
  "dominant_emotion": "<single most prominent emotion string or null>",
  "emotion_confidence": <float 0.0–1.0, how clearly emotions are expressed>,
  "topics": [<specific topics or subjects explicitly mentioned>],
  "topic_frequency": {<"topic": mention_count>},
  "named_entities": [<people, places, organisations explicitly named>],
  "temporal_focus": "<past|present|future|mixed>",
  "first_person_count": <count of I/me/my/myself/mine>,
  "negation_density": "<low|medium|high>",
  "certainty_language": "<low|medium|high>",
  "question_count": <integer>,
  "exclamation_count": <integer>,
  "linguistic_complexity": "<simple|moderate|complex>",
  "entry_length_category": "<short|medium|long>",
  "sentiment_valence": "<positive|negative|neutral|mixed>",
  "flags": [<array of plain factual observations — patterns, repetitions, notable linguistic features. No interpretation.>]
}

RULES for "events":
- Only include things that definitively happened, not hypotheticals or general feelings
- Each event is one discrete occurrence: "arrived at salsa class", "Mikayla was not there"
- emotional_response lists only emotions the writer explicitly expressed in response to that event
- Do NOT infer emotions. Only include what is directly stated or strongly implied by the writer's own words
- emotions_absent must only contain emotions from the fixed set that do NOT appear in emotions_detected. The two arrays must be mutually exclusive.

Return ONLY the JSON object. Nothing else.

Journal entry:
${content}`;

    try {
      const model = await resolveModel();

      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream:     true,   // stream to avoid timeout — tokens arrive continuously
          keep_alive: -1,
          options:    { temperature: 0.1 }, // low temp for deterministic structured output
        }),
      });

      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

      // Read the stream, accumulating all tokens
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      let dotCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.response) {
              raw += obj.response;
              // Pulse the button label so the user sees progress
              dotCount = (dotCount + 1) % 4;
              btn.innerHTML = barChartSvg() + ' Analysing' + '.'.repeat(dotCount + 1);
            }
            if (obj.done) break;
          } catch { /* incomplete chunk — completed on next read */ }
        }
      }

      raw = raw.trim();
      if (!raw) throw new Error('Model returned empty response.');

      // Strip markdown code fences if model added them
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      // Extract just the JSON object if there's surrounding text
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = jsonMatch[0];

      let analysis;
      try {
        analysis = JSON.parse(raw);
      } catch {
        throw new Error('Model returned malformed JSON. Try again.');
      }

      // Attach metadata
      const entryId          = findEntryId(content);
      analysis._entry_id     = entryId;
      analysis._analysed_at  = new Date().toISOString();
      analysis._model        = model;
      analysis._entry_preview = content.slice(0, 120) + (content.length > 120 ? '…' : '');

      // Persist to Supabase
      const storageKey = entryId || ('ts_' + Date.now());
      saveAnalysis(storageKey, analysis);

      // Save JSON file to desktop
      await saveToFile(analysis, storageKey);

      // Render in side panel
      renderAnalysisResult(analysis);

      notify('Analysis complete ✓');

    } catch (err) {
      console.error('[analysis.js]', err);
      const msg = (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))
        ? 'Cannot reach Ollama.\n  Run:  OLLAMA_ORIGINS="*" ollama serve'
        : 'Analysis failed: ' + err.message;
      notify(msg);
    } finally {
      btn.disabled = false;
      btn.classList.remove('stt-polishing');
      btn.innerHTML = barChartSvg() + ' Analyse';
    }
  }

  // ── SAVE FILE ─────────────────────────────
  // Tries File System Access API first (Chrome 86+) so the
  // user can pick their own folder. Falls back to download.
  async function saveToFile(analysis, storageKey) {
    const safe     = String(storageKey).slice(0, 16).replace(/[^a-zA-Z0-9_-]/g, '_');
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `journal-analysis-${datePart}-${safe}.json`;
    const json     = JSON.stringify(analysis, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });

    // ── File System Access API ────────────────
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'JSON Analysis File',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return; // done — user chose their location
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled the picker
        // Otherwise fall through to download
        console.warn('[analysis.js] showSaveFilePicker failed, falling back to download:', e.message);
      }
    }

    // ── Download fallback ─────────────────────
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // ── RENDER RESULT IN PANEL ────────────────
  function renderAnalysisResult(a) {
    // Target the journal panel content area
    const container = document.getElementById('panel-journal-content');
    if (!container) return;

    // Reuse or create result element
    let resultEl = document.getElementById('analysis-result-panel');
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.id = 'analysis-result-panel';
      container.appendChild(resultEl);
    }

    Object.assign(resultEl.style, {
      marginTop:    '14px',
      padding:      '14px 16px',
      border:       '1px solid var(--border)',
      borderRadius: '14px',
      fontSize:     '12px',
      lineHeight:   '1.7',
      background:   'rgba(126,255,168,0.02)',
    });

    const emotions  = (a.emotions_detected   || []).join(', ') || '—';
    const absent    = (a.emotions_absent      || []).join(', ') || '—';
    const topics    = (a.topics              || []).join(', ') || '—';
    const entities  = (a.named_entities      || []).join(', ') || '—';
    const analysedAt = a._analysed_at
      ? new Date(a._analysed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';

    // Events table
    const eventsHtml = (a.events || []).length > 0
      ? (a.events || []).map(ev => {
          const intensityColor = ev.emotion_intensity === 'high'
            ? '#f07070' : ev.emotion_intensity === 'medium'
            ? '#f0c070' : 'var(--text-3)';
          const emotionTags = (ev.emotional_response || [])
            .map(e => `<span style="display:inline-block;padding:1px 7px;border-radius:20px;background:rgba(126,255,168,0.07);border:1px solid var(--border);color:var(--text-2);margin:1px 2px 1px 0;font-size:11px;">${h(e)}</span>`)
            .join('');
          return `
            <div style="padding:8px 0;border-bottom:1px solid var(--border);">
              <div style="color:var(--text-2);margin-bottom:4px;">${h(ev.event)}</div>
              <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;">
                ${emotionTags}
                <span style="margin-left:auto;font-size:10px;color:${intensityColor};text-transform:uppercase;letter-spacing:.06em;">${h(ev.emotion_intensity || '')}</span>
              </div>
            </div>
          `;
        }).join('')
      : `<div style="color:var(--text-3);">No discrete events extracted</div>`;

    // Topic frequency table
    let topicFreqHtml = '';
    if (a.topic_frequency && Object.keys(a.topic_frequency).length > 0) {
      topicFreqHtml = Object.entries(a.topic_frequency)
        .sort((x, y) => y[1] - x[1])
        .map(([t, c]) => `
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);">
            <span style="color:var(--text-2);">${h(t)}</span>
            <span style="color:var(--text-3);font-variant-numeric:tabular-nums;">${c}</span>
          </div>
        `).join('');
    }

    // Flags list
    const flagsHtml = (a.flags || []).length > 0
      ? (a.flags || []).map(f => `<div style="padding:3px 0;color:var(--text-2);border-bottom:1px solid var(--border);">${h(f)}</div>`).join('')
      : `<div style="color:var(--text-3);">None</div>`;

    resultEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mint);">Analysis</span>
        <span style="color:var(--text-3);font-size:11px;">${analysedAt} · ${h(a._model || '')}</span>
      </div>

      <div style="margin-bottom:14px;">
        <div style="color:var(--text-3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Events & emotional responses</div>
        ${eventsHtml}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:14px;">
        ${metric('Words',           a.word_count)}
        ${metric('Sentences',       a.sentence_count)}
        ${metric('Self-references', a.first_person_count)}
        ${metric('Temporal focus',  a.temporal_focus)}
        ${metric('Sentiment',       a.sentiment_valence)}
        ${metric('Negation density',a.negation_density)}
        ${metric('Certainty lang.', a.certainty_language)}
        ${metric('Complexity',      a.linguistic_complexity)}
      </div>

      ${section('Dominant emotion',  h(a.dominant_emotion || '—') + (a.emotion_confidence != null ? ` <span style="color:var(--text-3);">(${(a.emotion_confidence*100).toFixed(0)}% confidence)</span>` : ''))}
      ${section('Emotions detected', h(emotions))}
      ${section('Emotions absent',   h(absent))}
      ${section('Topics',            h(topics))}

      ${entities !== '—' ? section('Named entities', h(entities)) : ''}

      ${topicFreqHtml ? `
        <div style="margin-bottom:12px;">
          <div style="color:var(--text-3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;">Topic frequency</div>
          ${topicFreqHtml}
        </div>
      ` : ''}

      <div>
        <div style="color:var(--text-3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;">Flags</div>
        ${flagsHtml}
      </div>
    `;
  }

  // ── SMALL RENDER HELPERS ──────────────────
  function h(s) {
    if (s == null) return '—';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function metric(label, value) {
    return `
      <div>
        <div style="color:var(--text-3);font-size:10px;letter-spacing:.06em;text-transform:uppercase;">${h(label)}</div>
        <div style="color:var(--text-2);font-weight:600;font-size:13px;">${value ?? '—'}</div>
      </div>
    `;
  }

  function section(label, content) {
    return `
      <div style="margin-bottom:10px;">
        <div style="color:var(--text-3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px;">${h(label)}</div>
        <div style="color:var(--text-2);">${content}</div>
      </div>
    `;
  }

  // ── NOTIFY ────────────────────────────────
  function notify(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else console.log('[analysis.js]', msg);
  }

  // ── BAR CHART ICON ────────────────────────
  function barChartSvg() {
    return `<svg class="stt-mic-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3"  y="14" width="4" height="7"  rx="1" fill="currentColor"/>
      <rect x="10" y="9"  width="4" height="12" rx="1" fill="currentColor"/>
      <rect x="17" y="4"  width="4" height="17" rx="1" fill="currentColor"/>
    </svg>`;
  }

  // ── INJECT BUTTON INTO PANEL ──────────────
  function injectAnalyseButton() {
    if (document.getElementById('panel-analyse-btn')) return;

    const actionsContainer = document.getElementById('side-panel-actions');
    if (!actionsContainer) return;

    const btn = document.createElement('button');
    btn.id        = 'panel-analyse-btn';
    btn.type      = 'button';
    btn.className = 'stt-polish-btn panel-action-btn';
    btn.style.marginRight = '4px';
    btn.innerHTML = barChartSvg() + ' Analyse';
    btn.title     = 'Extract raw data from this entry — emotions, topics, linguistic signals. No interpretation. Saves JSON to disk.';

    btn.addEventListener('click', () => {
      const textarea = document.getElementById('notes-textarea');
      if (!textarea || !textarea.value.trim()) {
        notify('Open a journal entry first');
        return;
      }
      analyseEntry(textarea.value.trim(), btn);
    });

    // Insert before the add (+) button, or at end
    const addBtn = document.getElementById('panel-add-btn');
    if (addBtn) actionsContainer.insertBefore(btn, addBtn);
    else        actionsContainer.appendChild(btn);
  }

  function removeAnalyseButton() {
    document.getElementById('panel-analyse-btn')?.remove();
    document.getElementById('analysis-result-panel')?.remove();
  }

  // ── HOOK INTO SPEECH.JS INJECTION ────────
  // speech.js exposes injectPanelMicButton on window.
  // We extend it so our Analyse button follows the same lifecycle
  // (injected when mic/polish buttons are injected, removed when they're removed).
  function hookIntoMicInjection() {
    const orig = window.injectPanelMicButton;
    if (typeof orig !== 'function') return false;

    window.injectPanelMicButton = function () {
      orig();
      injectAnalyseButton();
    };
    return true;
  }

  // ── HOOK INTO setMainView ─────────────────
  // When leaving journal/notes view, clean up our button + result panel.
  function hookIntoSetMainView() {
    const orig = window.setMainView;
    if (typeof orig !== 'function') return;

    window.setMainView = function (view) {
      orig(view);
      if (view !== 'journal' && view !== 'notes') {
        removeAnalyseButton();
      } else if (view === 'journal') {
        // Give the DOM a tick to settle before injecting
        setTimeout(injectAnalyseButton, 120);
      }
    };
  }

  // ── INIT ──────────────────────────────────
  function init() {
    hookIntoSetMainView();

    // speech.js may not have run yet — try immediately, retry once DOM is ready
    if (!hookIntoMicInjection()) {
      document.addEventListener('DOMContentLoaded', hookIntoMicInjection);
    }

    // If already in journal view on load, inject
    document.addEventListener('DOMContentLoaded', () => {
      if (window.mainView === 'journal') injectAnalyseButton();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual calls if needed
  window.analyseJournalEntry  = analyseEntry;
  window.injectAnalyseButton  = injectAnalyseButton;

})();