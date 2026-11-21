// ─────────────────────────────────────────────────────────────────────────────
// GPU frame time for the performance overlay, from EXT_disjoint_timer_query_webgl2.
// Queries come back a frame or two later; browsers without the extension report "n/a".
// ─────────────────────────────────────────────────────────────────────────────
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private ext: TimerExt | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** smoothed GPU milliseconds per frame (−1 = not available) */
  ms = -1;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get supported(): boolean {
    return !!this.ext;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      this.pending.shift();
      if (!disjoint) {
        const ms = ns / 1e6;
        this.ms = this.ms < 0 ? ms : this.ms * 0.9 + ms * 0.1;
      }
    }
  }
}
