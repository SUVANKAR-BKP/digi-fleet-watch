export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
      <svg viewBox="0 0 280 170" fill="none" className="h-40 w-auto" aria-hidden>
        {/* three servers drifting apart */}
        <g stroke="#475569" strokeWidth="2" strokeLinecap="round">
          <g opacity="0.55">
            <rect x="26" y="96" width="64" height="44" rx="8" fill="#0f172a" />
            <line x1="40" y1="106" x2="76" y2="106" />
            <line x1="40" y1="114" x2="76" y2="114" />
            <line x1="40" y1="122" x2="64" y2="122" />
          </g>
          <g opacity="0.7">
            <rect x="112" y="72" width="64" height="44" rx="8" fill="#0b1220" />
            <line x1="126" y1="82" x2="162" y2="82" />
            <line x1="126" y1="90" x2="162" y2="90" />
            <line x1="126" y1="98" x2="150" y2="98" />
          </g>
          <g opacity="0.85">
            <rect x="196" y="56" width="64" height="44" rx="8" fill="#0b1220" />
            <line x1="210" y1="66" x2="246" y2="66" />
            <line x1="210" y1="74" x2="246" y2="74" />
            <line x1="210" y1="82" x2="234" y2="82" />
          </g>
        </g>
        {/* broken connection line */}
        <path
          d="M30 122 C 84 140, 130 140, 176 120"
          stroke="#0ea5e9"
          strokeWidth="1.6"
          strokeDasharray="4 5"
          opacity="0.7"
        />
        <circle cx="30" cy="121" r="3.5" fill="#0ea5e9" opacity="0.9" />
        {/* status dots on racks */}
        <circle cx="40" cy="132" r="3" fill="#334155" />
        <circle cx="126" cy="108" r="3" fill="#f59e0b" />
        <circle cx="210" cy="92" r="3" fill="#22c55e" />
      </svg>
      <div>
        <h2 className="text-base font-semibold">No hosts are reporting in yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Click <strong className="text-foreground">+ Add Host</strong> in the
          header to get a ready-made one-liner, then run it as root on each
          server. The agent downloads itself and starts reporting within 5
          minutes.
        </p>
      </div>
      <div className="w-full max-w-xl rounded-lg border border-border bg-background p-3 text-left font-mono text-xs leading-6">
        <div className="text-muted-foreground"># on each monitored host:</div>
        <div>
                  <span className="text-primary">$</span> AGENT_API_TOKEN=YOUR_SHARED_TOKEN \
                </div>
                <div className="pl-4">
                  FLEETWATCH_URL=https://fleet.example.com \
                </div>
                <div className="pl-4">bash /opt/digi-fleet-watch/install.sh</div>
      </div>
    </div>
  );
}