import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sun, CircleCheck, CalendarDays, BookOpen, ChartNoAxesCombined, PanelLeft, Plus, ArrowRight, Mic, ChevronLeft, ChevronRight, Play, Pause, X, Settings, UserCircle, Sparkles, Clock3, Check, Search } from 'lucide-react';
import './style.css';

const mountain = new URL('../../shared/mountain.png', import.meta.url).href;
const navigation = [
  ['Today', Sun], ['Tasks', CircleCheck], ['Calendar', CalendarDays],
  ['Journal', BookOpen], ['Review', ChartNoAxesCombined],
];
const day = [
  { time: '10:30', title: 'Design catch-up', detail: '30 min · Maya Chen', icon: CalendarDays },
  { time: '09:10', title: 'Weekly priorities outlined', detail: 'Task completed · Studio', icon: Check },
  { time: '08:45', title: 'A slower start', detail: 'Journal · Demo entry', icon: BookOpen },
];

function IconButton({ icon: Icon, label, onClick, ...props }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick} {...props}><Icon size={16} strokeWidth={1.5} /></button>;
}

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [page, setPage] = useState('Today');
  const [focus, setFocus] = useState(false);
  const [remaining, setRemaining] = useState(50 * 60);
  const [modal, setModal] = useState(null);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState('');
  const [captures, setCaptures] = useState([]);
  const [dayOffset, setDayOffset] = useState(0);
  const [search, setSearch] = useState('');
  const opener = useRef(null);
  const dialogRef = useRef(null);
  const date = new Date(2026, 9, 6 + dayOffset);
  const dateLabel = date.toLocaleDateString('en-AU', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    if (!focus) return;
    const timer = window.setInterval(() => setRemaining(r => {
      if (r <= 1) { setFocus(false); return 0; }
      return r - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [focus]);

  useEffect(() => {
    if (!modal) return;
    const dialog = dialogRef.current;
    dialog.querySelector('button, input, textarea')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { setModal(null); opener.current?.focus(); }
      if (e.key === 'Tab') {
        const nodes = [...dialog.querySelectorAll('button, input, textarea')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);

  function open(name) { opener.current = document.activeElement; setModal(name); }
  function close() { setModal(null); opener.current?.focus(); }
  function saveCapture(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setCaptures(v => [...v, draft.trim()]);
    setDraft('');
    close();
    setPage('Journal');
  }

  const metrics = [
    { icon: CircleCheck, value: `${done ? 4 : 3} / 8`, label: 'Tasks', target: 'Tasks' },
    { icon: Clock3, value: '2h 15m', label: 'Open time', target: 'Calendar' },
    { icon: BookOpen, value: String(1 + captures.length), label: 'Journal', target: 'Journal' },
  ];

  return <div className={`app ${collapsed ? 'collapsed' : ''}`}>
    <div className="landscape" style={{ backgroundImage: `url("${mountain}")` }} />
    <aside className="sidebar">
      <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
      <IconButton icon={PanelLeft} label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(v => !v)} />
      <div className="brand"><span>LIFEOS</span><small>Your personal space</small></div>
      <nav aria-label="Main navigation">{navigation.map(([name, Icon]) => <button className={`nav-item ${page === name ? 'selected' : ''}`} key={name} onClick={() => setPage(name)} title={name} aria-current={page === name ? 'page' : undefined}><Icon size={16} strokeWidth={1.4} /><span>{name}</span></button>)}</nav>
      <div className="pinned"><small>PINNED</small><button onClick={() => open('quiet')}><Sparkles size={15} strokeWidth={1.4} /><span>A quieter morning</span></button></div>
      <div className="sidebar-bottom">
        <button className="new-capture" onClick={() => open('capture')} title="New capture"><Plus size={17} strokeWidth={1.4} /><span>New capture</span><kbd>⌘N</kbd></button>
        <div className="sync"><b /> <span>Interactive study</span><small>No services connected</small></div>
        <div className="account"><UserCircle size={17} strokeWidth={1.4} /><span>Avi</span><IconButton icon={Settings} label="Prototype information" onClick={() => open('settings')} /></div>
      </div>
    </aside>
    <main>
      <header><span>{page}</span><div className="header-actions"><IconButton icon={ChevronLeft} label="Previous day" onClick={() => setDayOffset(v => v - 1)} /><span className="date">{dateLabel}</span><IconButton icon={ChevronRight} label="Next day" onClick={() => setDayOffset(v => v + 1)} /><i /><IconButton icon={Search} label="Search this prototype" onClick={() => open('search')} /><IconButton icon={Mic} label="Capture a thought" onClick={() => open('capture')} /></div></header>
      {page === 'Today' ? <>
        <section className="hero" aria-label="Your day at a glance">
          <div className="metrics">{metrics.map(({ icon: Icon, value, label, target }) => <button key={label} onClick={() => setPage(target)}><div className="ring"><Icon size={13} strokeWidth={1.3} /><strong>{value}</strong></div><small>{label}</small></button>)}</div>
          <div className="focus-arc"><svg viewBox="0 0 430 120" aria-hidden="true"><path d="M12 110 Q215 -56 418 110" /></svg><span className="arc-start">09:40</span><span className="arc-end">10:30</span></div>
          <div className="focus-value">{focus || remaining < 3000 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '50'}</div>
          <div className="eyebrow">{focus ? 'A LITTLE SPACE TO FOCUS' : 'MINUTES TO YOURSELF'}</div>
          <h1>Make room for what matters.</h1>
          <p>Your morning is open until 10:30. A little uninterrupted time<br className="wide-break" /> for the first draft, before the rest of your day begins.</p>
          <button className="focus-button" onClick={() => { if (!remaining) setRemaining(3000); setFocus(v => !v); }}>{focus ? <Pause size={13} /> : <Play size={13} />} {focus ? 'Pause your focus' : remaining < 3000 && remaining > 0 ? 'Resume your focus' : 'Start a 50-minute focus'}</button>
          {focus && <span className="focus-live" role="status">Timer running in this prototype</span>}
        </section>
        <section className="day-grid">
          <div className="up-next"><div className="section-heading"><h2>Up next</h2><button onClick={() => setPage('Tasks')}>All tasks</button></div>
            <div className={`task-card ${done ? 'completed' : ''}`}><div className="task-title"><button className="completion" aria-label={done ? 'Mark task incomplete' : 'Complete first draft task'} aria-pressed={done} onClick={() => setDone(v => !v)}>{done ? <Check size={14} /> : null}</button><button onClick={() => open('task')}>Shape the LifeOS first draft</button><IconButton icon={ArrowRight} label="Open task details" onClick={() => open('task')} /></div><p>One clear daily story. Keep the rest a layer away.</p><small><b>Studio</b><i>·</i>50 min<i>·</i>Today</small></div>
            <button className="capture-row" onClick={() => open('capture')}><span className="capture-icon"><Mic size={16} strokeWidth={1.3} /></span><span>What’s on your mind?<small>A thought, a note, a voice memo.</small></span><ChevronRight size={16} /></button>
          </div>
          <div className="your-day"><div className="section-heading"><h2>Your day</h2><div><IconButton icon={Plus} label="New capture" onClick={() => open('capture')} /><IconButton icon={CalendarDays} label="Open calendar" onClick={() => setPage('Calendar')} /></div></div><div className="timeline">{day.map(({ time, title, detail, icon: Icon }, idx) => <button className="timeline-event" key={title} onClick={() => open(idx === 0 ? 'meeting' : idx === 1 ? 'priorities' : 'journal')}><span className={`event-dot dot-${idx}`}><Icon size={12} strokeWidth={1.4} /></span><span><small>{time}</small><strong>{title}</strong><em>{detail}</em></span><ArrowRight size={14} strokeWidth={1.3} /></button>)}</div></div>
        </section>
        <footer><span>A good morning, Avi.</span><button onClick={() => setPage('Calendar')}>View full timeline <ArrowRight size={12} /></button></footer>
      </> : <section className="secondary-view">
        <span className="eyebrow">YOUR PERSONAL SPACE · DEMO DATA</span>
        <h1>{page === 'Tasks' ? 'One thing at a time.' : page === 'Calendar' ? 'Give your day a little room.' : page === 'Journal' ? 'Keep the thought.' : 'See the bigger picture.'}</h1>
        <p className="secondary-subtitle">{page === 'Tasks' ? 'A small, deliberate list. The important things, without the noise.' : page === 'Calendar' ? 'Your commitments, and the spaces between them.' : page === 'Journal' ? 'Small moments, kept together. Nothing here leaves this page.' : 'Useful patterns, grounded in what actually happened.'}</p>
        {page === 'Tasks' && <div className="secondary-card"><button className="list-task" onClick={() => open('task')}><CircleCheck size={20} /><span>Shape the LifeOS first draft<small>Studio · 50 min · {done ? 'Completed' : 'Today'}</small></span><ArrowRight size={17} /></button><button className="list-task" onClick={() => open('priorities')}><CircleCheck size={20} /><span>Weekly priorities outlined<small>Studio · Completed</small></span><ArrowRight size={17} /></button></div>}
        {page === 'Calendar' && <div className="calendar-stack">{[['09:40 – 10:30', 'Shape the LifeOS first draft', 'Proposed focus · Studio'], ['10:30 – 11:00', 'Design catch-up', 'Meeting · Maya Chen'], ['11:00 – 12:15', 'Open time', 'Room for whatever comes next']].map(([time,title,detail], i) => <button key={title} onClick={() => open(i === 0 ? 'task' : i === 1 ? 'meeting' : 'quiet')}><time>{time}</time><span>{title}<small>{detail}</small></span><ArrowRight size={15} /></button>)}</div>}
        {page === 'Journal' && <div className="journal-grid"><button className="journal-card" onClick={() => open('journal')}><BookOpen size={19} /><small>THIS MORNING · 08:45</small><h2>A slower start</h2><p>I left a little space this morning. It turns out the first step can be a quiet one.</p><span>Open entry <ArrowRight size={14} /></span></button>{captures.map((capture,i) => <article className="journal-card" key={i}><BookOpen size={19} /><small>CAPTURED IN THIS SESSION</small><h2>A new thought</h2><p>{capture}</p></article>)}<button className="journal-card add-entry" onClick={() => open('capture')}><Plus size={24} /><h2>What’s on your mind?</h2><p>Keep a thought before it passes.</p></button></div>}
        {page === 'Review' && <div className="review-grid"><article><span className="eyebrow">SPACE, NOT A SCORE</span><h2>A little more breathing room.</h2><p>You have 2 hours and 15 minutes of open time in this sample day. Protecting one small focus block is a useful place to start.</p><button onClick={() => setPage('Calendar')}>See the day <ArrowRight size={14} /></button></article><article><span className="eyebrow">CONNECTED MOMENTS</span><h2>From thought to first draft.</h2><p>“A slower start” → Weekly priorities → Shape the LifeOS first draft.</p><small>Illustrative relationship, not an AI-generated insight.</small><button onClick={() => open('journal')}>View the source entry <ArrowRight size={14} /></button></article></div>}
      </section>}
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-heading" ref={dialogRef}><IconButton icon={X} label="Close dialog" onClick={close} />
      {modal === 'capture' ? <form onSubmit={saveCapture}><span className="eyebrow">A LITTLE SPACE TO THINK</span><h2 id="dialog-heading">What’s on your mind?</h2><p>Capture a thought. It stays in this demo session only.</p><textarea autoFocus aria-label="Your thought" placeholder="I’ve been thinking about…" value={draft} onChange={e => setDraft(e.target.value)} rows={6} /><small>Voice recording and semantic processing are not connected in this study.</small><button className="focus-button" disabled={!draft.trim()} type="submit">Keep this thought <ArrowRight size={14} /></button></form>
      : modal === 'task' ? <><span className="eyebrow">STUDIO · TODAY · 50 MINUTES</span><h2 id="dialog-heading">Shape the LifeOS first draft</h2><p>One clear daily story. Keep the rest a layer away.</p><ul><li>Make the next useful action obvious.</li><li>Give tasks, meetings and journal entries one shared timeline.</li><li>Keep every suggested change reviewable.</li></ul><button className="focus-button" onClick={() => { setDone(v => !v); close(); }}>{done ? 'Mark incomplete' : 'Complete task'} <Check size={14} /></button><small>Changes affect this prototype only.</small></>
      : modal === 'search' ? <><span className="eyebrow">FIND A MOMENT</span><h2 id="dialog-heading">Search your day</h2><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search demo tasks and entries" aria-label="Search demo records" />{['Shape the LifeOS first draft', ...day.map(v => v.title), ...captures].filter(v => v.toLowerCase().includes(search.toLowerCase())).map(v => <p className="search-result" key={v}>{v}</p>)}</>
      : <><span className="eyebrow">{modal === 'settings' ? 'REACT DESIGN STUDY' : 'A MOMENT IN YOUR DAY'}</span><h2 id="dialog-heading">{{settings:'LifeOS, a calmer kind of organised.',meeting:'Design catch-up',priorities:'Weekly priorities outlined',journal:'A slower start',quiet:'A quieter morning'}[modal]}</h2><p>{{settings:'This is an isolated React prototype. It uses sample data and session-only interactions. It does not connect to Things, Calendar, memory or the LifeOS sync engine.',meeting:'10:30–11:00 · Maya Chen. A short conversation to align on the first LifeOS daily experience. Related task: Shape the LifeOS first draft.',priorities:'Completed at 09:10. Today’s intention: protect a focused first draft, then leave room to reflect.',journal:'I left a little space this morning. It turns out the first step can be a quiet one.',quiet:'Start small. Keep the first 50 minutes free, make one useful thing, and let the day unfold.'}[modal]}</p><small>Demo content · 6 October 2026</small></>}
    </section></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
