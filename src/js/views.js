// ── arXiv category labels ──
import { togglePanel } from '/js/core/core-nav.js';
export const ARXIV_CAT_NAMES = {
  'cs.AI':'Artificial Intelligence','cs.AR':'Hardware Architecture','cs.CC':'Computational Complexity',
  'cs.CE':'Computational Engineering','cs.CG':'Computational Geometry','cs.CL':'Computation and Language',
  'cs.CR':'Cryptography and Security','cs.CV':'Computer Vision and Pattern Recognition',
  'cs.CY':'Computers and Society','cs.DB':'Databases','cs.DC':'Distributed Computing',
  'cs.DL':'Digital Libraries','cs.DM':'Discrete Mathematics','cs.DS':'Data Structures and Algorithms',
  'cs.ET':'Emerging Technologies','cs.FL':'Formal Languages and Automata Theory',
  'cs.GL':'General Literature','cs.GR':'Graphics','cs.GT':'Computer Science and Game Theory',
  'cs.HC':'Human-Computer Interaction','cs.IR':'Information Retrieval','cs.IT':'Information Theory',
  'cs.LG':'Machine Learning','cs.LO':'Logic in Computer Science','cs.MA':'Multiagent Systems',
  'cs.MM':'Multimedia','cs.MS':'Mathematical Software','cs.NA':'Numerical Analysis',
  'cs.NE':'Neural and Evolutionary Computing','cs.NI':'Networking and Internet Architecture',
  'cs.OH':'Other Computer Science','cs.OS':'Operating Systems','cs.PF':'Performance',
  'cs.PL':'Programming Languages','cs.RO':'Robotics','cs.SC':'Symbolic Computation',
  'cs.SD':'Sound','cs.SE':'Software Engineering','cs.SI':'Social and Information Networks',
  'cs.SY':'Systems and Control',
  'stat.ML':'Machine Learning (Statistics)','stat.TH':'Statistics Theory',
  'stat.ME':'Methodology','stat.AP':'Applications','stat.CO':'Computation',
  'math.OC':'Optimization and Control','math.ST':'Statistics Theory',
  'eess.IV':'Image and Video Processing','eess.AS':'Audio and Speech Processing',
  'eess.SP':'Signal Processing','eess.SY':'Systems and Control',
  'q-bio.QM':'Quantitative Methods','q-bio.NC':'Neurons and Cognition',
  'physics.comp-ph':'Computational Physics','cond-mat.dis-nn':'Disordered Systems and Neural Networks',
};

// ── Topbar overflow (three-dots menu) ──
export const _topbarOverflowRO = null;

export function _closeTopbarOverflow() {
  const menu = document.getElementById('topbar-overflow-menu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('click', _topbarOverflowOutside);
}

export function _topbarOverflowOutside(e) {
  const wrap = document.getElementById('topbar-overflow-wrap');
  if (wrap && !wrap.contains(e.target)) _closeTopbarOverflow();
}

// ── Paper Viewer (shared) ──
export const paperViewOrigin = 'arxiv';

export let _currentPaperViewPaper = null;
export function setCurrentPaperViewPaper(v) { _currentPaperViewPaper = v; }
export const _paperOriginExpId = null;
export const _paperInsightsLoaded = false;
export function toggleBrowseSidebar() {
  togglePanel();
}

// ── Paper sidebar moved to paper-sidebar.js ──

// ── Document chat moved to chat-threads.js ──

// ── Panel system moved to panel.js ──

// ── Mobile Paper Sidebar ──

// ── Action registry ──
registerActions({
  toggleBrowseSidebar: () => toggleBrowseSidebar(),
});

