import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-ink flex flex-col justify-between p-6 md:p-12 antialiased font-sans selection:bg-black selection:text-white">
      
      {/* Top Navbar */}
      <header className="w-full max-w-6xl mx-auto flex items-center justify-between border-b border-canvas-soft pb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-sm flex items-center justify-center text-white font-bold text-lg select-none">
            U
          </div>
          <span className="text-xl font-bold tracking-tight text-ink font-move">
            drivers-for-u
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wider text-body">
          <span>Platform hub</span>
        </div>
      </header>

      {/* Main Container */}
      <div className="relative w-full max-w-6xl mx-auto my-auto py-12 md:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        
        {/* Left Editorial Copy Block */}
        <div className="lg:col-span-5 space-y-6 text-left">
          <span className="inline-block px-3.5 py-1 rounded-full border border-surface-pressed bg-canvas-soft text-[10px] font-bold uppercase tracking-widest text-ink">
            Hungarian match ecosystem
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-ink leading-tight font-move">
            Rethinking urban logistics.
          </h1>
          <p className="text-base text-body leading-relaxed max-w-md">
            Connecting riders and driver partners using a real-time, highly-optimized Kuhn-Munkres matching pipeline wrapped in a seamless, unified mobile-native client.
          </p>
          <div className="pt-2">
            <span className="text-xs text-mute font-semibold uppercase tracking-wider">
              Active node: Kolkata operations
            </span>
          </div>
        </div>

        {/* Right Portal Cards Selector */}
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          
          {/* Rider Card */}
          <Link href="/rider" className="group block focus:outline-none">
            <div className="h-full p-8 rounded-xl border border-canvas-soft bg-canvas-softer hover:border-ink hover:bg-white transition duration-300 ease-out text-left space-y-6 shadow-sm hover:shadow-md relative overflow-hidden flex flex-col justify-between min-h-[300px]">
              <div className="space-y-4">
                <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white text-lg font-bold">
                  R
                </div>
                <h2 className="text-2xl font-bold text-ink tracking-tight font-move">
                  Rider portal
                </h2>
                <p className="text-xs text-body leading-relaxed">
                  Calculate dynamic surge quotes, lock matching requests inside bipartite booking radars, and stream active journeys with 4-second coordinate linear interpolation.
                </p>
              </div>
              <div className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-black text-white text-xs font-bold transition duration-200 group-hover:bg-black-elevated select-none w-fit self-start">
                Book a journey
              </div>
            </div>
          </Link>

          {/* Driver Partner Card */}
          <Link href="/driver" className="group block focus:outline-none">
            <div className="h-full p-8 rounded-xl border border-canvas-soft bg-canvas-softer hover:border-ink hover:bg-white transition duration-300 ease-out text-left space-y-6 shadow-sm hover:shadow-md relative overflow-hidden flex flex-col justify-between min-h-[300px]">
              <div className="space-y-4">
                <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white text-lg font-bold">
                  D
                </div>
                <h2 className="text-2xl font-bold text-ink tracking-tight font-move">
                  Driver portal
                </h2>
                <p className="text-xs text-body leading-relaxed">
                  Map regional surge grids overlaying glowing H3 hexagons, intercept high-priority dispatches with 15s radial countdowns, and slide to start/complete journeys.
                </p>
              </div>
              <div className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-black text-white text-xs font-bold transition duration-200 group-hover:bg-black-elevated select-none w-fit self-start">
                Go on duty
              </div>
            </div>
          </Link>

        </div>

      </div>

      {/* Footer Info Block */}
      <footer className="w-full max-w-6xl mx-auto border-t border-canvas-soft pt-6 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-semibold uppercase tracking-wider text-mute">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <div>Next.js 15 App Router</div>
          <div>•</div>
          <div>CapacitorJS Wrapper</div>
          <div>•</div>
          <div>TailwindCSS v4 Styling</div>
        </div>
        <div>
          © 2026 drivers-for-u inc.
        </div>
      </footer>

    </main>
  );
}

