// ─────────────────────────────────────────────
//  SPEECH-TO-TEXT  (Web Speech API — free, no keys)
//  Adds 🎤 mic buttons to the journal modal and
//  the notes textarea. Works in Chrome / Edge /
//  Safari 17+. Falls back gracefully elsewhere.
//
//  Features:
//   • Interim results — words appear as you speak
//   • Auto full stop  — inserts ". " after 1.5 s pause
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

  // ── SHARED STATE ──────────────────────────
  let activeRecognition = null;   // currently running SpeechRecognition instance
  let activeMicBtn      = null;   // the button that started it

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
    .stt-mic-icon {
      width: 14px; height: 14px;
      flex-shrink: 0;
    }
    /* Wrapper that sits below a textarea */
    .stt-toolbar {
      display: flex;
      justify-content: flex-end;
      margin-top: 6px;
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

  // ── CORE: create a SpeechRecognition session ──
  /**
   * @param {HTMLTextAreaElement} textarea  – target to append text into
   * @param {HTMLButtonElement}   btn       – the mic button that was clicked
   * @param {function}            [onInput] – optional callback fired after each final result
   * (receives the textarea so callers can trigger save)
   */
  function startListening(textarea, btn, onInput) {
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang            = 'en-US';
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;
    recognition.continuous      = true;

    activeRecognition = recognition;
    activeMicBtn      = btn;

    const PAUSE_MS = 3000;
    let punctuationTimer = null;

    let committedText = textarea.value;
    let currentInterim = '';

    function scheduleFullStop() {
      clearTimeout(punctuationTimer);
      punctuationTimer = setTimeout(() => {
        if (committedText && !/[.!?,;:\n]$/.test(committedText.trimEnd())) {
          committedText = committedText.trimEnd() + '. ';
          
          const spacer = currentInterim && committedText.length > 0 && !/\s$/.test(committedText) ? ' ' : '';
          const updated = committedText + spacer + currentInterim;
          
          textarea.value = updated;
          textarea.setSelectionRange(updated.length, updated.length);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          if (onInput) onInput(textarea);
        }
      }, PAUSE_MS);
    }

    btn.classList.add('stt-listening');
    btn.innerHTML = micSvg() + ' Stop';

    recognition.onresult = (event) => {
      let interim  = '';
      let newFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += transcript;
        } else {
          interim += transcript;
        }
      }

      currentInterim = interim;

      if (newFinal) {
        const spacer = committedText.length > 0 && !/\s$/.test(committedText) ? ' ' : '';
        committedText += spacer + newFinal;
        scheduleFullStop();
      }

      const interimSpacer =
        interim && committedText.length > 0 && !/\s$/.test(committedText) ? ' ' : '';
      textarea.value = committedText + interimSpacer + interim;

      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      if (newFinal && onInput) onInput(textarea);
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech') {
        console.warn('[speech.js] Recognition error:', event.error);
        if (typeof showToast === 'function') showToast('Mic error: ' + event.error);
      }
    };

    recognition.onend = () => {
      clearTimeout(punctuationTimer);
      activeRecognition = null;
      if (activeMicBtn) {
        activeMicBtn.classList.remove('stt-listening');
        activeMicBtn.innerHTML = micSvg() + ' Dictate';
        activeMicBtn = null;
      }
    };

    recognition.start();
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
    btn.title = 'Tap to dictate into the journal entry';

    btn.addEventListener('click', () => startListening(textarea, btn));

    toolbar.appendChild(btn);
    textarea.insertAdjacentElement('afterend', toolbar);
  }

  // ── INJECT: PANEL MIC BUTTON (Desktop Side Panel) ────────────────
  function injectPanelMicButton() {
    const actionsContainer = document.getElementById('side-panel-actions');
    if (!actionsContainer) return;

    // Avoid duplicate buttons
    if (document.getElementById('panel-mic-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'panel-mic-btn';
    btn.type = 'button';
    btn.className = 'stt-mic-btn panel-action-btn';
    btn.style.marginRight = '4px';
    btn.innerHTML = micSvg() + ' Dictate';
    btn.title = 'Tap to dictate into the note / journal entry';

    btn.addEventListener('click', () => {
      const textarea = document.getElementById('notes-textarea');
      if (textarea) startListening(textarea, btn);
    });

    // Insert before the existing add button
    const addBtn = document.getElementById('panel-add-btn');
    if (addBtn) {
      actionsContainer.insertBefore(btn, addBtn);
    } else {
      actionsContainer.appendChild(btn);
    }
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
      if (!modal.classList.contains('open') && activeRecognition) {
        activeRecognition.stop();
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  // ── INIT ──────────────────────────────────
  function init() {
    watchJournalModal();
    watchJournalModalClose();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.sttInit = init;
  window.injectPanelMicButton = injectPanelMicButton;

})();