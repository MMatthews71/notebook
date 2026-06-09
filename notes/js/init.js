// nav.js stubs — notes app doesn't use date-driven renders
window.renderTodo  = function() {};
window.renderGoals = function() {};

async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  document.getElementById('app').style.display = 'flex';

  let resolvedDoc = null;

  try {
    const [notesData, activeNotesDocIdPref] = await Promise.all([
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
      supabase.getPref('active_notes_doc_id'),
    ]);

    const notesDocs = notesData.data || [];
    window._notesDocs = notesDocs;

    // Seed the desktop notes entries cache
    if (typeof window.initNotesEntries === 'function') window.initNotesEntries(notesDocs);

    // Resolve which doc/entry is active
    if (activeNotesDocIdPref && notesDocs.some(d => d.id === activeNotesDocIdPref)) {
      resolvedDoc = notesDocs.find(d => d.id === activeNotesDocIdPref);
    } else if (notesDocs.length > 0) {
      resolvedDoc = notesDocs[0];
    }

    if (resolvedDoc) {
      if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(resolvedDoc.id);
      if (typeof window.setActiveNotesDocIdInMemory === 'function') window.setActiveNotesDocIdInMemory(resolvedDoc.id);
    }

    // Load active doc into the textarea (mobile path — desktop handled via applyMainView below)
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea && resolvedDoc) {
      notesArea.innerHTML = resolvedDoc.content || '';
    }

    if (typeof updateMobileNoteTitle === 'function') updateMobileNoteTitle();

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  // Init the rich-text toolbar
  if (typeof initNotesToolbar === 'function') initNotesToolbar();

  // Always set mainView = 'notes' — this is a dedicated notes app.
  // Without it the input listener in desktop.js returns early and
  // typing on mobile is never saved in real-time.
  mainView = 'notes';
  window.mainView = 'notes';

  // Set activeNotesEntryId on ALL devices so the entry-based save path
  // fires from the very first keystroke (desktop.js input listener uses it).
  if (resolvedDoc && typeof activeNotesEntryId !== 'undefined') {
    activeNotesEntryId = resolvedDoc.id;
  }

  // Desktop only: lay out the split view and populate the side panel.
  const isDesktopView = window.matchMedia('(min-width: 768px)').matches;
  if (isDesktopView) {
    if (typeof applyMainView === 'function') applyMainView();
  }

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

window.addEventListener('beforeunload', () => {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
});

initApp();
