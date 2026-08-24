import type { Activity } from "../webrtc/realtimeClient";

/** "off"/"connecting"/"switching" are call-lifecycle states; the rest mirror the live
 * `Activity` the realtime client reports (see realtimeClient.ts) — the orb is the only
 * place those ever surface, always as motion/color, never as text. */
export type OrbState = "off" | "connecting" | "switching" | Activity;

interface OrbProps {
  state: OrbState;
  onClick?: () => void;
  disabled?: boolean;
}

export default function Orb({ state, onClick, disabled }: OrbProps) {
  return (
    <button
      type="button"
      className="orb-button"
      onClick={onClick}
      disabled={disabled}
      aria-label={state === "off" ? "Start call" : "End call"}
    >
      <span className={`orb orb--${state}`} />
    </button>
  );
}
