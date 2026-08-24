import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import Orb, { type OrbState } from "../components/Orb";
import type { GraphNode } from "../types";
import { playSwitchBeep } from "../webrtc/beep";
import { RealtimeCall, type Activity, type RealtimeCallHandlers } from "../webrtc/realtimeClient";

type Phase = "off" | "connecting" | "on" | "ended" | "error";

export default function CallPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("off");
  const [activity, setActivity] = useState<Activity>("idle");
  const [switching, setSwitching] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callRef = useRef<RealtimeCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stunUrlRef = useRef<string>("");
  // The node the call is actually at right now, sent with every route request so the
  // backend can verify the model's chosen target is really a neighbor (see voice_api.py).
  // A ref, not state — read inside handler closures that outlive individual renders.
  const currentNodeIdRef = useRef<string>("");

  useEffect(() => {
    api
      .listNodes()
      .then((list) => {
        setNodes(list);
        if (list.length > 0) setSelectedNodeId(list[0].node_id);
      })
      .catch((err) => setErrorMessage(String(err)));
  }, []);

  /** Opens a RealtimeCall against an already-minted session. Used both for the initial
   * call and for every subsequent hop — a hop is a brand new session (see agent.py /
   * voice_api.py), not an in-place update, so `onRouteCall` below calls this again
   * recursively to open the next one. */
  function connect(clientSecret: string, openingInstructions: string): Promise<RealtimeCall> {
    const handlers: RealtimeCallHandlers = {
      onRemoteStream: (stream) => {
        if (audioRef.current) audioRef.current.srcObject = stream;
      },
      onConnectionStateChange: (state) => {
        if (state === "connected") setPhase("on");
        if (state === "failed" || state === "disconnected" || state === "closed") {
          setPhase((p) => (p === "ended" ? p : "error"));
        }
      },
      onActivity: setActivity,
      onRouteCall: async ({ callId, nodeId, summary }) => {
        setSwitching(true);
        playSwitchBeep();
        try {
          const session = await api.routeSession(nodeId, currentNodeIdRef.current, summary);
          const oldCall = callRef.current;
          const newCall = await connect(session.client_secret, session.opening_instructions);
          oldCall?.disconnect();
          callRef.current = newCall;
          currentNodeIdRef.current = nodeId;
          setBreadcrumb((prev) => [...prev, session.node.name]);
        } catch (err) {
          // The backend rejected this target (not a neighbor of the current node, or some
          // other validation failure) — tell the model via the tool's own error channel on
          // the still-alive current session, so it can retry instead of the call breaking.
          const message = err instanceof Error ? err.message : String(err);
          callRef.current?.rejectRoute(callId, message);
        } finally {
          setSwitching(false);
        }
      },
    };
    return RealtimeCall.connect(clientSecret, stunUrlRef.current, handlers, openingInstructions);
  }

  async function startCall() {
    if (!selectedNodeId) return;
    setErrorMessage(null);
    setPhase("connecting");
    setSwitching(false);
    setBreadcrumb([]);

    try {
      const [session, config] = await Promise.all([
        api.startSession(selectedNodeId),
        api.getConfig(),
      ]);
      stunUrlRef.current = config.stun_url;
      currentNodeIdRef.current = session.node.node_id;
      setBreadcrumb([session.node.name]);

      callRef.current = await connect(session.client_secret, session.opening_instructions);
    } catch (err) {
      setErrorMessage(String(err));
      setPhase("error");
    }
  }

  function hangUp() {
    callRef.current?.disconnect();
    callRef.current = null;
    setPhase("ended");
  }

  function handleOrbClick() {
    if (phase === "off" || phase === "ended" || phase === "error") {
      startCall();
    } else {
      hangUp();
    }
  }

  const orbState: OrbState =
    phase === "connecting"
      ? "connecting"
      : phase === "on"
        ? switching
          ? "switching"
          : activity
        : "off";

  const statusLine =
    phase === "off"
      ? "Tap to call"
      : phase === "connecting"
        ? "Connecting…"
        : phase === "ended"
          ? "Call ended"
          : phase === "error"
            ? "Connection lost"
            : switching
              ? "Switching…"
              : activity === "listening"
                ? "Listening…"
                : activity === "thinking"
                  ? "Thinking…"
                  : activity === "speaking"
                    ? "Speaking…"
                    : "Connected";

  const inCall = phase === "connecting" || phase === "on";

  return (
    <div className="call-stage">
      <Orb state={orbState} onClick={handleOrbClick} disabled={!selectedNodeId && phase === "off"} />

      <div className="call-status">
        <div className="status-line">{statusLine}</div>
        {breadcrumb.length > 0 && (
          <div className="breadcrumb">
            {breadcrumb.map((name, i) => (
              <span className="crumb" key={i}>
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <select
        className="node-picker"
        value={selectedNodeId}
        onChange={(e) => setSelectedNodeId(e.target.value)}
        disabled={inCall}
      >
        {nodes.length === 0 && <option value="">No nodes configured yet</option>}
        {nodes.map((n) => (
          <option key={n.node_id} value={n.node_id}>
            {n.name}
          </option>
        ))}
      </select>

      {errorMessage && <p className="error">{errorMessage}</p>}

      <audio ref={audioRef} autoPlay />
    </div>
  );
}
