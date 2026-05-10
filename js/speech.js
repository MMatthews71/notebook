// ─────────────────────────────────────────────
//  SPEECH-TO-TEXT  (Web Speech API — free, no keys)
//  Adds 🎤 mic buttons to the journal modal and
//  the notes textarea. Works in Chrome / Edge /
//  Safari 17+. Falls back gracefully elsewhere.
//
//  Features:
//   • en-AU locale for Australian accents
//   • Interim results — words appear as you speak
//   • Voice punctuation commands (see VOICE_COMMANDS below)
//   • Auto-capitalise after sentence endings
//   • Corrections map — fixes common mishearings
//   • maxAlternatives: 3 — picks highest-confidence guess
//   • Overlap guard on auto-restart
//   • Auto full stop after 2.5 s pause
// ─────────────────────────────────────────────

(function () {
  'use strict';

  // ── FEATURE DETECT ────────────────────────
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[speech.js] Web Speech API not supported in this browser.');
    return;
  }

  // ── VOICE PUNCTUATION COMMANDS ────────────
  // Say any of these (case-insensitive) as a standalone phrase to insert
  // the corresponding text.  Matched against the full trimmed transcript.
  const VOICE_COMMANDS = {
    'comma':             ',',
    'full stop':         '. ',
    'period':            '. ',
    'question mark':     '? ',
    'exclamation mark':  '! ',
    'exclamation point': '! ',
    'new line':          '\n',
    'new paragraph':     '\n\n',
    'dash':              ' — ',
    'hyphen':            '-',
    'colon':             ': ',
    'semicolon':         '; ',
    'open bracket':      ' (',
    'close bracket':     ')',
    'open parenthesis':  ' (',
    'close parenthesis': ')',
    'delete that':       '__DELETE_LAST__',
    'scratch that':      '__DELETE_LAST__',
    'undo that':         '__DELETE_LAST__',
  };

  // ── CORRECTIONS MAP ───────────────────────
  // Common mishearings — especially with Australian vowel sounds.
  // Applied to each final transcript chunk (word-boundary aware).
  // Add your own pairs here as you notice patterns.
  //
  // Format: 'misheard phrase' → 'intended phrase'
  // Keys are matched as whole words (case-insensitive).
  const CORRECTIONS = {
    // Australian vowel / accent traps
    'day today':    'day today',     // keep (just in list for reference)
    'to die':       'today',
    'to day':       'today',
    'to night':     'tonight',
    'to morrow':    'tomorrow',
    'arv oh':       'arvo',
    'arv o':        'arvo',
    'ar vo':        'arvo',
    // Common short-word confusion
    'i':            'I',             // sometimes dropped capitalisation
    'i\'m':         "I'm",
    'i\'ve':        "I've",
    'i\'ll':        "I'll",
    'i\'d':         "I'd",
    "i am":         "I am",
    "i was":        "I was",
    "i have":       "I have",
    "i will":       "I will",
    "i would":      "I would",
    "i think":      "I think",
    "i feel":       "I feel",
    "i know":       "I know",
    "i need":       "I need",
    "i want":       "I want",
    "i can":        "I can",
    "i could":      "I could",
    "i should":     "I should",
    "i just":       "I just",
    "i really":     "I really",
    "i don't":      "I don't",
    "i didn't":     "I didn't",
    "i wasn't":     "I wasn't",
    "i haven't":    "I haven't",
    "i can't":      "I can't",
    "i won't":      "I won't",
    "i couldn't":   "I couldn't",
    // Frequently garbled words
    'their':        'their',         // keep — can't reliably fix there/their/they're
    'gonna':        'going to',
    'wanna':        'want to',
    'gotta':        'got to',
    'kinda':        'kind of',
    'sorta':        'sort of',
    'lotta':        'lot of',
    'coulda':       'could have',
    'shoulda':      'should have',
    'woulda':       'would have',
    // Numbers sometimes heard as words
    'won':          'one',           // only safe in isolation — see applyCorrections logic
    // Punctuation words that slip through
    'full stop':    '.',
    'comma':        ',',
  };

  // ── SHARED STATE ──────────────────────────
  //
  // ★ KEY DESIGN: one SpeechRecognition instance lives for the whole page session.
  //    Auto-restarts call .start() on the SAME object — the browser treats this as
  //    a continuation of the same permission grant, so no re-prompt ever appears.
  //    A new instance is only created on the very first click after page load.

  let recognition    = null;   // the single persistent instance
  let activeMicBtn   = null;
  let userStopped    = false;

  // Per-session state (reset on each new startListening call)
  let activeTextarea   = null;
  let activeOnInput    = null;
  let committedText    = '';
  let currentInterim   = '';
  let punctuationTimer = null;
  const PAUSE_MS       = 2500;

  // ── OLLAMA CONFIG ─────────────────────────
  // Requires Ollama running locally: https://ollama.com
  // Pull the model once with:  ollama pull llama3.2:1b
  // If you get a CORS error, start Ollama with:
  //   OLLAMA_ORIGINS="*" ollama serve
  const OLLAMA_BASE  = 'http://localhost:11434';
  const OLLAMA_URL   = OLLAMA_BASE + '/api/generate';

  // ── MODEL AUTO-DETECT ─────────────────────
  // Preferred models in priority order — first one found installed wins.
  const MODEL_PRIORITY = [
    'llama3.2',      // 3b — best balance of quality and speed for this task
    'llama3.1:8b',
    'llama3:8b',
    'mistral',
    'llama3.2:1b',   // 1b — fallback only; too small to follow instructions reliably
    'phi3:mini',
    'phi3',
    'gemma2:2b',
    'gemma:2b',
  ];

  let OLLAMA_MODEL = null; // resolved at first Polish click

  async function resolveModel() {
    if (OLLAMA_MODEL) return OLLAMA_MODEL;
    try {
      const res  = await fetch(OLLAMA_BASE + '/api/tags');
      const data = await res.json();
      const installed = (data.models || []).map(m => m.name);
      console.log('[speech.js] Ollama models installed:', installed);
      for (const preferred of MODEL_PRIORITY) {
        if (installed.some(n => n === preferred || n.startsWith(preferred.split(':')[0]))) {
          OLLAMA_MODEL = preferred.split(':')[0] === installed.find(n => n.startsWith(preferred.split(':')[0])).split(':')[0]
            ? installed.find(n => n.startsWith(preferred.split(':')[0]))
            : preferred;
          OLLAMA_MODEL = installed.find(n => n.startsWith(preferred.split(':')[0]));
          console.log('[speech.js] Selected model:', OLLAMA_MODEL);
          return OLLAMA_MODEL;
        }
      }
      if (installed.length > 0) {
        OLLAMA_MODEL = installed[0];
        console.log('[speech.js] Falling back to first available model:', OLLAMA_MODEL);
        return OLLAMA_MODEL;
      }
      throw new Error('No models installed in Ollama. Run: ollama pull llama3.2:1b');
    } catch (err) {
      if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
        throw new Error('Cannot reach Ollama. Make sure it\'s running:\n  ollama serve\n\nIf you see a CORS error:\n  OLLAMA_ORIGINS="*" ollama serve');
      }
      throw err;
    }
  }

  // ── STYLES ────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .stt-mic-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--border, #333);
      background: transparent;
      color: var(--text-2, #ccc);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      flex-shrink: 0;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .stt-mic-btn:hover {
      background: rgba(126,255,168,0.07);
      border-color: var(--mint, #7effa8);
      color: var(--mint, #7effa8);
    }
    .stt-mic-btn.stt-listening {
      background: rgba(240,80,80,0.12);
      border-color: #f05050;
      color: #f07070;
      animation: stt-pulse 1.2s ease-in-out infinite;
    }
    @keyframes stt-pulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(240,80,80,0.35); }
      50%      { box-shadow: 0 0 0 6px rgba(240,80,80,0); }
    }
    .stt-mic-icon { width: 14px; height: 14px; flex-shrink: 0; }
    .stt-toolbar  { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
    .stt-polish-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--border, #333);
      background: transparent;
      color: var(--text-2, #ccc);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      flex-shrink: 0;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .stt-polish-btn:hover:not(:disabled) {
      background: rgba(180,130,255,0.1);
      border-color: #b482ff;
      color: #b482ff;
    }
    .stt-polish-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .stt-polish-btn.stt-polishing {
      border-color: #b482ff;
      color: #b482ff;
      animation: stt-pulse-purple 1.4s ease-in-out infinite;
    }
    @keyframes stt-pulse-purple {
      0%,100% { box-shadow: 0 0 0 0 rgba(180,130,255,0.35); }
      50%      { box-shadow: 0 0 0 6px rgba(180,130,255,0); }
    }
  `;
  document.head.appendChild(style);

  // ── MIC ICON SVG ──────────────────────────
  function micSvg() {
    return `<svg class="stt-mic-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/>
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="8"  y1="22" x2="16" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  // ── SPARKLE ICON SVG ──────────────────────
  function sparkleSvg() {
    return `<svg class="stt-mic-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L13.5 9 L20 12 L13.5 15 L12 22 L10.5 15 L4 12 L10.5 9 Z" fill="currentColor"/>
      <path d="M19 2 L19.8 5.2 L23 6 L19.8 6.8 L19 10 L18.2 6.8 L15 6 L18.2 5.2 Z" fill="currentColor" opacity="0.7"/>
    </svg>`;
  }

  // ── STT PRE-PROCESSOR ────────────────────
  /**
   * Mechanical fixes applied BEFORE sending to Ollama.
   * Handles patterns that are reliably wrong and don't need AI judgement.
   */
  function preprocessSTT(text) {
    let t = text;

    // 1. Collapse repeated consecutive words: "do do do" → "do", "the the" → "the"
    t = t.replace(/\b(\w+)(?:\s+\1){1,3}\b/gi, '$1');

    // 2. Stray single letters mid-sentence: "I wish h I" → "I wish I"
    t = t.replace(/\b([A-Za-z]{2,})\s+[b-hj-z]\s+([A-Z])/g, '$1 $2');

    // 3. Self-correction collapsed: "numbing behaves. Behavior." → "numbing behavior."
    //    When a 1-word sentence immediately follows and looks like a restatement,
    //    replace the bad word with the correction.
    t = t.replace(/(\w+)\.\s+([A-Z][a-z]+)\./g, (match, bad, correction) => {
      // Only collapse if the correction is a single word (speaker correcting themselves)
      if (!correction.includes(' ')) {
        return correction.toLowerCase() + '.';
      }
      return match;
    });

    // 4. Remove dangling restarts: "I wish him" (speaker restarted the sentence)
    t = t.replace(/\bI wish him\.?\s*/gi, '');

    // 5. Trailing background-noise block — truncate from first noise sentence onward
    const noisePattern = /\b(OK Google|calories|Capital One|Ghana|Harrison \d{4}|pound of fat|top.?less podcast|passionate kiss)\b/i;
    const sentences = t.split(/(?<=[.!?])\s+/);
    const noiseStart = sentences.findIndex(s => noisePattern.test(s));
    if (noiseStart !== -1) {
      t = sentences.slice(0, noiseStart).join(' ').trim();
    }

    // 6. Collapse extra spaces left by removals
    t = t.replace(/\s{2,}/g, ' ').trim();

    return t;
  }

  // ── OLLAMA POLISH ─────────────────────────
  /**
   * Send textarea content to a local Ollama instance for cleanup.
   * Fixes STT errors, punctuation, paragraph breaks, and removes noise —
   * while preserving the writer's voice and all meaningful content.
   */
  async function polishWithLlama(textarea, btn, onInput) {
    const raw = textarea.value.trim();
    if (!raw) {
      notify('Nothing to polish yet.');
      return;
    }

    btn.disabled = true;
    btn.classList.add('stt-polishing');
    btn.innerHTML = sparkleSvg() + ' Polishing…';

    // Run mechanical fixes first — repeated words, noise, stray letters, etc.
    const preprocessed = preprocessSTT(raw);

    const prompt = `You are a transcription editor. You will be given a raw speech-to-text journal entry. You must output a cleaned version.

=== STRICT RULES — follow every one exactly ===

RULE 1 — RESTORE DROPPED "I"
Speech-to-text often drops the word "I" at the start of sentences. If a sentence starts with a verb that only makes sense with a subject, restore "I".
  "Don't know what to do." → "I don't know what to do."
  "Need to work for a while." → "I need to work for a while."
  "Learned a lot." → "I learned a lot."
  "Feel like I'm enough." → "I feel like I'm enough."
  "Stopped feeling like I have to perform." → "I stopped feeling like I have to perform."

RULE 2 — REJOIN SPLIT SENTENCES
The transcriber inserted full stops mid-sentence when the speaker paused. If two consecutive sentences form one complete thought when joined, join them and fix capitalisation.
  "I've managed to. Achieve what I wanted." → "I've managed to achieve what I wanted."
  "At the core of everything. Is the feeling of not being good enough." → "At the core of everything is the feeling of not being good enough."
  "Just need to. Relax." → "Just need to relax."
  "Really. Start to focus on other people." → "Really start to focus on other people."
  TEST: would a fluent English speaker ever end a sentence on that word? If no → rejoin.

RULE 3 — DO NOT REJOIN SEPARATE THOUGHTS
If both sentences can stand alone as complete thoughts, keep them separate.
  "I think. This is proof I can be loved." → keep as two sentences ← "I think." is a deliberate pause

RULE 4 — FIX OBVIOUS MISHEARINGS ONLY
Fix a word only if it clearly makes no sense and you are certain of the intended word.
  "far more easier" → "far easier"
  "It's only happen" → "It's only happened"
  Do NOT change words you are merely unsure about. Leave them as-is.

RULE 5 — DO NOT REWRITE ANYTHING
  Do NOT rephrase, restructure, improve, or summarise.
  Do NOT remove any words except clear noise.
  Do NOT change the meaning or emotional tone.
  Do NOT add words that weren't there (except restoring dropped "I" per Rule 1).

RULE 6 — ADD PARAGRAPH BREAKS
Insert a blank line when the topic or mood clearly shifts. Typical shift points:
  - from practical/logistical thoughts to emotional feelings
  - from talking about one person to another topic
  - from anxiety to reflection
  - from describing a situation to drawing a conclusion
  Do NOT add a break in the middle of a continuous thought.

RULE 7 — NO PREAMBLE
Output ONLY the cleaned text. Do not write anything before or after it. Do not say "Here is the cleaned version of the journal entry:" or any similar preamble.

=== TEXT TO CLEAN ===
${preprocessed}`;

    try {
      const model = await resolveModel();

      // ── WARM-UP: load the model into memory before the real request ──
      // Ollama lazy-loads on first use — this blocks until it's ready.
      try {
        btn.innerHTML = sparkleSvg() + ' Loading model…';
        console.log('[speech.js] Warming up model:', model);
        const warmRes = await fetch(OLLAMA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: 'hi', stream: false, keep_alive: -1 }),
          signal: AbortSignal.timeout(90000), // up to 90s for cold load
        });
        if (!warmRes.ok) console.warn('[speech.js] Warm-up responded', warmRes.status, '— continuing anyway');
        else console.log('[speech.js] Model warm-up complete.');
      } catch (e) {
        console.warn('[speech.js] Warm-up failed:', e.message, '— continuing anyway');
      }

      btn.innerHTML = sparkleSvg() + ' Polishing…';

      // Model is already loaded — no timeout needed, just let it stream
      console.log('[speech.js] Sending to Ollama:', OLLAMA_URL, 'model:', model);

      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  model,
          prompt: prompt,
          stream: true,
          keep_alive: -1,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama returned ${res.status}: ${body}`);
      }

      // ── Stream tokens into textarea as they arrive ──────────────────
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   cleaned = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Ollama streams newline-delimited JSON objects
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.response) {
              cleaned += obj.response;
              // Live-update textarea so user sees text appearing word by word
              textarea.value = cleaned;
              textarea.scrollTop = textarea.scrollHeight;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (obj.done) break;
          } catch {
            // Incomplete JSON chunk — will be completed in the next read
          }
        }
      }

      cleaned = cleaned.trim();
      console.log('[speech.js] Ollama stream complete, length:', cleaned.length);

      if (!cleaned) throw new Error('Ollama returned an empty response — is the model loaded?');

      textarea.value = cleaned;
      textarea.scrollTop = textarea.scrollHeight;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (onInput) onInput(textarea);

      notify('Journal polished ✨');

    } catch (err) {
      console.error('[speech.js] Ollama polish failed:', err);

      let msg;
      if (err.name === 'AbortError') {
        msg = 'Ollama timed out — the model may still be loading. Try again in a moment.';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        msg = 'Cannot reach Ollama. Make sure it\'s running:\n  ollama serve\n\nIf you get a CORS error, use:\n  OLLAMA_ORIGINS="*" ollama serve';
      } else {
        msg = 'Polish failed: ' + err.message;
      }

      notify(msg);
    } finally {
      btn.disabled = false;
      btn.classList.remove('stt-polishing');
      btn.innerHTML = sparkleSvg() + ' Polish';
    }
  }

  /** Show a toast if available, otherwise fall back to console + alert for errors. */
  function notify(msg) {
    console.log('[speech.js]', msg);
    if (typeof showToast === 'function') {
      showToast(msg);
    } else {
      // showToast not available — use alert so the message is visible
      alert(msg);
    }
  }

  /** Capitalise the first letter of a string (leaves rest intact). */
  function capitaliseFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * After a sentence-ending punctuation + space, capitalise the next word.
   * Also capitalises the very first character if text starts uncapitalised.
   */
  function autoCapitalise(text) {
    // Capitalise first char of whole text
    text = text.replace(/^([a-z])/, c => c.toUpperCase());
    // Capitalise after ". ", "? ", "! ", ".\n", "?\n", "!\n"
    text = text.replace(/([.?!][\s\n]+)([a-z])/g, (_, punct, letter) => punct + letter.toUpperCase());
    return text;
  }

  /**
   * Apply the CORRECTIONS map to a transcript string.
   * Only replaces whole-word occurrences (case-insensitive).
   * Preserves original capitalisation for single-capital corrections (like "I").
   */
  function applyCorrections(text) {
    let result = text;
    for (const [wrong, right] of Object.entries(CORRECTIONS)) {
      // Skip entries that are identical (used as documentation markers)
      if (wrong === right) continue;
      // Skip punctuation-word entries — those are handled by voice commands
      if ([',', '.'].includes(right)) continue;

      const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
      result = result.replace(re, match => {
        // If replacement starts uppercase and match started uppercase, keep it
        if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
          return capitaliseFirst(right);
        }
        return right;
      });
    }
    return result;
  }

  /**
   * Check if `chunk` is a voice command.
   * Returns the replacement string, '__DELETE_LAST__', or null if not a command.
   */
  function matchVoiceCommand(chunk) {
    const key = chunk.trim().toLowerCase();
    return VOICE_COMMANDS[key] ?? null;
  }

  /**
   * Delete the last "sentence" from committedText (back to the last ". " / "! " / "? " or start).
   */
  function deleteLastSentence(text) {
    const trimmed = text.trimEnd();
    // Remove trailing punctuation block first
    const stripped = trimmed.replace(/[.!?,;:\s]+$/, '');
    const lastPunct = Math.max(
      stripped.lastIndexOf('. '),
      stripped.lastIndexOf('! '),
      stripped.lastIndexOf('? '),
      stripped.lastIndexOf('\n'),
    );
    if (lastPunct === -1) return '';
    return stripped.slice(0, lastPunct + 2); // keep the terminator + space
  }

  /**
   * Pick the best alternative from a SpeechRecognitionResult
   * (highest confidence; falls back to index 0 if confidence is 0 everywhere).
   */
  function bestAlternative(result) {
    let best = result[0];
    for (let i = 1; i < result.length; i++) {
      if ((result[i].confidence || 0) > (best.confidence || 0)) {
        best = result[i];
      }
    }
    return best.transcript;
  }

  /**
   * Strip any prefix of `chunk` that already appears at the end of `committed`
   * (guards against the restart-loop duplicating the last phrase).
   */
  function stripOverlap(committed, chunk) {
    const c = committed.trimEnd().toLowerCase();
    const k = chunk.trimStart().toLowerCase();
    // Try progressively shorter suffixes of `committed` as prefixes of `chunk`
    const maxCheck = Math.min(c.length, k.length, 80);
    for (let len = maxCheck; len >= 6; len--) {
      const suffix = c.slice(-len);
      if (k.startsWith(suffix)) {
        return chunk.slice(len).trimStart();
      }
    }
    return chunk;
  }

  // ── CORE: create a SpeechRecognition session ──
  /**
   * @param {HTMLTextAreaElement} textarea  – target to append text into
   * @param {HTMLButtonElement}   btn       – the mic button that was clicked
   * @param {function}            [onInput] – optional callback fired after each final result
   */
  // ── CORE: start / stop dictation ─────────
  /**
   * @param {HTMLTextAreaElement} textarea  – target to append text into
   * @param {HTMLButtonElement}   btn       – the mic button that was clicked
   * @param {function}            [onInput] – optional callback after each final result
   */
  function startListening(textarea, btn, onInput) {
    // ── STOP (user clicked while already listening) ──────────────────
    if (recognition && !userStopped && activeMicBtn) {
      userStopped = true;
      recognition.stop();
      return;
    }

    // ── START ────────────────────────────────────────────────────────
    userStopped     = false;
    activeMicBtn    = btn;
    activeTextarea  = textarea;
    activeOnInput   = onInput || null;
    committedText   = textarea.value;
    currentInterim  = '';
    clearTimeout(punctuationTimer);

    btn.classList.add('stt-listening');
    btn.innerHTML = micSvg() + ' Stop';

    // ★ Create the instance only once for the whole page session.
    //   Reusing it means the browser never re-prompts for mic permission.
    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.lang            = 'en-AU';
      recognition.interimResults  = true;
      recognition.maxAlternatives = 3;
      recognition.continuous      = true;

      // ── handlers are set up once and reference module-level state ──

      recognition.onresult = (event) => {
        let interim  = '';
        let newFinal = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result     = event.results[i];
          const transcript = bestAlternative(result);
          if (result.isFinal) newFinal += transcript;
          else                interim  += transcript;
        }

        currentInterim = interim;

        if (newFinal) {
          const deduped = stripOverlap(committedText, newFinal);
          if (deduped.trim()) {
            const cmd = matchVoiceCommand(deduped);
            if (cmd === '__DELETE_LAST__') {
              committedText = deleteLastSentence(committedText);
            } else if (cmd !== null) {
              committedText = committedText.trimEnd() + cmd;
            } else {
              const corrected = applyCorrections(deduped);
              const spacer    = committedText.length > 0 && !/\s$/.test(committedText) ? ' ' : '';
              committedText  += spacer + corrected;
            }
          }
          committedText = autoCapitalise(committedText);
          scheduleFullStop();
          if (activeOnInput) activeOnInput(activeTextarea);
        }

        const interimSpacer =
          interim && committedText.length > 0 && !/\s$/.test(committedText) ? ' ' : '';
        updateTextarea(committedText + interimSpacer + interim);
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech') return;
        console.warn('[speech.js] Recognition error:', event.error);
        if (typeof showToast === 'function') showToast('Mic error: ' + event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          userStopped = true;
        }
      };

      recognition.onend = () => {
        clearTimeout(punctuationTimer);

        if (userStopped) {
          // User deliberately stopped — reset button
          if (activeMicBtn) {
            activeMicBtn.classList.remove('stt-listening');
            activeMicBtn.innerHTML = micSvg() + ' Dictate';
            activeMicBtn = null;
          }
        } else if (activeMicBtn && document.body.contains(activeMicBtn)) {
          // ★ Auto-restart on the SAME instance — no new permission prompt
          setTimeout(() => recognition.start(), 100);
        }
      };
    }

    recognition.start();
  }

  function updateTextarea(value) {
    if (!activeTextarea) return;
    activeTextarea.value = value;
    activeTextarea.setSelectionRange(value.length, value.length);
    // ★ Keep the latest text in view while dictating
    activeTextarea.scrollTop = activeTextarea.scrollHeight;
    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scheduleFullStop() {
    clearTimeout(punctuationTimer);
    punctuationTimer = setTimeout(() => {
      if (committedText && !/[.!?,;:\n]$/.test(committedText.trimEnd())) {
        committedText = committedText.trimEnd() + '. ';
        updateTextarea(committedText + currentInterim);
        if (activeOnInput) activeOnInput(activeTextarea);
      }
    }, PAUSE_MS);
  }

  // ── INJECT: JOURNAL MODAL ─────────────────
  function injectJournalMic() {
    const modal = document.getElementById('journal-modal');
    if (!modal || modal.dataset.sttInjected) return;
    modal.dataset.sttInjected = '1';

    const textarea = document.getElementById('journal-content');
    if (!textarea) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'stt-toolbar';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stt-mic-btn';
    btn.innerHTML = micSvg() + ' Dictate';
    btn.title = 'Tap to dictate. Say "comma", "full stop", "new paragraph" etc. for punctuation.';

    btn.addEventListener('click', () => startListening(textarea, btn));

    toolbar.appendChild(btn);
    textarea.insertAdjacentElement('afterend', toolbar);
  }

  // ── WATCH FOR JOURNAL MODAL OPEN ─────────
  function watchJournalModal() {
    const modal = document.getElementById('journal-modal');
    if (!modal) return;
    const obs = new MutationObserver(() => {
      if (modal.classList.contains('open')) injectJournalMic();
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    if (modal.classList.contains('open')) injectJournalMic();
  }

  // ── STOP MIC WHEN JOURNAL MODAL CLOSES ───
  function watchJournalModalClose() {
    const modal = document.getElementById('journal-modal');
    if (!modal) return;
    const obs = new MutationObserver(() => {
      if (!modal.classList.contains('open') && recognition && activeMicBtn) {
        userStopped = true;
        recognition.stop();
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  // ── INIT ──────────────────────────────────
  // ── MODEL PRELOAD ─────────────────────────
  // Silently resolve + warm up the model in the background on page load
  // so the first Polish click is instant.
  async function preloadModel() {
    try {
      const model = await resolveModel();
      console.log('[speech.js] Preloading model:', model);
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'hi', stream: false, keep_alive: -1 }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) console.log('[speech.js] Model preloaded and kept alive:', model);
    } catch (e) {
      // Ollama may not be running yet — silent fail, warm-up on first click instead
      console.log('[speech.js] Model preload skipped:', e.message);
    }
  }

  function init() {
    watchJournalModal();
    watchJournalModalClose();
    preloadModel(); // fire-and-forget: loads model in background on page start
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.sttInit = init;

})();