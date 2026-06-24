import { useEffect } from 'react';

export default function LandingPage({ onGoToPanel }) {
  useEffect(() => {
    // Terminal animation script
    const lines = [
      { text: '$ adx deploy --repo ./mern-monorepo', cls: 'tc' },
      { text: '  ↳ AI Master Audit running...', cls: 'tm', delay: 600 },
      { text: '  ✓ Vite frontend detected   (apps/client)', cls: 'tg', delay: 1100 },
      { text: '  ✓ Express backend detected (apps/server)', cls: 'tg', delay: 1400 },
      { text: '  ↳ Pre-flight error scan...', cls: 'tm', delay: 1900 },
      { text: '  ✓ No casing conflicts found', cls: 'tg', delay: 2200 },
      { text: '  ✓ Environment variables verified', cls: 'tg', delay: 2500 },
      { text: '  ↳ Generating serverless bridge...', cls: 'tm', delay: 3000 },
      { text: '  ✓ api/index.js  ← written', cls: 'tg', delay: 3300 },
      { text: '  ✓ vercel.json   ← written', cls: 'tg', delay: 3600 },
      { text: '  ↳ Syncing to shadow branch [adx/deploy]', cls: 'tm', delay: 4100 },
      { text: '  ✓ main branch untouched', cls: 'tg', delay: 4400 },
      { text: '', delay: 4700 },
      { text: '  🚀 Deployed → https://mern-app.vercel.app', cls: 'tc tb', delay: 5000 },
    ];

    const body = document.getElementById('term-body');
    if (!body) return;

    let i = 0;

    function nextLine() {
      if (i >= lines.length) return;
      const l = lines[i];
      const t = setTimeout(() => {
        const span = document.createElement('span');
        span.className = 'tl ' + (l.cls || '');
        span.textContent = l.text || '\u00A0';
        const cursor = body.querySelector('.cursor');
        body.insertBefore(span, cursor);
        if (i === lines.length - 1 && cursor) cursor.remove();
        i++;
        nextLine();
      }, i === 0 ? 800 : (l.delay - lines[i - 1].delay));
    }

    nextLine();

    return () => {
      // Cleanup timeouts on unmount
      const highestTimeoutId = setTimeout(() => {}, 0);
      for (let id = 0; id < highestTimeoutId; id++) {
        clearTimeout(id);
      }
    };
  }, []);

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #000; font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes glow-pulse { 0%, 100% { box-shadow: 0 0 20px rgba(0,217,255,0.25); } 50% { box-shadow: 0 0 40px rgba(0,217,255,0.5); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .fade-up { animation: fadeUp 0.7s ease forwards; opacity: 0; }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.25s; }
        .d3 { animation-delay: 0.4s; }
        .d4 { animation-delay: 0.55s; }
        .d5 { animation-delay: 0.7s; }
        .d6 { animation-delay: 0.85s; }
        .cursor { animation: blink 0.8s step-end infinite; }
        .glow-btn { animation: glow-pulse 2.5s ease infinite; }
        nav { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; height: 60px; background: rgba(0,0,0,0.9); backdrop-filter: blur(20px); border-bottom: 1px solid #1a1a1a; }
        .logo { display: flex; align-items: center; gap: 8px; }
        .logo-icon { width: 26px; height: 26px; border-radius: 6px; background: linear-gradient(135deg, #00d9ff, #0066ff); display: flex; align-items: center; justify-center; font-size: 12px; font-weight: 900; color: #000; flex-shrink: 0; }
        .logo-text { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; }
        .logo-text span { color: #00d9ff; }
        .nav-right { display: flex; gap: 8px; }
        .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; border: none; transition: all 0.2s; letter-spacing: -0.01em; }
        .btn-ghost { background: transparent; color: #fff; border: 1px solid #2a2a2a; }
        .btn-ghost:hover { background: #111; }
        .btn-primary { background: linear-gradient(135deg, #00d9ff, #0066ff); color: #000; box-shadow: 0 0 20px rgba(0,217,255,0.3); }
        .btn-primary:hover { box-shadow: 0 0 32px rgba(0,217,255,0.5); transform: translateY(-1px); }
        section.hero { padding: 80px 28px 60px; text-align: center; position: relative; overflow: hidden; }
        .hero-bg { position: absolute; top: 10%; left: 50%; transform: translateX(-50%); width: 500px; height: 300px; background: radial-gradient(ellipse, rgba(0,217,255,0.08) 0%, transparent 70%); pointer-events: none; }
        .badge { display: inline-flex; align-items: center; gap: 7px; padding: 5px 13px; border-radius: 999px; border: 1px solid rgba(0,217,255,0.3); background: rgba(0,217,255,0.08); color: #00d9ff; font-size: 12px; font-weight: 600; margin-bottom: 28px; letter-spacing: 0.03em; }
        .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: #00d9ff; box-shadow: 0 0 6px #00d9ff; flex-shrink: 0; }
        h1 { font-size: clamp(34px, 6vw, 68px); font-weight: 800; line-height: 1.05; letter-spacing: -0.04em; max-width: 720px; margin: 0 auto 20px; }
        h1 .gradient { background: linear-gradient(135deg, #00d9ff, #0066ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .subhead { font-size: clamp(14px, 2vw, 17px); color: #888; max-width: 540px; line-height: 1.65; margin: 0 auto 36px; }
        .ctas { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 52px; }
        .terminal-wrap { max-width: 620px; margin: 0 auto; }
        .term-window { background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 12px; overflow: hidden; box-shadow: 0 0 50px rgba(0,217,255,0.12), 0 24px 48px rgba(0,0,0,0.8); }
        .term-bar { background: #111; border-bottom: 1px solid #1a1a1a; padding: 10px 14px; display: flex; align-items: center; gap: 7px; }
        .dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
        .term-title { margin-left: 6px; color: #555; font-size: 12px; font-family: 'SF Mono', 'Fira Code', monospace; }
        .term-body { padding: 18px 22px 24px; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.85; min-height: 280px; }
        .tl { display: block; }
        .tc { color: #00d9ff; }
        .tg { color: #4ade80; }
        .tm { color: #666; }
        .tb { font-weight: 700; }
        .section { padding: 80px 28px; }
        .section-label { color: #00d9ff; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 14px; }
        h2 { font-size: clamp(24px, 4vw, 44px); font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; margin-bottom: 52px; }
        h2 .dim { color: #555; font-weight: 400; }
        .pipeline-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; background: #1a1a1a; border: 1px solid #1a1a1a; border-radius: 14px; overflow: hidden; }
        .pipe-step { background: #0a0a0a; padding: 32px 26px; transition: background 0.2s; cursor: default; }
        .pipe-step:hover { background: #0f0f0f; }
        .pipe-icon { font-size: 22px; color: #00d9ff; filter: drop-shadow(0 0 6px rgba(0,217,255,0.5)); margin-bottom: 12px; }
        .pipe-num { font-size: 11px; font-weight: 700; color: #333; letter-spacing: 0.1em; font-family: monospace; margin-bottom: 8px; }
        .pipe-title { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 10px; }
        .pipe-desc { font-size: 13px; color: #666; line-height: 1.65; }
        .bento-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
        .bento-wide { grid-column: span 2; min-width: 0; }
        @media (max-width: 580px) { .bento-wide { grid-column: span 1; } }
        .feature-card { background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 14px; padding: 30px 26px; height: 100%; transition: border-color 0.2s; position: relative; overflow: hidden; }
        .feature-card:hover { border-color: rgba(0,217,255,0.2); }
        .feature-tag { display: inline-block; padding: 3px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 18px; }
        .tag-cyan { background: rgba(0,217,255,0.1); color: #00d9ff; }
        .tag-purple { background: rgba(124,58,237,0.12); color: #a78bfa; }
        .tag-amber { background: rgba(245,158,11,0.12); color: #fbbf24; }
        .feature-title { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 10px; }
        .feature-desc { font-size: 14px; color: #666; line-height: 1.65; }
        .code-block { margin-top: 20px; background: #080808; border: 1px solid #1a1a1a; border-radius: 8px; padding: 14px 16px; font-family: 'SF Mono','Fira Code','Consolas',monospace; font-size: 12px; color: #4ade80; line-height: 1.75; overflow-x: auto; white-space: pre; }
        .tech-section { padding: 0 28px 80px; }
        .tech-box { border: 1px solid #1a1a1a; border-radius: 14px; padding: 44px 28px; text-align: center; }
        .tech-label { color: #333; font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 36px; }
        .tech-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 28px 40px; }
        .tech-item { display: flex; flex-direction: column; align-items: center; gap: 9px; color: #3a3a3a; transition: color 0.2s; cursor: default; }
        .tech-item:hover { color: #fff; }
        .tech-name { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; }
        .cta-banner { margin: 0 28px 80px; border: 1px solid rgba(0,217,255,0.2); border-radius: 18px; padding: 64px 40px; text-align: center; background: #030810; position: relative; overflow: hidden; box-shadow: 0 0 60px rgba(0,217,255,0.05); }
        .cta-banner h2 { margin-bottom: 14px; }
        .cta-banner p { color: #888; font-size: 16px; max-width: 400px; margin: 0 auto 32px; line-height: 1.6; }
        footer { border-top: 1px solid #1a1a1a; padding: 24px 28px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
        .footer-left { display: flex; align-items: center; gap: 8px; color: #555; font-size: 13px; }
        .footer-right { display: flex; gap: 20px; align-items: center; }
        .footer-link { color: #555; font-size: 13px; text-decoration: none; transition: color 0.15s; }
        .footer-link:hover { color: #fff; }
      `}</style>

      <nav className="fade-up d1">
        <div className="logo">
          <div className="logo-icon">X</div>
          <div className="logo-text">Auto Deploy<span>X</span></div>
        </div>
        <div className="nav-right">
          <a href="#" className="btn btn-ghost">View GitHub</a>
          <button onClick={onGoToPanel} className="btn btn-primary glow-btn">Dashboard →</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-bg"></div>
        <div className="badge fade-up d1"><div className="badge-dot"></div>MERN · CI/CD · Serverless</div>
        <h1 className="fade-up d2">Deploy MERN Monorepos.<br /><span className="gradient">Zero Configuration.</span></h1>
        <p className="subhead fade-up d3">Auto Deploy X is an intelligent CI/CD engine that auto-writes your Vercel serverless bridges, catches architecture errors before they crash, and takes your Vite + Express apps from GitHub to production in seconds.</p>
        <div className="ctas fade-up d4">
          <button onClick={onGoToPanel} className="btn btn-primary glow-btn" style={{padding:'11px 26px',fontSize:'14px'}}>Go to Dashboard →</button>
          <a href="#" className="btn btn-ghost" style={{padding:'11px 22px',fontSize:'14px'}}>
            <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            View GitHub
          </a>
        </div>

        <div className="terminal-wrap fade-up d5">
          <div className="term-window">
            <div className="term-bar">
              <div className="dot" style={{background:'#ff5f57'}}></div>
              <div className="dot" style={{background:'#ffbd2e'}}></div>
              <div className="dot" style={{background:'#28c840'}}></div>
              <span className="term-title">adx — deploy</span>
            </div>
            <div className="term-body" id="term-body">
              <span className="cursor tg">█</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{paddingTop:'60px'}}>
        <div style={{textAlign:'center'}}>
          <p className="section-label fade-up">The Pipeline</p>
          <h2 className="fade-up" style={{maxWidth:'460px',margin:'0 auto 52px'}}>From push to production in four steps.</h2>
        </div>
        <div className="pipeline-grid">
          <div className="pipe-step fade-up d1">
            <div className="pipe-icon">⬡</div>
            <div className="pipe-num">01</div>
            <div className="pipe-title">AI Master Audit</div>
            <p className="pipe-desc">Scans every directory of your monorepo. Detects Vite, Express, and custom configs automatically — no manifest file required.</p>
          </div>
          <div className="pipe-step fade-up d2">
            <div className="pipe-icon">◈</div>
            <div className="pipe-num">02</div>
            <div className="pipe-title">Pre-Deployment Error Detection</div>
            <p className="pipe-desc">Fails fast. Catches filename casing mismatches, missing env variables, and bad Express configs before a single byte hits Vercel.</p>
          </div>
          <div className="pipe-step fade-up d3">
            <div className="pipe-icon">◇</div>
            <div className="pipe-num">03</div>
            <div className="pipe-title">Dynamic Code Generation</div>
            <p className="pipe-desc">Auto-writes api/index.js serverless bridge and vercel.json routing config. You never touch these files.</p>
          </div>
          <div className="pipe-step fade-up d4">
            <div className="pipe-icon">◎</div>
            <div className="pipe-num">04</div>
            <div className="pipe-title">Shadow Branch Sync</div>
            <p className="pipe-desc">Generated code is pushed to an isolated adx/deploy branch. Your main branch remains exactly as you left it.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{paddingTop:'40px'}}>
        <div style={{textAlign:'center'}}>
          <p className="section-label">Key Features</p>
          <h2>Infrastructure logic, <span className="dim">handled.</span></h2>
        </div>
        <div className="bento-grid">
          <div className="bento-wide">
            <div className="feature-card" style={{borderColor:'#1a2a1a'}}>
              <span className="feature-tag tag-cyan">Reliability</span>
              <div className="feature-title">Database Cold-Start Killer</div>
              <p className="feature-desc">Enforces a verified DB connection before the serverless function ever executes. No more random 500s on first request after idle.</p>
              <div className="code-block">{`// Auto-injected by ADX
await mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  bufferCommands: false,
});`}</div>
            </div>
          </div>
          <div className="feature-card">
            <span className="feature-tag tag-purple">Routing</span>
            <div className="feature-title">Regex API Routing</div>
            <p className="feature-desc">Dynamically extracts every Express route from your source and maps them to Vercel edge rewrites. Zero manual config.</p>
          </div>
          <div className="feature-card">
            <span className="feature-tag tag-amber">Architecture</span>
            <div className="feature-title">MERN Specialized</div>
            <p className="feature-desc">Built exclusively for full-stack Node.js monorepos. Not a generic CI tool shoehorned to fit — purpose-built from day one.</p>
          </div>
        </div>
      </section>

      <div className="tech-section">
        <div className="tech-box">
          <p className="tech-label">Powered By</p>
          <div className="tech-grid">
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="currentColor"><path d="M25 4c-1 0-2 .5-2.5 1.5L4 38c-1 1.7 0 3.5 2 3.5h38c2 0 3-1.8 2-3.5L28 5.5C27.5 4.5 26.5 4 25 4zm0 6.5l16 27.5H9L25 10.5z"/><path d="M23 20h4v10h-4zm0 12h4v4h-4z"/></svg>
              <span className="tech-name">Node.js</span>
            </div>
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="25" cy="25" r="4" fill="currentColor"/><ellipse cx="25" cy="25" rx="21" ry="8"/><ellipse cx="25" cy="25" rx="21" ry="8" transform="rotate(60 25 25)"/><ellipse cx="25" cy="25" rx="21" ry="8" transform="rotate(120 25 25)"/></svg>
              <span className="tech-name">React</span>
            </div>
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="currentColor"><path d="M25 4C18 18 16 24 16 33a9 9 0 0018 0C34 24 32 18 25 4z"/><line x1="25" y1="42" x2="25" y2="34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
              <span className="tech-name">MongoDB</span>
            </div>
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="currentColor"><polygon points="25,6 47,44 3,44"/></svg>
              <span className="tech-name">Vercel</span>
            </div>
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="currentColor"><circle cx="38" cy="13" r="5"/><circle cx="12" cy="38" r="5"/><circle cx="38" cy="38" r="5"/><line x1="38" y1="18" x2="38" y2="33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="17" y1="38" x2="33" y2="38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="35" y1="16" x2="15" y2="36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
              <span className="tech-name">Git</span>
            </div>
            <div className="tech-item">
              <svg width="34" height="34" viewBox="0 0 50 50" fill="currentColor"><polygon points="25,4 46,44 4,44" opacity="0.45"/><polygon points="33,4 8,30 30,30"/></svg>
              <span className="tech-name">Vite</span>
            </div>
          </div>
        </div>
      </div>

      <div className="cta-banner">
        <h2>Stop configuring.<br />Start shipping.</h2>
        <p>Connect your GitHub repo and let Auto Deploy X handle the rest.</p>
        <button onClick={onGoToPanel} className="btn btn-primary glow-btn" style={{padding:'12px 30px',fontSize:'15px'}}>Open Dashboard →</button>
      </div>

      <footer>
        <div className="footer-left">
          <div className="logo-icon" style={{width:'20px',height:'20px',borderRadius:'4px',fontSize:'9px'}}>X</div>
          Auto Deploy X — © 2025
        </div>
        <div className="footer-right">
          <button onClick={onGoToPanel} className="footer-link" style={{background:'none',border:'none',cursor:'pointer'}}>Dashboard</button>
          <a href="#" className="footer-link">GitHub</a>
          <span style={{color:'#333',fontSize:'12px'}}>Built for MERN Monorepos</span>
        </div>
      </footer>
    </>
  );
}
