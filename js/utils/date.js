// ─────────────────────────────────────────────
//  DATE UTILITIES
// ─────────────────────────────────────────────

/**
 * Get today's date as YYYY-MM-DD string
 */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Get the active date as YYYY-MM-DD string
 * Uses the global activeDate variable
 */
function getActiveDateStr() {
  return `${activeDate.getFullYear()}-${String(activeDate.getMonth()+1).padStart(2,'0')}-${String(activeDate.getDate()).padStart(2,'0')}`;
}

/**
 * Format a due date string for display
 * @param {string} dStr - Date string in YYYY-MM-DD format
 * @returns {string} Formatted date string (Today, Tomorrow, Yesterday, Xd overdue, or short date)
 */
function formatDue(dStr) {
  const d = new Date(dStr+'T00:00:00'), t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((d-t)/86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}
