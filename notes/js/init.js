// nav.js stubs — notes app doesn't use date-driven renders
window.renderTodo  = function() {};
window.renderGoals = function() {};

async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  document.getElementById('app').style.display = 'flex';

  try {
    const [notesData, activeNotesDocIdPref] = await Promise.all([
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
      supabase.getPref('active_notes_doc_id'),
    ]);

    const notesDocs = notesData.data || [];
    window._notesDocs = notesDocs;

    // Seed the desktop notes entries cache
    if (typeof window.initNotesEntries === 'function') window.initNotesEntries(notesDocs);

    // Load active doc into the textarea
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) {
      let resolvedDoc = null;
      if (activeNotesDocIdPref && notesDocs.some(d => d.id === activeNotesDocIdPref)) {
        resolvedDoc = notesDocs.find(d => d.id === activeNotesDocIdPref);
      } else if (notesDocs.length > 0) {
        resolvedDoc = notesDocs[0];
      }
      if (resolvedDoc) {
        if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(resolvedDoc.id);
        if (typeof window.setActiveNotesDocIdInMemory === 'function') window.setActiveNotesDocIdInMemory(resolvedDoc.id);
        notesArea.innerHTML = resolvedDoc.content || '';
      }
      if (typeof updateMobileNoteTitle === 'function') updateMobileNoteTitle();
    }

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  // Init the rich-text toolbar
  if (typeof initNotesToolbar === 'function') initNotesToolbar();

  // Desktop: set notes as the main view and render the side panel
  const isDesktopView = window.matchMedia('(min-width: 768px)').matches;
  if (isDesktopView) {
    mainView = 'notes';
    window.mainView = 'notes';
    if (typeof applyMainView === 'function') applyMainView();
  }

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

window.addEventListener('beforeunload', () => {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
});

initApp();
