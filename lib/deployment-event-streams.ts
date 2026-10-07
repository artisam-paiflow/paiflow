import "server-only";
import type Redis from "ioredis";
import { log } from "@/lib/log";
import { redisSub } from "@/lib/redis";
import { isShuttingDown, onServerShutdown } from "@/lib/server-shutdown";

interface Viewer {
  ready: () => void;
  message: (message: string) => void;
  close: () => void;
}

interface Channel {
  viewers: Map<Viewer, ReturnType<typeof setTimeout> | null>;
  subscribed: boolean;
  running: boolean;
  cancelCommand?: () => void;
}

/** One dispatcher per subscriber; commands for each channel are reconciled in order. */
export class DeploymentEventStreams {
  private channels = new Map<string, Channel>();
  private stopped = false;
  private removeShutdown: () => void;

  constructor(private readonly sub: Redis) {
    sub.on("message", this.message);
    sub.on("ready", this.ready);
    sub.on("error", this.error);
    sub.on("close", this.closed);
    this.removeShutdown = onServerShutdown(() => this.shutdown());
  }

  get counts() {
    return {
      channels: this.channels.size,
      viewers: [...this.channels.values()].reduce((n, c) => n + c.viewers.size, 0),
    };
  }

  join(channel: string, viewer: Viewer): () => void {
    if (this.stopped || isShuttingDown()) {
      viewer.close();
      return () => {};
    }
    let state = this.channels.get(channel);
    if (!state) {
      state = { viewers: new Map(), subscribed: false, running: false };
      this.channels.set(channel, state);
    }
    const current = state;
    // Covers both readiness and a missing SUBSCRIBE acknowledgement. No late
    // completion can notify a viewer once its registration has been removed.
    current.viewers.set(
      viewer,
      setTimeout(() => {
        release();
        viewer.close();
      }, 5000),
    );
    const release = () => {
      const timer = current.viewers.get(viewer);
      if (!current.viewers.delete(viewer)) return;
      if (timer) clearTimeout(timer);
      this.reconcile(channel, current);
    };
    if (current.subscribed && !current.running) this.notifyReady(current, viewer);
    this.reconcile(channel, current);
    return release;
  }

  private notifyReady(state: Channel, viewer: Viewer) {
    if (!state.viewers.has(viewer)) return;
    const timer = state.viewers.get(viewer);
    if (timer) clearTimeout(timer);
    state.viewers.set(viewer, null);
    viewer.ready();
  }

  private reconcile(channel: string, state: Channel) {
    if (this.stopped || state.running || this.channels.get(channel) !== state) return;
    if (this.sub.status !== "ready") {
      if (!state.viewers.size && !state.subscribed) this.channels.delete(channel);
      return;
    }
    state.running = true;
    void (async () => {
      try {
        while (!this.stopped && this.channels.get(channel) === state) {
          const wanted = state.viewers.size > 0;
          if (wanted === state.subscribed) break;
          await this.command(channel, state, wanted);
          // A disconnected socket's pending command cannot change its successor.
          if (this.stopped || this.channels.get(channel) !== state) return;
          state.subscribed = wanted;
          if (wanted) {
            for (const viewer of [...state.viewers.keys()]) this.notifyReady(state, viewer);
          }
        }
      } catch (err) {
        if (this.channels.get(channel) !== state) return;
        log.warn({ err, channel }, "SSE subscription transition failed");
        this.closeViewers(state);
        // A failed acknowledgement leaves subscription state uncertain. Drop
        // the dedicated socket and reconnect without replaying old commands.
        this.closed();
        this.sub.disconnect(true);
      } finally {
        state.running = false;
        if (!state.viewers.size && !state.subscribed && this.channels.get(channel) === state) {
          this.channels.delete(channel);
        }
      }
    })();
  }

  private async command(channel: string, state: Channel, subscribe: boolean) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        state.cancelCommand = () => {
          clearTimeout(timer);
          reject(new Error("SSE subscriber disconnected"));
        };
        timer = setTimeout(() => reject(new Error("SSE subscription timeout")), 5000);
        const command = subscribe ? this.sub.subscribe(channel) : this.sub.unsubscribe(channel);
        void command.then(() => resolve(), reject);
      });
    } finally {
      clearTimeout(timer);
      state.cancelCommand = undefined;
    }
  }

  private closeViewers(state: Channel) {
    const viewers = [...state.viewers];
    state.viewers.clear();
    for (const [viewer, timer] of viewers) {
      if (timer) clearTimeout(timer);
      viewer.close();
    }
  }

  private message = (channel: string, message: string) => {
    const state = this.channels.get(channel);
    if (!state || !state.subscribed) return;
    for (const viewer of [...state.viewers.keys()]) viewer.message(message);
  };

  private ready = () => {
    for (const [channel, state] of this.channels) this.reconcile(channel, state);
  };

  private error = () => {
    for (const [channel, state] of this.channels) {
      this.closeViewers(state);
      this.reconcile(channel, state);
    }
  };

  private closed = () => {
    const states = [...this.channels.values()];
    this.channels.clear();
    for (const state of states) {
      state.cancelCommand?.();
      this.closeViewers(state);
    }
  };

  shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    const counts = this.counts;
    this.closed();
    this.sub.off("message", this.message);
    this.sub.off("ready", this.ready);
    this.sub.off("error", this.error);
    this.sub.off("close", this.closed);
    // This connection is dedicated to SSE. Disconnect synchronously rather than
    // wait for a Redis acknowledgement during the platform's shutdown deadline.
    this.sub.disconnect();
    this.removeShutdown?.();
    log.info(
      { closedViewers: counts.viewers, closedChannels: counts.channels, ...this.counts },
      "SSE shutdown cleanup completed",
    );
  }
}

const shared = globalThis as typeof globalThis & {
  paiflowEventStreams?: DeploymentEventStreams;
};

export function deploymentEventStreams(): DeploymentEventStreams | null {
  if (isShuttingDown()) return null;
  if (!shared.paiflowEventStreams) {
    const sub = redisSub();
    if (!sub) return null;
    shared.paiflowEventStreams = new DeploymentEventStreams(sub);
  }
  return shared.paiflowEventStreams;
}
