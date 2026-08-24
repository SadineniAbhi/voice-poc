// Wraps the browser<->OpenAI Realtime WebRTC leg described in plan.md:
//   1. RTCPeerConnection with a STUN-only ICE config (no TURN, by design).
//   2. mic capture + a data channel named "oai-events".
//   3. POST the SDP offer to /v1/realtime/calls with the ephemeral bearer, apply the answer.
//   4. Parse data-channel events; surface `route_call` tool invocations (with the model's
//      own summary of the conversation) to the caller.
//
// A route hop is NOT an in-place session.update — each hop tears this connection down and
// opens a brand new RealtimeCall against a freshly minted session seeded with that summary
// (see CallPage.tsx). `rejectRoute()` is the one thing that *does* happen on this same,
// still-alive connection: when the backend rejects the target (failed the neighbor check),
// the model needs to hear that on the session it's still in, so it can retry.
//
// Raw protocol event types (`response.done`, `output_audio_buffer.stopped`, ...) never
// reach the UI directly — they're translated here into a small `Activity` enum the orb
// animates against, so the interface never leaks wire-protocol names to the user.

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type Activity = "idle" | "listening" | "thinking" | "speaking";

export interface RouteCallInvocation {
  callId: string;
  nodeId: string;
  summary: string;
}

export interface RealtimeCallHandlers {
  onRemoteStream: (stream: MediaStream) => void;
  onRouteCall: (invocation: RouteCallInvocation) => void;
  onActivity?: (activity: Activity) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

const ACTIVITY_BY_EVENT: Record<string, Activity> = {
  "input_audio_buffer.speech_started": "listening",
  "input_audio_buffer.speech_stopped": "thinking",
  "response.created": "thinking",
  "output_audio_buffer.started": "speaking",
  "output_audio_buffer.stopped": "idle",
  "response.done": "idle",
};

export class RealtimeCall {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel;
  private micStream: MediaStream | null = null;

  private constructor(pc: RTCPeerConnection, dc: RTCDataChannel) {
    this.pc = pc;
    this.dc = dc;
  }

  static async connect(
    clientSecret: string,
    stunUrl: string,
    handlers: RealtimeCallHandlers,
    openingInstructions?: string
  ): Promise<RealtimeCall> {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] });

    pc.onconnectionstatechange = () => {
      handlers.onConnectionStateChange?.(pc.connectionState);
    };

    pc.ontrack = (event) => {
      if (event.streams[0]) handlers.onRemoteStream(event.streams[0]);
    };

    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

    const dc = pc.createDataChannel("oai-events");
    const call = new RealtimeCall(pc, dc);
    call.micStream = micStream;
    call.wireDataChannel(handlers);

    if (openingInstructions) {
      // With server-side VAD (the default) the model just waits silently for the caller
      // to speak — nothing about the session `instructions` alone ever triggers it to
      // talk first. Force the opening turn explicitly the instant the channel is usable,
      // with a response-scoped `instructions` override (not the whole system prompt) so
      // it reliably says this and only this — and tool_choice "none" so it can't reach
      // for route_call before it's said a word.
      dc.addEventListener(
        "open",
        () => {
          call.send({
            type: "response.create",
            response: { instructions: openingInstructions, tool_choice: "none" },
          });
        },
        { once: true }
      );
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(OPENAI_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpResponse.ok) {
      throw new Error(`Call setup failed (${sdpResponse.status})`);
    }
    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    return call;
  }

  private wireDataChannel(handlers: RealtimeCallHandlers): void {
    this.dc.addEventListener("message", (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      const type = data.type as string | undefined;
      if (type && type in ACTIVITY_BY_EVENT) {
        handlers.onActivity?.(ACTIVITY_BY_EVENT[type]);
      }

      if (type === "response.done") {
        const output = (data.response as { output?: unknown[] } | undefined)?.output ?? [];
        for (const item of output) {
          const fnCall = item as { type?: string; name?: string; call_id?: string; arguments?: string };
          if (fnCall.type === "function_call" && fnCall.name === "route_call") {
            try {
              const args = JSON.parse(fnCall.arguments ?? "{}") as {
                node_id?: string;
                summary?: string;
              };
              if (args.node_id && fnCall.call_id) {
                handlers.onRouteCall({
                  callId: fnCall.call_id,
                  nodeId: args.node_id,
                  summary: args.summary ?? "",
                });
              }
            } catch {
              // malformed arguments — ignore, model will just not get routed this turn
            }
          }
        }
      }
    });
  }

  private send(event: Record<string, unknown>): void {
    if (this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
  }

  /** The requested route failed the backend's neighbor check (or any other server-side
   * validation) — tell the model so via the tool's own error channel instead of tearing
   * this connection down, so it can see what went wrong and retry with a valid id. */
  rejectRoute(callId: string, errorMessage: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ error: errorMessage }),
      },
    });
    this.send({ type: "response.create" });
  }

  disconnect(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.dc.close();
    this.pc.close();
  }
}
